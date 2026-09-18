import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import 'dotenv/config';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const TABLE_NAME = process.env.TABLE_NAME || 'ChadContextGraph';

const server = new Server(
  { name: "chadcontext-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

function calculateStalenessScore(timestamp: string, lastReferenced: string | null): string {
  const nodeDate = new Date(timestamp).getTime();
  const refDate = lastReferenced ? new Date(lastReferenced).getTime() : nodeDate;
  const now = Date.now();
  
  const daysSinceCreation = (now - nodeDate) / (1000 * 60 * 60 * 24);
  const daysSinceReference = (now - refDate) / (1000 * 60 * 60 * 24);

  if (daysSinceCreation > 180 && daysSinceReference < 30) {
    return "STALE_BUT_VERIFIED (Old decision, but referenced recently)";
  }
  if (daysSinceCreation < 30) return "FRESH (< 30 days old)";
  if (daysSinceCreation < 90) return "WARM (1-3 months old)";
  return "STALE (> 3 months old, verify before trusting)";
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "why_does_this_exist",
    description: "Traces the causal chain of codebase decisions (Code -> PR -> Discord -> Ticket)",
    inputSchema: {
      type: "object",
      properties: {
        node_id: { type: "string", description: "The ID of the PR or Ticket (e.g., pr-482)" }
      },
      required: ["node_id"]
    }
  }]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "why_does_this_exist") {
    throw new Error("Tool not found");
  }

  const nodeId = `NODE#${request.params.arguments?.node_id}`;

  try {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": { S: nodeId } }
    });

    const response = await dbClient.send(command);
    const items = response.Items?.map(item => unmarshall(item)) || [];

    if (items.length === 0) {
      return { content: [{ type: "text", text: `No context found for ${nodeId}` }] };
    }

    const metadata = items.find(i => i.SK === "METADATA");
    const edges = items.filter(i => i.SK.startsWith("EDGE#"));

    const freshness = calculateStalenessScore(
      metadata?.timestamp || new Date().toISOString(), 
      metadata?.last_referenced || null
    );

    let output = `### Context for ${nodeId}\n`;
    output += `**Freshness:** ${freshness}\n`;
    output += `**Summary:** ${metadata?.summary || 'No summary generated yet.'}\n\n`;
    output += `**Causal Links:**\n`;
    
    edges.forEach(edge => {
      output += `- ${edge.relationship.toUpperCase()}: ${edge.SK.replace('EDGE#', '')}\n`;
    });

    return { content: [{ type: "text", text: output }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error querying graph: ${error.message}` }] };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
