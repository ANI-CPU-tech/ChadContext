import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { GraphEdge, GraphNode } from '../shared/types.js';

const region = process.env.AWS_REGION ?? 'us-east-1';
const tableName = process.env.TABLE_NAME ?? 'ChadContextGraph';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

function normalizeNodeId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const stripped = trimmed.startsWith('NODE#') ? trimmed.slice('NODE#'.length) : trimmed;
  if (!stripped || stripped.includes(' ') || stripped.includes('#')) return null;
  return stripped;
}

function isMetadataRow(item: GraphNode | GraphEdge): item is GraphNode {
  return item.SK === 'METADATA';
}

function describeNode(node: GraphNode): string {
  const summary = node.summary ?? '(no summary)';
  return `**${node.PK}** (${node.type}, ${node.freshness}) — ${summary} [${node.timestamp}, ref: ${node.rawRef}]`;
}

async function getCausalChain(nodeId: string): Promise<string> {
  const pk = `NODE#${nodeId}`;
  const queried = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
    }),
  );

  const items = (queried.Items ?? []) as Array<GraphNode | GraphEdge>;
  if (items.length === 0) {
    return `No node found for \`${pk}\`. Seeded demo IDs include \`pr-482\`, \`issue-217\`, \`message-discord-9930\`, \`message-discord-9931\`, \`message-discord-9932\`.`;
  }

  const metadata = items.find(isMetadataRow);
  const edges = items.filter((item): item is GraphEdge => !isMetadataRow(item));

  if (!metadata) {
    return `Node \`${pk}\` has ${edges.length} edge(s) but no METADATA row.`;
  }

  if (edges.length === 0) {
    return `# Why does \`${pk}\` exist?\n\n${describeNode(metadata)}\n\n_No outgoing edges found._`;
  }

  // EDGE#<target-id> -> target is <target-id>. Fetch all targets in parallel.
  const targetIds = [...new Set(edges.map((e) => e.SK.slice('EDGE#'.length)).filter(Boolean))];
  const fetched = await Promise.all(
    targetIds.map(async (targetId) => {
      try {
        const out = await ddb.send(
          new GetCommand({
            TableName: tableName,
            Key: { PK: `NODE#${targetId}`, SK: 'METADATA' },
          }),
        );
        return { targetId, node: out.Item as GraphNode | undefined };
      } catch {
        return { targetId, node: undefined };
      }
    }),
  );

  const byTarget = new Map(fetched.map((f) => [f.targetId, f.node]));

  const lines: string[] = [];
  lines.push(`# Why does \`${pk}\` exist?`);
  lines.push('');
  lines.push(describeNode(metadata));
  lines.push('');
  lines.push('## Causal chain');
  for (const edge of edges) {
    const targetId = edge.SK.slice('EDGE#'.length);
    const target = byTarget.get(targetId);
    const targetText = target ? describeNode(target) : `**NODE#${targetId}** (missing METADATA)`;
    lines.push(`- **${edge.relationship}** → ${targetText}`);
  }

  return lines.join('\n');
}

const server = new Server({ name: 'chadcontext', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'why_does_this_exist',
      description:
        'Explain why a code node exists by walking its ticket -> discussion -> PR chain. Accepts node_id like pr-482, issue-217, or message-discord-9931 (NODE# prefix optional).',
      inputSchema: {
        type: 'object',
        properties: {
          node_id: {
            type: 'string',
            description: 'Graph node id, e.g. pr-482 or message-discord-9931',
          },
        },
        required: ['node_id'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name !== 'why_does_this_exist') {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const nodeId = normalizeNodeId(args.node_id);
    if (!nodeId) {
      return {
        content: [{ type: 'text', text: 'node_id (string, e.g. pr-482) is required.' }],
        isError: true,
      };
    }
    const text = await getCausalChain(nodeId);
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Failed to walk graph: ${(err as Error).message}` }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('chadcontext MCP server started on stdio');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
