// TODO Day 1: verify GitHub HMAC (secret from Secrets Manager, never .env),
// parse linked issue (e.g. "Fixes #217"), PutObject thin pointer to raw/github/.
// Contract: RawIngestRecord in shared/types.ts.
export const handler = async (event: unknown): Promise<{ statusCode: number; body: string }> => {
  void event;
  return { statusCode: 200, body: JSON.stringify({ status: 'todo' }) };
};
