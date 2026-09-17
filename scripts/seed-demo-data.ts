import { config } from 'dotenv';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { RawIngestRecord } from '../shared/types.js';

config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// Guaranteed-correlated demo chain: Ticket #217 -> Discord debate
// (1s ruled out, 3s sleep proposed) -> PR #482.
// Mirrors the end-to-end example in docs/01-spec.md §8-§9.
const seedRecords: RawIngestRecord[] = [
  {
    source: 'github',
    type: 'issue',
    raw_content:
      'Issue #217 opened by Dev Dave: "Payments failing intermittently under load. Retry logic seems to give up too fast when the payment gateway is slow."',
    timestamp: '2026-09-12T09:14:00.000Z',
    ids: { issue: '217', author: 'dev-dave', repo: 'chadcontext-demo' },
  },
  {
    source: 'discord',
    type: 'message',
    raw_content:
      'Dev Dave: Hey team, seeing payment timeouts in prod again (Ticket #217). Gateway takes ~2-3s under load and our retry bails immediately. Anyone else seeing this?',
    timestamp: '2026-09-12T09:42:11.000Z',
    ids: {
      messageId: 'discord-9930',
      author: 'Dev Dave',
      authorId: 'dave-01',
      channelId: 'demo-channel',
      ticket: '217',
    },
  },
  {
    source: 'discord',
    type: 'message',
    raw_content:
      'Senior Sarah: Looked at the logs — we tried a 1s delay before and it was not enough, p99 gateway latency is 2.4s. Let us add a 3-second sleep before retry, that should cover it. I will approve a PR for that.',
    timestamp: '2026-09-12T10:05:33.000Z',
    ids: {
      messageId: 'discord-9931',
      author: 'Senior Sarah',
      authorId: 'sarah-02',
      channelId: 'demo-channel',
      ticket: '217',
    },
  },
  {
    source: 'discord',
    type: 'message',
    raw_content:
      'Dev Dave: Makes sense, opening PR #482 with time.sleep(3) before retry. Links Fixes #217. Will merge once CI passes.',
    timestamp: '2026-09-12T10:31:02.000Z',
    ids: {
      messageId: 'discord-9932',
      author: 'Dev Dave',
      authorId: 'dave-01',
      channelId: 'demo-channel',
      ticket: '217',
      pr: '482',
    },
  },
  {
    source: 'github',
    type: 'pr',
    raw_content:
      'PR #482 merged by Dev Dave: "Add 3s sleep before payment retry. Fixes #217. Follows Discord discussion where a 1s delay was ruled out as insufficient per gateway logs." Diff: + time.sleep(3) before retry_payment()',
    timestamp: '2026-09-12T11:12:47.000Z',
    ids: { pr: '482', author: 'dev-dave', issue: '217', repo: 'chadcontext-demo' },
  },
];

async function main(): Promise<void> {
  const bucket = requireEnv('S3_BUCKET_NAME');
  const region = process.env.AWS_REGION ?? 'us-east-1';

  const s3 = new S3Client({ region });
  const key = 'raw/seed/demo-ticket-217-pr-482.json';

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(seedRecords, null, 2),
      ContentType: 'application/json',
    }),
  );

  console.log(`Seeded ${seedRecords.length} correlated records to s3://${bucket}/${key}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
