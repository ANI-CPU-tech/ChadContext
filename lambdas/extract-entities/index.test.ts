import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { handler } from './index.js';

const s3Mock = mockClient(S3Client);
const bedrockMock = mockClient(BedrockRuntimeClient);

const POINTER = JSON.stringify({
  source: 'github',
  type: 'pull_request',
  raw_content:
    '{"event":"pull_request","summary":"PR 482 closed: Add retry delay","ids":{"repo":"acme/shop","pr":"482"}}',
  timestamp: '2026-09-18T00:00:00.000Z',
  ids: { repo: 'acme/shop', pr: '482', issue: '217' },
});

const MODEL_JSON = JSON.stringify({
  ticketIds: ['217'],
  people: ['logizel'],
  topics: ['payment retry delay'],
  linkedDiscordRefs: [],
});

function converseOut(text: string): object {
  return { output: { message: { role: 'assistant', content: [{ text }] } } };
}

describe('extract-entities', () => {
  beforeEach(() => {
    s3Mock.reset();
    bedrockMock.reset();
    s3Mock.on(GetObjectCommand).resolves({
      Body: { transformToString: async () => POINTER } as never,
    });
  });

  it('extracts entities from a canned PR pointer', async () => {
    bedrockMock.on(ConverseCommand).resolves(converseOut(MODEL_JSON) as never);
    const out = await handler({ bucketName: 'b', key: 'raw/github/pull_request/x.json' });
    const entities = out.entities as { ticketIds: string[] };
    assert.ok(entities.ticketIds.includes('217'));
    assert.equal(out.bucketName, 'b');
  });

  it('parses fenced model output', async () => {
    bedrockMock.on(ConverseCommand).resolves(converseOut(`\`\`\`json\n${MODEL_JSON}\n\`\`\``) as never);
    const out = await handler({ bucketName: 'b', key: 'k' });
    assert.ok((out.entities as { ticketIds: string[] }).ticketIds.includes('217'));
  });

  it('falls back to ids.issue when the model omits it', async () => {
    bedrockMock
      .on(ConverseCommand)
      .resolves(converseOut(JSON.stringify({ ticketIds: [], people: [], topics: [], linkedDiscordRefs: [] })) as never);
    const out = await handler({ bucketName: 'b', key: 'k' });
    assert.deepEqual((out.entities as { ticketIds: string[] }).ticketIds, ['217']);
  });

  it('throws on missing bucketName/key', async () => {
    await assert.rejects(handler({}), /missing bucketName\/key/);
  });

  it('throws on model garbage', async () => {
    bedrockMock.on(ConverseCommand).resolves(converseOut('not json at all {{{') as never);
    await assert.rejects(handler({ bucketName: 'b', key: 'k' }), /JSON/);
  });
});
