# ChadContext — TODO (Person 1 + handoffs to Person 2)

Source of truth: `docs/01-spec.md` (what), `docs/02-tech-stack.md` (how), `docs/03-task-split.md` (who/when).

## Task 1 — Init layout [x]
- [x] Monorepo folders per `docs/02-tech-stack.md` §2 (`infra/`, `lambdas/`, `shared/`, `frontend/`, `scripts/`, `stepfunctions/`)
- [x] `shared/types.ts` real interfaces (single source of truth)
- [x] Person 2 dirs reserved as `.gitkeep` only (`discord-ingest/`, `transcript-upload/`, `mcp-server/`)

## Day 1 — Foundation & Ingestion (P1)
### Morning — skeleton + webhook
- [x] `infra/lib/data-stack.ts`: DynamoDB `ChadContextGraph`, on-demand, GSI1 (SK/PK flipped) — synth verified
- [x] `infra/lib/ingestion-stack.ts`: S3 bucket `raw/github/ raw/discord/ raw/transcripts/` + EventBridge notifications on, HTTP API `POST /webhook/github` — synth verified (EventBridgeConfiguration, route, least-privilege IAM)
- [ ] `lambdas/github-webhook/`: verify HMAC via Secrets Manager → `PutObject` thin pointer `{source,type,raw_content,timestamp,ids}`
- [ ] `cdk synth` clean, Jest + `aws-sdk-client-mock` on canned PR payload
### Midday sync (HARD) — hand-write, not AI-delegated
- [ ] `docs/schema.md`: PK/SK, GSI1, node/edge types, S3 contract, query patterns — share with Person 2
### Afternoon
- [ ] Deploy skeleton, prove `POST /webhook/github` → S3 object lands
- [ ] EOD: webhook→S3 working, schema frozen, demo repo choice locked

## Day 2 — Intelligence layer (P1)
- [ ] `infra/lib/pipeline-stack.ts`: S3 → EventBridge → Step Functions chain (`extractFn` Nova Micro → `correlateFn` KB Retrieve → `scoreFn` Nova Pro + write)
- [ ] `lambdas/extract-entities/`, `correlate-semantic/`, `score-and-store/`: small independently testable handlers (Converse API, not InvokeModel)
- [ ] Prove ONE real PR → DynamoDB `NODE#pr-xxx` + edges (Day 2 PM sync → Person 2 tests MCP query against it)

## Day 3 — Dashboard + write-back (P1)
- [ ] Amplify deploy early (live URL = Ship It requirement)
- [ ] `frontend/src/components/GraphView.tsx`: `react-force-graph-2d` from `GET /graph`, color by `freshness`
- [ ] `frontend/src/components/WritebackPanel.tsx` + `lambdas/writeback-action/`: `propose_action` → Guardrails `guardrailConfig` → pending in DynamoDB → confirm posts GitHub comment
- [ ] Cognito only if slack — cuttable

## Person 2 reserves (stubs only, do not implement)
- [ ] `lambdas/discord-ingest/`, `lambdas/transcript-upload/`, `lambdas/mcp-server/` (`.gitkeep`)

## Verification (record-ready bar, per §8)
- [ ] `scripts/seed-demo-data.ts` pushes real PR history + Discord export pre-recording
- [ ] MCP query dry-run against seeded data day before recording, never live-ingest on camera
- [ ] Freeze features early-mid Day 3 afternoon
