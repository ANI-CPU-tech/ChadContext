import { config } from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
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

async function main(): Promise<void> {
  const token = requireEnv('DISCORD_TOKEN');
  const channelId = requireEnv('DISCORD_CHANNEL_ID');
  const bucket = requireEnv('S3_BUCKET_NAME');
  const region = process.env.AWS_REGION ?? 'us-east-1';

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  try {
    await client.login(token);
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      throw new Error(`Channel ${channelId} is not a text-based channel with message history`);
    }

    const messages = await channel.messages.fetch({ limit: 100 });

    const records: RawIngestRecord[] = [...messages.values()]
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((m) => {
        const ids: Record<string, string> = {
          messageId: m.id,
          author: m.author.username,
          authorId: m.author.id,
          channelId: m.channelId,
        };
        const refs = m.content.match(/#(\d+)/g);
        if (refs) {
          for (const ref of refs) {
            const num = ref.slice(1);
            if (!ids.ticket) {
              ids.ticket = num;
            } else if (!ids.pr) {
              ids.pr = num;
            }
          }
        }
        return {
          source: 'discord' as const,
          type: 'message',
          raw_content: m.content || `[no text content] attachment(s): ${m.attachments.size}`,
          timestamp: m.createdAt.toISOString(),
          ids,
        };
      });

    const s3 = new S3Client({ region });
    const key = `raw/discord/${channelId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(records, null, 2),
        ContentType: 'application/json',
      }),
    );

    console.log(`Exported ${records.length} messages to s3://${bucket}/${key}`);
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
