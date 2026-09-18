import { config } from 'dotenv';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GraphEdge, GraphNode, RawIngestRecord } from '../shared/types.js';

config();

// Local-only seed for MCP traversal testing. Mock summaries/rawRefs are
// explicitly labeled — this does NOT claim Bedrock pipeline output.
// Real pipeline path remains S3 -> Step Functions -> DynamoDB.
// See docs/01-spec.md §8-§9 and shared/types.ts.
async function main(): Promise<void> {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const tableName = process.env.TABLE_NAME ?? 'ChadContextGraph';

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const filePath = path.resolve(__dirname, '../demo-discord-data.json');
  const body = await readFile(filePath, 'utf-8');
  const records = JSON.parse(body) as RawIngestRecord[];

  const client = new DynamoDBClient({ region });
  const ddb = DynamoDBDocumentClient.from(client);

  const s3Ref = 'raw/discord/demo-perfect-test-data.json';
  const edgeCreatedAt = '2026-09-12T11:20:00.000Z';

  // Message nodes use real messageIds — fail fast instead of writing NODE#message-undefined.
  const messageNodes: GraphNode[] = records.map((msg) => {
    const messageId = msg.ids.messageId;
    if (!messageId) {
      throw new Error(`Record missing ids.messageId: ${JSON.stringify(msg.ids)}`);
    }
    return {
      PK: `NODE#message-${messageId}`,
      SK: 'METADATA',
      type: 'MESSAGE',
      summary: `[local seed mock] ${msg.raw_content.slice(0, 140)}`,
      freshness: 'fresh',
      timestamp: msg.timestamp,
      rawRef: `${s3Ref}#${messageId}`,
    };
  });

  // Companion nodes so every EDGE# target below exists — no dangling edges.
  const extraNodes: GraphNode[] = [
    {
      PK: 'NODE#issue-217',
      SK: 'METADATA',
      type: 'ISSUE',
      summary:
        '[local seed mock] Ticket #217: Payments failing intermittently under load, retry gives up too fast.',
      freshness: 'fresh',
      timestamp: '2026-09-12T09:14:00.000Z',
      rawRef: 'raw/seed/demo-ticket-217-pr-482.json#issue-217',
    },
    {
      PK: 'NODE#pr-482',
      SK: 'METADATA',
      type: 'PR',
      summary:
        '[local seed mock] PR #482 adds time.sleep(3) before retry to fix #217, after 1s delay ruled out per logs.',
      freshness: 'fresh',
      timestamp: '2026-09-12T11:12:47.000Z',
      rawRef: 'raw/seed/demo-ticket-217-pr-482.json#pr-482',
    },
  ];

  const nodes = [...messageNodes, ...extraNodes];

  const edges: GraphEdge[] = [
    {
      PK: 'NODE#message-discord-9930',
      SK: 'EDGE#issue-217',
      relationship: 'references',
      createdAt: edgeCreatedAt,
    },
    {
      PK: 'NODE#message-discord-9932',
      SK: 'EDGE#pr-482',
      relationship: 'references',
      createdAt: edgeCreatedAt,
    },
    {
      PK: 'NODE#pr-482',
      SK: 'EDGE#message-discord-9931',
      relationship: 'discussed_in',
      createdAt: edgeCreatedAt,
    },
    {
      PK: 'NODE#pr-482',
      SK: 'EDGE#issue-217',
      relationship: 'resolves',
      createdAt: edgeCreatedAt,
    },
  ];

  for (const node of nodes) {
    await ddb.send(new PutCommand({ TableName: tableName, Item: node }));
  }

  for (const edge of edges) {
    await ddb.send(new PutCommand({ TableName: tableName, Item: edge }));
  }

  console.log(
    `Seeded ${nodes.length} nodes (${messageNodes.length} messages + ${extraNodes.length} issue/pr) and ${edges.length} edges to ${tableName}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
