import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockClient } from 'aws-sdk-client-mock';
import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { handler } from './index.js';

const kbMock = mockClient(BedrockAgentRuntimeClient);

const INPUT = {
  bucketName: 'b',
  key: 'k',
  entities: { ticketIds: ['217'], people: [], topics: ['payment retry delay'], linkedDiscordRefs: [] },
};

describe('correlate-semantic', () => {
  beforeEach(() => {
    kbMock.reset();
    process.env.KNOWLEDGE_BASE_ID = 'kb-123';
  });

  it('maps KB chunks to node ids with scores', async () => {
    kbMock.on(RetrieveCommand).resolves({
      retrievalResults: [
        { score: 0.91, metadata: { nodeId: 'NODE#ticket-217' } },
        { score: 0.42, metadata: { nodeId: 'NODE#discord-9931' } },
        { score: 0.1, metadata: {} },
      ],
    } as never);
    const out = await handler(INPUT);
    assert.deepEqual(out.matches, [
      { nodeId: 'NODE#ticket-217', score: 0.91 },
      { nodeId: 'NODE#discord-9931', score: 0.42 },
    ]);
    assert.equal(out.bucketName, 'b');
  });

  it('fails clearly when the KB is not configured', async () => {
    process.env.KNOWLEDGE_BASE_ID = 'TODO-create-kb';
    await assert.rejects(handler(INPUT), /KNOWLEDGE_BASE_ID is not configured/);
    assert.equal(kbMock.commandCalls(RetrieveCommand).length, 0);
  });

  it('throws on empty query input', async () => {
    await assert.rejects(
      handler({ entities: { ticketIds: [], people: [], topics: [], linkedDiscordRefs: [] } }),
      /nothing to query/,
    );
  });
});
