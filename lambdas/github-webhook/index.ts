import { createHmac, timingSafeEqual } from 'node:crypto';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { RawIngestRecord } from '../../shared/types.js';

// Thin ingress only: verify -> parse ids -> drop pointer to S3.
// Bedrock work happens in the Day 2 pipeline. See docs/01-spec.md §4.
const FIXES_RE = /(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)/i;
const SUPPORTED_EVENTS = new Set(['push', 'pull_request', 'issues']);

const s3 = new S3Client({});
const secrets = new SecretsManagerClient({});
let cachedSecret: string | undefined;

export function __resetSecretCacheForTests(): void {
  cachedSecret = undefined;
}

async function getWebhookSecret(): Promise<string> {
  if (cachedSecret !== undefined) return cachedSecret;
  const name = process.env.GITHUB_WEBHOOK_SECRET_NAME;
  if (!name) throw new Error('GITHUB_WEBHOOK_SECRET_NAME is not set');
  const out = await secrets.send(new GetSecretValueCommand({ SecretId: name }));
  if (!out.SecretString) throw new Error('webhook secret has no string value');
  cachedSecret = out.SecretString;
  return cachedSecret;
}

function signaturesMatch(secret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (header === undefined || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
    'utf8',
  );
  const actual = Buffer.from(header, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Pull the correlation ids + a small summary out of the event. Full payload stays in GitHub. */
function parseGithubEvent(
  eventName: string,
  payload: Record<string, unknown>,
): { ids: Record<string, string>; summary: string } {
  const repo = asRecord(payload.repository);
  const repoName = asString(repo?.full_name) ?? 'unknown';
  const action = asString(payload.action) ?? eventName;

  if (eventName === 'pull_request') {
    const pr = asRecord(payload.pull_request);
    const title = asString(pr?.title) ?? '';
    const body = asString(pr?.body) ?? '';
    const fixed = FIXES_RE.exec(`${title}\n${body}`)?.[1];
    const ids: Record<string, string> = { repo: repoName };
    if (typeof pr?.number === 'number') ids.pr = String(pr.number);
    const sha = asString(asRecord(pr?.head)?.sha);
    if (sha) ids.sha = sha;
    if (fixed) ids.issue = fixed;
    return { ids, summary: `PR ${ids.pr ?? '?'} ${action}: ${title}`.trim() };
  }

  if (eventName === 'issues') {
    const issue = asRecord(payload.issue);
    const title = asString(issue?.title) ?? '';
    const ids: Record<string, string> = { repo: repoName };
    if (typeof issue?.number === 'number') ids.issue = String(issue.number);
    return { ids, summary: `Issue ${ids.issue ?? '?'} ${action}: ${title}`.trim() };
  }

  // push
  const sha = asString(payload.after);
  const ref = asString(payload.ref);
  const ids: Record<string, string> = { repo: repoName };
  if (sha) ids.sha = sha;
  if (ref) ids.ref = ref;
  return { ids, summary: `Push to ${ref ?? repoName} (${sha?.slice(0, 7) ?? '?'})` };
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const bucket = process.env.BUCKET_NAME;
  if (!bucket) return { statusCode: 500, body: JSON.stringify({ error: 'BUCKET_NAME is not set' }) };

  if (event.body === undefined || event.body === null) {
    return { statusCode: 400, body: JSON.stringify({ error: 'missing body' }) };
  }
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body);

  let secret: string;
  try {
    secret = await getWebhookSecret();
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: (err as Error).message }) };
  }
  if (!signaturesMatch(secret, rawBody, event.headers['x-hub-signature-256'])) {
    return { statusCode: 401, body: JSON.stringify({ error: 'bad signature' }) };
  }

  const eventName = event.headers['x-github-event'] ?? '';
  if (!SUPPORTED_EVENTS.has(eventName)) {
    return { statusCode: 202, body: JSON.stringify({ status: 'ignored', event: eventName }) };
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
    const record = asRecord(parsed);
    if (!record) throw new Error('not an object');
    payload = record;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid JSON' }) };
  }

  const { ids, summary } = parseGithubEvent(eventName, payload);
  const record: RawIngestRecord = {
    source: 'github',
    type: `${eventName}`,
    raw_content: JSON.stringify({ event: eventName, summary, ids }),
    timestamp: new Date().toISOString(),
    ids,
  };

  const safeRepo = ids.repo?.replaceAll('/', '-') ?? 'unknown';
  const key = `raw/github/${eventName}/${Date.now()}-${safeRepo}.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(record),
      ContentType: 'application/json',
    }),
  );

  return { statusCode: 200, body: JSON.stringify({ ok: true, key }) };
};
