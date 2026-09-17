// Single source of truth for node/edge shapes.
// Both Person 1's pipeline output and Person 2's MCP query logic import from here.
// See docs/02-tech-stack.md §4.

export type NodeType = 'PR' | 'ISSUE' | 'MESSAGE' | 'TRANSCRIPT_CHUNK';
export type EdgeRelationship = 'resolves' | 'discussed_in' | 'caused_by' | 'references';
export type Freshness = 'fresh' | 'aging' | 'stale';

export interface GraphNode {
  PK: `NODE#${string}`;
  SK: 'METADATA';
  type: NodeType;
  summary?: string;
  freshness: Freshness;
  timestamp: string;
  rawRef: string; // S3 key of source content
}

export interface GraphEdge {
  PK: `NODE#${string}`;
  SK: `EDGE#${string}`;
  relationship: EdgeRelationship;
  createdAt: string;
}

// S3 ingestion contract agreed at the Day 1 sync (docs/03-task-split.md).
export interface RawIngestRecord {
  source: 'github' | 'discord' | 'transcript';
  type: string;
  raw_content: string;
  timestamp: string;
  ids: Record<string, string>;
}
