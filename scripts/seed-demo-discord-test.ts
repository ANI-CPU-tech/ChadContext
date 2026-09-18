import { config } from 'dotenv';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const bucket = requireEnv('S3_BUCKET_NAME');
  const region = process.env.AWS_REGION ?? 'us-east-1';

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const filePath = path.resolve(__dirname, '../demo-discord-data.json');
  const body = await readFile(filePath, 'utf-8');

  // Validate JSON shape before upload.
  JSON.parse(body);

  // Uses standard prefix raw/discord/ per docs/02-tech-stack.md §3 and
  // scripts/export-discord.ts (not raw-discord/ which would miss EventBridge prefix filters).
  const key = 'raw/discord/demo-perfect-test-data.json';

  const s3 = new S3Client({ region });
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    }),
  );

  console.log(`Uploaded demo discord data to s3://${bucket}/${key}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
