Graph ticket->discussion->PR->outcome. See docs/01-spec.md.
Stack: TS Node20, CDK, Bedrock Nova Micro/Pro + Titan Embeddings, DynamoDB single-table ChadContextGraph. See docs/02-tech-stack.md.
Split: Person1 webhook/schema/pipeline/dashboard, Person2 ingestion/MCP/demo/video. See docs/03-task-split.md.
Rules: import shared/types.ts, PK=NODE#<id> Query returns chain, MCP Option B stdio default, REST /graph, secrets in Secrets Manager.
Syncs: schema Day1 midday, first node->MCP test Day2 PM.
