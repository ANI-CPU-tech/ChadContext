import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { ExtractedEntities } from '../extract-entities/index.js';
import type { SemanticMatch } from '../correlate-semantic/index.js';
import type { Freshness, GraphEdge, GraphNode } from '../../shared/types.js';

// Step 3 of the pipeline: Nova Pro causal summary + staleness, then store.
// In:  correlate's output ({ bucketName, key, ids, entities, matches, ... }).
// Out: same fields + { nodeId, edgesWritten }. See docs/02-tech-stack.md §6
// and the frozen key patterns in docs/schema.md.
export const NOVA_PRO_ID = 'amazon.nova-pro-v1:0';
export const DISCUSS_THRESHOLD = 0.7;

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const FRESHNESS: Freshness[] = ['fresh', 'aging', 'stale'];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function responseText(out: ConverseCommandOutput): string {
  const blocks = out.output?.message?.content ?? [];
  const text = blocks.map((b) => ('text' in b ? (b.text ?? '') : '')).join('');
  if (!text.trim()) throw new Error('score-and-store: empty model response');
  return text;
}

function parseSummary(text: string): { summary: string; freshness: Freshness } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const rec = asRecord(JSON.parse((fenced?.[1] ?? text).trim()));
  const summary = asString(rec?.summary);
  const freshness = asString(rec?.freshness);
  if (!summary || !freshness || !(FRESHNESS as string[]).includes(freshness)) {
    throw new Error('score-and-store: model did not return { summary, freshness }');
  }
  return { summary, freshness: freshness as Freshness };
}

/** NODE#<type>-<id>: pr wins, then ticket, then push SHA. Mirrors docs/schema.md. */
export function nodeIdFor(ids: Record<string, string>): string {
  if (ids.pr) return `NODE#pr-${ids.pr}`;
  if (ids.issue) return `NODE#ticket-${ids.issue}`;
  if (ids.sha) return `NODE#push-${ids.sha.slice(0, 7)}`;
  throw new Error('score-and-store: no usable id (pr/issue/sha) to build a node id');
}

export const handler = async (event: unknown): Promise<Record<string, unknown>> => {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) throw new Error('score-and-store: TABLE_NAME is not set');

  const input = asRecord(event) ?? {};
  const ids = asRecord(input.ids);
  if (!ids) throw new Error('score-and-store: missing ids (extract must pass them through)');
  const strIds: Record<string, string> = {};
  for (const [k, v] of Object.entries(ids)) if (typeof v === 'string') strIds[k] = v;
  const nodeId = nodeIdFor(strIds);

  const entities = asRecord(input.entities) as ExtractedEntities | undefined;
  const matches = (Array.isArray(input.matches) ? input.matches : []) as SemanticMatch[];
  const key = asString(input.key) ?? '';

  const out = await bedrock.send(
    new ConverseCommand({
      modelId: NOVA_PRO_ID,
      inferenceConfig: { maxTokens: 1024, temperature: 0 },
      messages: [
        {
          role: 'user',
          content: [
            {
              text: [
                'Write a causal summary: why does this code change exist, in one or two sentences,',
                'naming the ticket and the discussion that caused it.',
                'Then score staleness: "fresh" (days), "aging" (weeks-months), "stale" (months+, likely outdated).',
                'Reply with JSON ONLY: {"summary": string, "freshness": "fresh"|"aging"|"stale"}.',
                `Topics: ${(entities?.topics ?? []).join(', ')}`,
                `Ticket ids: ${(entities?.ticketIds ?? []).join(', ')}`,
                `Matched nodes: ${matches.map((m) => `${m.nodeId} (${m.score.toFixed(2)})`).join(', ')}`,
              ].join('\n'),
            },
          ],
        },
      ],
    }),
  );
  const { summary, freshness } = parseSummary(responseText(out));
  const timestamp = new Date().toISOString();

  const node: GraphNode = {
    PK: nodeId as GraphNode['PK'],
    SK: 'METADATA',
    type: strIds.pr ? 'PR' : strIds.issue ? 'ISSUE' : 'MESSAGE',
    summary,
    freshness,
    timestamp,
    rawRef: key,
  };
  const edges: GraphEdge[] = [
    ...(entities?.ticketIds ?? []).map(
      (t): GraphEdge => ({
        PK: node.PK,
        SK: `EDGE#ticket-${t}`,
        relationship: 'resolves',
        createdAt: timestamp,
      }),
    ),
    ...matches.map(
      (m): GraphEdge => ({
        PK: node.PK,
        SK: `EDGE#${m.nodeId.replace(/^NODE#/, '')}`,
        relationship: m.score >= DISCUSS_THRESHOLD ? 'discussed_in' : 'references',
        createdAt: timestamp,
      }),
    ),
  ];

  for (const item of [node, ...edges]) {
    await ddb.send(new PutCommand({ TableName: tableName, Item: item }));
  }

  return { ...input, nodeId, edgesWritten: edges.length };
};
