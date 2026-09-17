ChadContext — Detailed Tech Stack & Implementation Approach

Structured for direct use as AI coding agent context (Claude Code / Cursor). Pick TypeScript as the primary language everywhere possible — it minimizes context-switching for your AI tool across Lambda, MCP server, and frontend, which matters a lot at 3-day vibecoding speed.

1. Language & Framework Decisions
Component	Choice	Why
Lambda functions	TypeScript (Node.js 20.x)	One language across the whole backend; AWS SDK v3 has first-class TS types, which makes AI-generated code more reliably correct
IaC	AWS CDK (TypeScript)	Same language as the app code; faster to iterate than raw CloudFormation, more reproducible than console clicking, and AI tools generate CDK constructs well
MCP server	TypeScript, @modelcontextprotocol/sdk	Official SDK, well-documented, matches your Lambda language
Discord ingestion	TypeScript, discord.js	Keeps ingestion in the same language as everything else
Frontend/dashboard	React + Vite, deployed via AWS Amplify Hosting	Fast local dev loop, Amplify Hosting deploys static builds trivially
Graph visualization	react-force-graph-2d	Fast to wire up, good default look, handles freshness color-coding easily via node props

Avoid mixing in Python unless a specific Bedrock or Discord library genuinely needs it — the cost of context-switching outweighs any marginal library advantage here.

2. Repo Structure (monorepo)
chadcontext/
├── infra/                    # AWS CDK app
│   ├── bin/chadcontext.ts
│   ├── lib/
│   │   ├── ingestion-stack.ts     # API GW + Lambda + S3
│   │   ├── pipeline-stack.ts      # EventBridge + Step Functions + Bedrock IAM
│   │   ├── data-stack.ts          # DynamoDB table + GSIs
│   │   ├── mcp-stack.ts           # MCP server Lambda + API GW
│   │   └── frontend-stack.ts      # Amplify + Cognito
├── lambdas/
│   ├── github-webhook/
│   ├── discord-ingest/
│   ├── transcript-upload/
│   ├── extract-entities/          # Step Functions state: Nova Micro
│   ├── correlate-semantic/        # Step Functions state: Knowledge Base query
│   ├── score-and-store/           # Step Functions state: Nova Pro + DynamoDB write
│   ├── mcp-server/                # the MCP tool endpoint
│   └── writeback-action/          # Guardrails-checked write-back
├── stepfunctions/
│   └── pipeline.asl.json          # state machine definition (or defined inline in CDK)
├── frontend/
│   ├── src/
│   │   ├── components/GraphView.tsx
│   │   ├── components/WritebackPanel.tsx
│   │   └── App.tsx
│   └── package.json
├── shared/
│   ├── types.ts                   # Node/Edge TypeScript interfaces, shared across lambdas
│   └── dynamo-client.ts           # single shared DocumentClient instance
└── docs/
    └── schema.md                  # Person 1's DynamoDB schema doc from Day 1

Keeping shared/types.ts as the single source of truth for node/edge shapes is what prevents Person 1's pipeline output and Person 2's MCP query logic from drifting apart — both should import from it.

3. AWS Services — Specific Packages & Config
Service	Key package(s)	Notes
API Gateway	CDK aws-cdk-lib/aws-apigatewayv2	Use HTTP API (not REST API) — cheaper, simpler, sufficient for webhook + MCP endpoints
Lambda	aws-cdk-lib/aws-lambda-nodejs (NodejsFunction construct)	Auto-bundles TS with esbuild, no manual build step needed
S3	@aws-sdk/client-s3	One bucket, prefixed by source: raw/github/, raw/discord/, raw/transcripts/
EventBridge	aws-cdk-lib/aws-events + S3 EventBridge notifications	Enable EventBridge notifications directly on the bucket (S3 → EventBridge, no extra SNS/SQS needed)
Step Functions	aws-cdk-lib/aws-stepfunctions + aws-stepfunctions-tasks	Define as CDK constructs, not hand-written ASL — easier for AI tool to modify iteratively
DynamoDB	@aws-sdk/client-dynamodb + @aws-sdk/lib-dynamodb (DocumentClient wrapper)	Single table, on-demand billing mode (no capacity planning needed for a hackathon)
Bedrock	@aws-sdk/client-bedrock-runtime, @aws-sdk/client-bedrock-agent-runtime	Use the Converse API (ConverseCommand), not the older InvokeModel — simpler message format, works across model families
Bedrock Knowledge Bases	@aws-sdk/client-bedrock-agent-runtime (RetrieveCommand)	Backed by S3 Vectors as the vector store
Bedrock Guardrails	configured via console/CDK, invoked via guardrailConfig param on Converse calls	
Amplify Hosting	Amplify Console (Git-connected) or aws-cdk-lib/aws-amplify	Git-connected is faster for a hackathon — push to main, auto-deploys
Cognito	aws-cdk-lib/aws-cognito + aws-amplify (frontend)	User Pool + Identity Pool; treat as cuttable if Day 3 is tight
Bedrock model IDs to use
Nova Micro — amazon.nova-micro-v1:0 — entity extraction (cheap, runs per-PR/message)
Nova Pro — amazon.nova-pro-v1:0 — causal summary + staleness scoring (runs per correlated cluster, less frequent)
Embeddings for Knowledge Base — Titan Text Embeddings v2 (amazon.titan-embed-text-v2:0), configured at the Knowledge Base level, not called directly
4. DynamoDB Access Pattern (implementation detail)

Single table, e.g. ChadContextGraph:

typescript
// shared/types.ts
interface GraphNode {
  PK: `NODE#${string}`;
  SK: 'METADATA';
  type: 'PR' | 'ISSUE' | 'MESSAGE' | 'TRANSCRIPT_CHUNK';
  summary?: string;
  freshness: 'fresh' | 'aging' | 'stale';
  timestamp: string;
  rawRef: string; // S3 key of source content
}

