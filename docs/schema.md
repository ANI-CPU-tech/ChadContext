# DynamoDB Schema — ChadContextGraph (TODO: hand-write by midday Day 1)

> Highest-leverage task of the hackathon. Write by hand, don't AI-delegate.
> See `docs/01-spec.md` §8 and `docs/02-tech-stack.md` §4.

## Table

- Name: `ChadContextGraph`, on-demand billing.
- TODO: PK/SK definitions.

## GSI1 (reverse lookups, e.g. "all PRs linked to ticket #217")

- TODO: SK as partition key, PK as sort key.

## Node / edge types

- Node types: `PR | ISSUE | MESSAGE | TRANSCRIPT_CHUNK`
- Edge relationships: `resolves | discussed_in | caused_by | references`
- TODO: confirm against `shared/types.ts`.

## S3 ingestion contract (agreed with Person 2)

`{source, type, raw_content, timestamp, ids}` — TODO: example record.

## Query patterns

- MCP core: single `Query PK = NODE#<id>` returns metadata + all edges.
- TODO: reverse-lookup example via GSI1.
