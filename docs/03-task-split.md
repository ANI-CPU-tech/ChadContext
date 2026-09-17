ChadContext — Detailed Task Split: Person 1 vs Person 2

Structured so each person can work independently for long stretches, with explicit sync points to avoid one person blocking the other. Ownership boundaries are drawn along infrastructure/backend (Person 1) vs integrations/frontend/data (Person 2) — adjust the names to your actual strengths, but keep the boundary itself, since it minimizes shared-file conflicts when vibecoding with AI tools.

Day 1 — Foundation & Ingestion

Goal by end of day: Both ingestion paths (GitHub + Discord) are writing raw data into S3, and the DynamoDB graph schema exists and is agreed on.

Person 1 — Backend spine
Set up AWS project skeleton: API Gateway, Lambda , IAM roles, S3 bucket for raw ingestion
Build the GitHub webhook receiver: API Gateway endpoint → Lambda → drops thin pointer event to S3 (PR merged, issue opened/linked)
Design the DynamoDB single-table schema by hand (not AI-delegated) — this is the single highest-leverage task of the whole hackathon, since both Day 2 workstreams depend on it:
Node types: PR, ISSUE, MESSAGE, TRANSCRIPT_CHUNK
Edge types: resolves, discussed_in, caused_by, references
PK/SK pattern (from spec section 8) + at least one GSI for reverse lookups (e.g., "find all PRs linked to this ticket")
Write the schema doc/README and share it with Person 2 by midday — this is the hard sync point
Person 2 — Ingestion + data sources
Set up Discord bot: read message history from a channel, export to S3 in a consistent JSON shape
Build the transcript upload endpoint: simple .txt/.vtt → S3 (API Gateway + Lambda or direct S3 presigned upload)
Line up real demo data now, not Day 3 — this is explicitly time-sensitive:
Pick the real GitHub repo you'll use (your own past project ideally)
Pull or fabricate a realistic Discord export tied to real PRs in that repo
Confirm both are ready to ingest tomorrow
Once Person 1 shares the schema (midday sync), start writing Discord messages into DynamoDB in that shape
Sync point (midday/EOD)
Person 1 shares finalized schema
Confirm both ingestion paths write to S3 in a shape Bedrock can parse tomorrow (agree on a minimal JSON contract: {source, type, raw_content, timestamp, ids})
End of Day 1 checklist
 GitHub webhook → Lambda → S3 working
 Discord export → S3 working
 Transcript upload → S3 working
 DynamoDB schema finalized and documented
 Demo dataset (real repo + real/realistic Discord export) locked in
Day 2 — Intelligence Layer

Goal by end of day: A PR merge triggers the full pipeline (extract → correlate → score → store), and the MCP server can answer a query end-to-end using real data from Day 1.

Person 1 — Pipeline orchestration
Build the EventBridge rule: new S3 object → triggers Step Functions execution
Build the Step Functions state machine, state by state:
State 1: AgentCore Gateway → GitHub MCP server → pulls full PR (title, diff, linked issue)
State 2: Nova Micro → entity extraction (ticket IDs, people, topic) from PR + Discord content
State 3: Knowledge Base + S3 Vectors → semantic match against existing nodes
State 4: Nova Pro → writes causal summary + staleness score
State 5: write result as nodes/edges into DynamoDB
Test the full chain against one real PR from your demo repo — this is your first real end-to-end proof, get it working today, not Day 3
Person 2 — MCP server + query logic
Build the MCP server: exposes one tool, e.g. why_does_this_exist(query)
Query logic: given a node ID or keyword, look it up in DynamoDB, walk the edges via the GSI, return the connected chain (ticket + discussion + PR + summary)
Staleness scoring logic: recency decay function + "still referenced recently" boost — this can be a Bedrock prompt (Nova Micro) or plain logic, whichever is faster to ship
Once Person 1's pipeline produces its first real stored node (sync point), connect the MCP server to real data and test the actual "why does this exist" query from inside Claude Code or Cursor
Sync point (afternoon)
Person 1 confirms first real node/edge is written to DynamoDB from the live pipeline
Person 2 immediately tests MCP query against it — this is the moment you find out if the schema actually supports the query pattern you need. Fix fast if not.
End of Day 2 checklist
 PR merge → full pipeline → DynamoDB, working end-to-end on at least one real example
 MCP server returns a real, correct "why" answer when queried from an AI coding tool
 Staleness score showing up on stored nodes
Day 3 — Dashboard, Write-back, Video

Goal by end of day: deployed URL, visual dashboard, working demo, video recorded and edited.

Person 1 — Dashboard + write-back
Amplify Hosting setup, deploy a basic page early (get the URL live ASAP — Ship It requires it)
Graph visualization (react-force-graph or similar) reading from DynamoDB via API Gateway — color-coded by freshness score
Gated write-back flow: propose_action tool → Bedrock Guardrails check → pending action stored in DynamoDB → shows on dashboard with a confirm button → on click, posts the actual GitHub comment
Cognito auth — only if time allows; treat as optional/cut-able
Person 2 — Demo data, testing, video production
Run the full pipeline against 3–5 more real PRs from the demo repo so the dashboard graph looks populated, not empty/sparse
Full integration pass: click through the actual demo flow yourself as if you were a judge, catch anything broken
Write the video script tightly against the structure in spec section 11:
0:00–0:30 — problem (confusing code, no context)
0:30–2:00 — live query in Claude Code/Cursor via MCP server, instant reasoned answer
2:00–3:00 — dashboard graph + Step Functions execution + architecture diagram
Record, then both review together before final cut
Sync point (early-mid afternoon)
Hard cutoff: freeze new features by early-to-mid afternoon. Everything after this is data seeding, bug fixing, and video — not new code. This is the point most hackathon teams blow past and then scramble on the video with 45 minutes left.
Ownership summary (for quick reference)
Layer	Owner
GitHub webhook, DynamoDB schema, Step Functions pipeline, Bedrock orchestration	Person 1
Discord/transcript ingestion, MCP server, staleness logic, demo data, video	Person 2
Dashboard + write-back	Person 1
Integration testing + video production	Person 2
