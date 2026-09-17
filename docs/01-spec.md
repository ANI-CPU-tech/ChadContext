ChadContext — Full Project Specification
1. One-Liner

An AI-powered team context engine that answers "why does this code exist" by building a causal graph linking tickets → team discussions → code changes → outcomes, scoring each link by freshness, and exposing it as an MCP server any AI coding assistant can query.

2. Hackathon Context
Credits: $100 AWS credit + standard new-account credits
Track: Ship It — must be deployed on real AWS with a live URL; AWS usage is mandatory to win any prize; grand prize decided on this track
Judging criteria: Idea/Impact, Built on AWS, Learning, Execution, Demo video
3. Problem Statement

Software teams lose enormous time re-discovering why their own code looks the way it does. A function has a strange 3-second sleep, a config flag defaults to a weird value, an API returns null instead of throwing — and the reasoning behind it lives scattered across a Slack/Discord thread that's since scrolled away, a ticket with a vague title, and a PR whose description says "fix bug" with no context.

This is the daily reality of onboarding, debugging, and maintaining any codebase older than a few months. New engineers spend their first weeks reverse-engineering decisions instead of building. Senior engineers become tribal-knowledge bottlenecks. When someone leaves, that reasoning leaves with them.

Existing tools don't fix this. Glean, Onyx, and Sourcegraph are search tools — they index Slack, tickets, and code as separate flat documents and return isolated hits. None of them connect a PR to the discussion that caused it to the ticket that requested it, as one traceable chain. None of them account for staleness — a decision from a year ago and a PR from yesterday are treated with equal authority.

The unsolved problem: nobody has built the causal thread connecting "why code exists," across code, chat, and tickets, with a sense of what's still true.

4. Solution Approach

ChadContext ingests code activity, team chat, and meeting notes; automatically links them into a causal graph (ticket → discussion → code change → outcome); scores each link by freshness; and exposes the whole thing as an MCP server so any AI coding assistant (Claude Code, Cursor) can answer "why is this code the way it is" with the actual reasoning chain — not disconnected search results.

Pipeline (end to end):

Ingest — GitHub webhooks pull PRs/commits/issues; a Discord bot pulls chat history; raw content lands in S3.
Extract — Bedrock (Nova Micro) reads each PR, message, and transcript chunk and pulls structured entities: ticket references, decisions, people, timing.
Correlate — Bedrock Knowledge Bases + S3 Vectors do semantic matching (not just keyword matching) to link PRs to the Discord threads and tickets they relate to, even with no shared vocabulary.
Score — Bedrock (Nova Pro) writes a human-readable causal summary and assigns a staleness score based on recency and whether the code has been touched since.
Store — result written as nodes + edges in DynamoDB (single-table design).
Serve — MCP server exposes one query surface: ask "why does this function exist" from Claude Code/Cursor, get the real chain back.
Act (guarded) — agent can propose a write-back (comment on a PR, flag a doc as stale) via Bedrock Guardrails; a human must confirm before anything actually posts.
5. Core Features → Gaps They Solve
Feature	Gap in existing tools (Glean/Onyx/Sourcegraph)
Causal chain, not flat search	They return isolated hits, not a walkable ticket→discussion→PR→outcome chain
Staleness-aware answers	They treat a 14-month-old decision the same as yesterday's
Meeting transcripts folded into the same graph	They treat transcripts as a separate silo, not connected to code/chat
Gated write-back	They're read-only; ChadContext can propose actions but requires human confirmation
6. Three-Source Ingestion Model
GitHub Issues — the formal ticket ("what needs fixing"). Chosen over Jira: already authenticated via the same GitHub integration used for PRs, natively linked to PRs (Fixes #217 is directly parseable), zero extra OAuth/API/rate-limit setup — saves real time in a 3-day build.
GitHub PRs/commits — the formal fix ("what changed").
Discord — the informal reasoning layer. Captures the back-and-forth argument (e.g., "we tried 1 second first, logs showed it wasn't enough") that no ticket tool records. Purely a conversation-ingestion source, not a ticket system.
7. AWS Architecture
Service	Role
API Gateway + Lambda	GitHub webhook receiver, MCP server endpoint, write-back action endpoint
S3	Landing zone for raw ingested content (PR events, Discord exports, transcripts) before processing
EventBridge	Triggers the pipeline on new S3 objects; decouples ingestion from processing
Step Functions	Orchestrates the multi-step Bedrock pipeline: extract → correlate → score → store
Amazon Bedrock — AgentCore Gateway	Calls GitHub's MCP server for full PR data (title, diff, linked issues) — no custom GitHub API code needed
Amazon Bedrock — Nova Micro	Cheap/fast entity extraction, runs on every ingested PR/message
Amazon Bedrock — Knowledge Bases + S3 Vectors	Semantic matching between PRs, tickets, and Discord messages
Amazon Bedrock — Nova Pro	Writes the causal summary + assigns staleness score
Amazon Bedrock — Guardrails	Validates proposed write-back actions before they reach a human for confirmation
DynamoDB	Single-table graph store: nodes (PR, message, ticket, transcript chunk) + edges (resolves, discussed_in, caused_by, etc.)
Amplify Hosting	Dashboard: visual graph (color-coded by freshness) + write-back confirmation UI
Cognito	Basic multi-user auth
8. Data Model (DynamoDB, single-table)

Pattern demonstrated on a real example (PR #482, a payment-retry fix):

PK: NODE#pr-482        SK: METADATA           → { summary, freshness: "fresh", timestamp }
PK: NODE#pr-482        SK: EDGE#ticket-217     → { relationship: "resolves" }
PK: NODE#pr-482        SK: EDGE#discord-9931   → { relationship: "discussed_in" }
Node types: PR, ISSUE, MESSAGE, TRANSCRIPT_CHUNK
Edge relationships: resolves, discussed_in, caused_by, references (extend as needed)
One query by node ID (e.g., NODE#pr-482) returns the full connected chain in a single read.
(Full PK/SK design with GSIs for reverse lookups and the three Bedrock prompt templates — extraction, correlation, staleness scoring — can be generated as a follow-up if you want them before coding starts.)
9. End-to-End Example (also the demo script backbone)
Ticket #217 filed: "Payments failing intermittently under load."
Team debates it in Discord — considers a 1-second delay, rules it out based on logs.
PR #482 merged, adding time.sleep(3) before retry.
GitHub webhook fires → Lambda drops a thin pointer event to S3.
New S3 object triggers EventBridge → starts Step Functions execution.
AgentCore Gateway pulls full PR data via GitHub MCP; separately pulls the relevant Discord window.
Nova Micro extracts structured entities from both.
Knowledge Base + S3 Vectors semantically match PR #482 to ticket #217 and the Discord thread.
Nova Pro writes: "This 3-second delay was added to fix intermittent payment failures under load (ticket #217), following a Discord discussion on Sept 12 where the team ruled out a 1-second delay as insufficient." — plus a staleness score.
Result stored as nodes/edges in DynamoDB.
Weeks later, a new teammate in Claude Code asks "why does this retry have a 3-second delay?" → MCP server queries DynamoDB, walks the edges, returns the pre-reasoned answer in one call.
(Optional) Agent proposes a "still relevant" comment on the PR → Guardrails checks it → shows up on the Amplify dashboard with a confirm button → human clicks to actually post.
