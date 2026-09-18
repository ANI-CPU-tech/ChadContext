import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockClient } from 'aws-sdk-client-mock';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { handler, nodeIdFor } from './index.js';

const bedrockMock = mockClient(BedrockRuntimeClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

const INPUT = {
  bucketName: 'b',
  key: 'raw/github/pull_request/x.json',
  ids: { repo: 'acme/shop', pr: '482', issue: '217' },
  entities: { ticketIds: ['217'], people: [], topics: ['payment retry delay'], linkedDiscordRefs: [] },
  matches: [
    { nodeId: 'NODE#discord-9931', score: 0.91 },
    { nodeId: 'NODE#ticket-100', score: 0.2 },
  ],
};

const MODEL_OUT = JSON.stringify({
  summary: 'This 3-second delay fixes payment failures (ticket 217) after the team ruled out 1 second.',
  freshness: 'fresh',
});

function converseOut(text: string): object {
  return { output: { message: { role: 'assistant', content: [{ text }] } } };
}

describe('score-and-store', () => {
  beforeEach(() => {
    bedrockMock.reset();
    ddbMock.reset();
    process.env.TABLE_NAME = 'ChadContextGraph';
    bedrockMock.on(ConverseCommand).resolves(converseOut(MODEL_OUT) as never);
    ddbMock.on(PutCommand).resolves({});
  });

  it('writes the node plus resolves/discussed_in/references edges', async () => {
    const out = await handler(INPUT);
    assert.equal(out.nodeId, 'NODE#pr-482');
    assert.equal(out.edgesWritten, 3);

    const items = ddbMock.commandCalls(PutCommand).map((c) => c.args[0].input.Item as Record<string, unknown>);
    assert.equal(items.length, 4);
    const node = items.find((i) => i.SK === 'METADATA');
    assert.equal(node?.PK, 'NODE#pr-482');
    assert.equal(node?.type, 'PR');
    assert.equal(node?.freshness, 'fresh');
    const sks = items.map((i) => i.SK).sort();
    assert.deepEqual(sks, ['EDGE#discord-9931', 'EDGE#ticket-100', 'EDGE#ticket-217', 'METADATA']);
    const rel = Object.fromEntries(items.filter((i) => i.SK !== 'METADATA').map((i) => [i.SK, i.relationship]));
    assert.deepEqual(rel, {
      'EDGE#ticket-217': 'resolves',
      'EDGE#discord-9931': 'discussed_in',
      'EDGE#ticket-100': 'references',
    });
  });

  it('throws on invalid freshness instead of storing garbage', async () => {
    bedrockMock.on(ConverseCommand).resolves(converseOut('{"summary":"x","freshness":"moldy"}') as never);
    await assert.rejects(handler(INPUT), /summary, freshness/);
    assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
  });

  it('throws when TABLE_NAME is missing', async () => {
    delete process.env.TABLE_NAME;
    await assert.rejects(handler(INPUT), /TABLE_NAME is not set/);
  });

  it('derives node ids per the schema convention', () => {
    assert.equal(nodeIdFor({ pr: '482' }), 'NODE#pr-482');
    assert.equal(nodeIdFor({ issue: '217' }), 'NODE#ticket-217');
    assert.equal(nodeIdFor({ sha: '603b2cd5595e315cc29d2d739744804510e4ae8c' }), 'NODE#push-603b2cd');
  });
});
