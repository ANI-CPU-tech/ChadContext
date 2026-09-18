import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import type { ExtractedEntities } from '../extract-entities/index.js';

// Step 2 of the pipeline: Knowledge Base semantic match.
// In:  extract's output ({ bucketName, key, entities, ...passthrough }).
// Out: same fields + { matches: [{ nodeId, score }] }. See docs/02-tech-stack.md §6.
export interface SemanticMatch {
  nodeId: string;
  score: number;
}

const kb = new BedrockAgentRuntimeClient({});

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asEntities(value: unknown): ExtractedEntities {
  const rec = asRecord(value) ?? {};
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    ticketIds: strArr(rec.ticketIds),
    people: strArr(rec.people),
    topics: strArr(rec.topics),
    linkedDiscordRefs: strArr(rec.linkedDiscordRefs),
  };
}

export const handler = async (event: unknown): Promise<Record<string, unknown>> => {
  const input = asRecord(event) ?? {};
  const knowledgeBaseId = process.env.KNOWLEDGE_BASE_ID;
  if (!knowledgeBaseId || knowledgeBaseId === 'TODO-create-kb') {
    throw new Error('correlate-semantic: KNOWLEDGE_BASE_ID is not configured');
  }

  const entities = asEntities(input.entities);
  const queryText = [...entities.topics, ...entities.ticketIds.map((t) => `ticket ${t}`)].join(' ');
  if (!queryText.trim()) throw new Error('correlate-semantic: nothing to query on');

  const out = await kb.send(
    new RetrieveCommand({
      knowledgeBaseId,
      retrievalQuery: { text: queryText },
      retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: 5 } },
    }),
  );

  const matches: SemanticMatch[] = (out.retrievalResults ?? [])
    .map((r) => {
      const meta = r.metadata ?? {};
      const nodeId =
        typeof meta.nodeId === 'string'
          ? meta.nodeId
          : asString((meta as Record<string, unknown>).NODE_ID);
      if (!nodeId) return undefined;
      return { nodeId, score: r.score ?? 0 };
    })
    .filter((m): m is SemanticMatch => m !== undefined);

  return { ...input, matches };
};