interface GraphEdge {
  PK: `NODE#${string}`;
  SK: `EDGE#${string}`;
  relationship: 'resolves' | 'discussed_in' | 'caused_by' | 'references';
  createdAt: string;
}
GSI1: SK as partition key, PK as sort key — enables "find everything that has an edge of type X" or reverse lookups (e.g., "what PRs reference ticket #217" when you only have the ticket ID).
Query pattern for the MCP server's core tool call: single Query on PK = NODE#pr-482 returns metadata + all edges in one round trip — this is the pattern that makes the whole product fast enough to feel instant in the demo video.
5. MCP Server — Implementation Approach

This is the part with the most hidden risk, so be deliberate here.

Two viable approaches — pick based on time remaining on Day 2:

Option A — Remote MCP server (more impressive, more risk)
Deploy the MCP server as a Lambda behind API Gateway using @modelcontextprotocol/sdk's StreamableHTTPServerTransport in stateless mode. Claude Code/Cursor connect to it as a remote MCP server via URL. This is the "real" architecture and looks better in the video, but remote MCP auth/streaming on Lambda has more moving parts to debug under time pressure.

Option B — Thin local MCP wrapper (safer, recommended default)
Ship a small local MCP server (stdio transport) that does nothing but call your already-deployed API Gateway endpoint and return the result. Claude Code/Cursor run it locally with zero auth complexity. Still demonstrates the real AWS pipeline (that's where all the actual work happens) — the MCP layer itself is just a thin, reliable pass-through.

Recommendation: build Option B first since it de-risks the demo video recording session; upgrade to Option A only if Day 2 finishes early and Day 3 has slack. Either way, the tool definition is the same:

typescript
server.tool(
  "why_does_this_exist",
  { query: z.string().describe("code, function, or file to ask about") },
  async ({ query }) => {
    const result = await fetch(`${API_BASE_URL}/query?q=${encodeURIComponent(query)}`);
    const data = await result.json();
    return { content: [{ type: "text", text: data.summary }] };
  }
);
6. Step Functions Pipeline (CDK construct shape)

Define as chained CDK task constructs rather than raw ASL JSON — much easier for an AI coding agent to modify one state at a time without breaking the rest:

typescript
const extractEntities = new tasks.LambdaInvoke(this, 'ExtractEntities', {
  lambdaFunction: extractFn,
  outputPath: '$.Payload',
});

const correlateSemantic = new tasks.LambdaInvoke(this, 'CorrelateSemantic', {
  lambdaFunction: correlateFn,
  outputPath: '$.Payload',
});

const scoreAndStore = new tasks.LambdaInvoke(this, 'ScoreAndStore', {
  lambdaFunction: scoreFn,
  outputPath: '$.Payload',
});

const definition = extractEntities.next(correlateSemantic).next(scoreAndStore);

new sfn.StateMachine(this, 'ChadContextPipeline', { definitionBody: sfn.DefinitionBody.fromChainable(definition) });

Each Lambda stays small and independently testable — you can unit-test extractFn against a canned PR payload without running the whole state machine, which matters when three people (well, two, plus AI) are iterating on different states simultaneously.

7. Frontend Stack
React 18 + Vite — fast dev server, minimal config
react-force-graph-2d — renders nodes/edges from a single GET /graph API call; color nodes by freshness field directly from DynamoDB
aws-amplify + @aws-amplify/ui-react — handles Cognito auth wiring with prebuilt components (skip custom auth UI entirely, use <Authenticator> if you keep Cognito in scope)
Fetch pattern: dashboard calls API Gateway endpoints directly (/graph, /pending-actions) — no GraphQL layer needed at this scale, keep it REST/HTTP for speed
8. Local Development & Testing Approach

Given there's no live demo — the recorded video is the only proof anything works — treat "does this survive being recorded" as the actual test bar:

Seed script: a standalone script (scripts/seed-demo-data.ts) that pushes your real demo repo's PR history + Discord export through the pipeline once, ahead of recording. Never rely on live ingestion happening correctly during the recording session itself.
Local Lambda testing: use sam local invoke or plain Jest unit tests with mocked AWS SDK clients (aws-sdk-client-mock) for each Lambda in isolation — faster iteration than deploying for every change.
Dry-run the MCP query against seeded data the day before recording, not the day of.
Record the video against the seeded, already-verified state — don't ingest live on camera.
9. Secrets & Environment Config
GitHub webhook secret, Discord bot token → AWS Secrets Manager, referenced by Lambda via SecretsManagerClient, not hardcoded or in .env committed to the repo
API base URL, table name, bucket name → Lambda environment variables set via CDK (environment: {...} on each NodejsFunction), so nothing is hardcoded across environments
10. Quick-Reference Package List
json
{
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.x",
    "@aws-sdk/lib-dynamodb": "^3.x",
    "@aws-sdk/client-s3": "^3.x",
    "@aws-sdk/client-bedrock-runtime": "^3.x",
    "@aws-sdk/client-bedrock-agent-runtime": "^3.x",
    "@aws-sdk/client-secrets-manager": "^3.x",
    "@modelcontextprotocol/sdk": "^1.x",
    "discord.js": "^14.x",
    "zod": "^3.x",
    "react-force-graph-2d": "^1.x",
    "aws-amplify": "^6.x",
    "@aws-amplify/ui-react": "^6.x"
  },
  "devDependencies": {
    "aws-cdk-lib": "^2.x",
    "aws-cdk": "^2.x",
    "aws-sdk-client-mock": "^4.x",
    "typescript": "^5.x",
    "vite": "^5.x"
  }
}
