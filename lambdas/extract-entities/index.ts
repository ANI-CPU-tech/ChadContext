import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { RawIngestRecord } from '../../shared/types.js';

// Step 1 of the pipeline: Nova Micro entity extraction.
// In:  { bucketName, key } (+ passthrough from the EventBridge target).
// Out: same fields + { entities }. See docs/02-tech-stack.md §6.
export const NOVA_MICRO_ID = 'amazon.nova-micro-v1:0';

export interface ExtractedEntities {
  ticketIds: string[];
  people: string[];
  topics: string[];
  linkedDiscordRefs: string[];
}

const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({});

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

function parseEntitiesJson(text: string): ExtractedEntities {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const parsed: unknown = JSON.parse((fenced?.[1] ?? text).trim());
  const rec = asRecord(parsed);
  if (!rec) throw new Error('extract-entities: model did not return a JSON object');
  return {
    ticketIds: strArray(rec.ticketIds),
    people: strArray(rec.people),
    topics: strArray(rec.topics),
    linkedDiscordRefs: strArray(rec.linkedDiscordRefs),
  };
}

function responseText(out: ConverseCommandOutput): string {
  const blocks = out.output?.message?.content ?? [];
  const text = blocks.map((b) => ('text' in b ? (b.text ?? '') : '')).join('');
  if (!text.trim()) throw new Error('extract-entities: empty model response');
  return text;
}

export const handler = async (event: unknown): Promise<Record<string, unknown>> => {
  const input = asRecord(event) ?? {};
  const bucketName = asString(input.bucketName);
  const key = asString(input.key);
  if (!bucketName || !key) throw new Error('extract-entities: missing bucketName/key');

  const obj = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
  const body = await obj.Body?.transformToString();
  if (!body) throw new Error(`extract-entities: empty S3 object ${key}`);
  const pointer = asRecord(JSON.parse(body)) as RawIngestRecord | undefined;
  if (!pointer) throw new Error(`extract-entities: pointer at ${key} is not an object`);

  const out = await bedrock.send(
    new ConverseCommand({
      modelId: NOVA_MICRO_ID,
      inferenceConfig: { maxTokens: 1024, temperature: 0 },
      messages: [
        {
          role: 'user',
          content: [
            {
              text: [
                'Extract structured entities from this ingested record.',
                'Reply with JSON ONLY, no prose, no fences, matching:',
                '{"ticketIds": string[], "people": string[], "topics": string[], "linkedDiscordRefs": string[]}',
                'ticketIds are issue numbers WITHOUT the # (e.g. "217").',
                `Record: ${pointer.raw_content}`,
              ].join('\n'),
            },
          ],
        },
      ],
    }),
  );

  const entities = parseEntitiesJson(responseText(out));
  // Deterministic fallback: the webhook already parsed Fixes #n into ids.issue.
  const issueId = pointer.ids?.issue;
  if (issueId && !entities.ticketIds.includes(issueId)) entities.ticketIds.push(issueId);

  return { ...input, bucketName, key, entities };
};
