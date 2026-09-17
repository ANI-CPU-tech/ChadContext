import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

interface TranscriptUploadEvent {
  body?: string | null;
  queryStringParameters?: Record<string, string> | null;
}

interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const ALLOWED_EXTENSIONS: Record<string, string> = {
  '.txt': 'text/plain',
  '.vtt': 'text/vtt',
  '.srt': 'application/x-subrip',
};

function json(statusCode: number, payload: unknown): ApiResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(payload),
  };
}

function sanitizeFilename(input: string): string | null {
  const base = input.split('/').pop()?.split('\\').pop()?.trim() ?? '';
  if (!base || base === '.' || base === '..' || base.includes('..')) {
    return null;
  }
  return base;
}

function contentTypeFor(filename: string): string | null {
  const lower = filename.toLowerCase();
  for (const [ext, mime] of Object.entries(ALLOWED_EXTENSIONS)) {
    if (lower.endsWith(ext)) {
      return mime;
    }
  }
  return null;
}

export const handler = async (event: TranscriptUploadEvent): Promise<ApiResponse> => {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    return json(500, { error: 'S3_BUCKET_NAME is not configured' });
  }
  const region = process.env.AWS_REGION ?? 'us-east-1';

  let filename: unknown;
  try {
    if (!event.body) {
      return json(400, { error: 'filename is required in request body' });
    }
    const parsed: unknown = JSON.parse(event.body);
    if (typeof parsed === 'object' && parsed !== null && 'filename' in parsed) {
      filename = (parsed as { filename: unknown }).filename;
    }
  } catch {
    return json(400, { error: 'request body must be valid JSON with a filename field' });
  }

  if (typeof filename !== 'string' || filename.trim() === '') {
    return json(400, { error: 'filename is required in request body' });
  }

  const sanitized = sanitizeFilename(filename);
  if (!sanitized) {
    return json(400, { error: 'invalid filename' });
  }

  const contentType = contentTypeFor(sanitized);
  if (!contentType) {
    return json(400, {
      error: `unsupported file type. Allowed: ${Object.keys(ALLOWED_EXTENSIONS).join(', ')}`,
    });
  }

  const key = `raw/transcripts/${Date.now()}-${sanitized}`;

  try {
    const s3 = new S3Client({ region });
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      { expiresIn: 300 },
    );
    return json(200, { url, key, bucket, expiresIn: 300 });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'failed to generate upload URL' });
  }
};
