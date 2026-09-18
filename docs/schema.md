# DynamoDB Schema — ChadContextGraph

> Status: verified against `infra/lib/data-stack.ts`, `shared/types.ts`, and
> `lambdas/github-webhook/` (all claims checked). Shared with Person 2 — frozen
> on their confirm. See `docs/01-spec.md` §8 and `docs/02-tech-stack.md` §4.

## Table

- Name: `ChadContextGraph`, on-demand (`PAY_PER_REQUEST`), removal `DESTROY`.
- Partition key: `PK` (String). Sort key: `SK` (String).
- Defined in `infra/lib/data-stack.ts`.

## Key patterns

- Node metadata: `PK = NODE#<type>-<id>`, `SK = METADATA`.
  - Example: `PK = NODE#pr-482`, `SK = METADATA` →
    `{ type: "PR", summary, freshness: "fresh", timestamp, rawRef }`.
- Edge: `PK = NODE#<source-id>`, `SK = EDGE#<target-id>`, with
  `relationship: resolves | discussed_in | caused_by | references`.
  - Example: `PK = NODE#pr-482`, `SK = EDGE#ticket-217` → `{ relationship: "resolves" }`.
  - Example: `PK = NODE#pr-482`, `SK = EDGE#discord-9931` → `{ relationship: "discussed_in" }`.

## Node / edge types (mirrors `shared/types.ts` — that file wins on conflict)

- Node types: `PR | ISSUE | MESSAGE | TRANSCRIPT_CHUNK`.
- Edge relationships: `resolves | discussed_in | caused_by | references`.
- `freshness: fresh | aging | stale`; `rawRef` = S3 key of source content.

## GSI1 (reverse lookups)

- Index `GSI1`: partition key `SK`, sort key `PK`, projection `ALL`.
- Serves: "all PRs linked to ticket #217" →
  `Query GSI1 where SK = EDGE#ticket-217` returns every edge row pointing at
  that ticket; each row's `PK` gives the source node to fetch.

## S3 ingestion contract (agreed with Person 2)

Shape: `{source, type, raw_content, timestamp, ids}` (`RawIngestRecord`).
Real example as written by `lambdas/github-webhook/`:

```json
{
  "source": "github",
  "type": "pull_request",
  "raw_content": "{\"event\":\"pull_request\",\"summary\":\"PR 482 closed: Add retry delay\",\"ids\":{\"repo\":\"acme/shop\",\"pr\":\"482\",\"sha\":\"abc123def456\",\"issue\":\"217\"}}",
  "timestamp": "2026-09-18T00:00:00.000Z",
  "ids": { "repo": "acme/shop", "pr": "482", "sha": "abc123def456", "issue": "217" }
}
```

Stored at `raw/github/<event>/<timestamp>-<repo-with-dashes>.json`.

## Query patterns (what Person 2's MCP needs)

1. Forward chain: `Query PK = NODE#pr-482` → metadata row + all edge rows in
   one round trip. Walk each edge's target for the full
   ticket → discussion → PR chain.
2. Reverse lookup: `Query GSI1 SK = EDGE#ticket-217` → all edges into that
   ticket, then fetch each source `PK` for summaries.
