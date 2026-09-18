import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import type { Embed } from 'discord.js';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { RawIngestRecord } from '../shared/types.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function embedText(embed: Embed): string {
  const parts: string[] = [];
  if (embed.title) parts.push(embed.title);
  if (embed.description) parts.push(embed.description);
  for (const field of embed.fields ?? []) {
    if (field.value) parts.push(field.value);
  }
  return parts.join('\n');
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
        const author = m.author.username;
        const embedParts = m.embeds.map(embedText).filter((t) => t.trim() !== '');
        const combinedContent = [m.content.trim(), ...embedParts].filter(Boolean).join('\n');
        const body = combinedContent || `[no text content] attachment(s): ${m.attachments.size}`;

        const ids: Record<string, string> = {
          source_id: m.id,
          messageId: m.id,
          channel_id: channel.id,
          channelId: m.channelId,
          author,
          authorId: m.author.id,
        };
        const refs = combinedContent.match(/#(\d+)/g);
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
          raw_content: `${author}: ${body}`,
          timestamp: m.createdAt.toISOString(),
          ids,
        };
      });

    const s3 = new S3Client({ region });
    // Must stay under raw/ — infra/lib/pipeline-stack.ts:118 only triggers on prefix 'raw/'.
    // Requested discord-ingest/... would land in S3 but never start Step Functions.
    const key = `raw/discord/real-discord-${Date.now()}.json`;

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
