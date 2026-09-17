import { createHmac } from 'node:crypto';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { __resetSecretCacheForTests, handler } from './index.js';

const s3Mock = mockClient(S3Client);
const secretsMock = mockClient(SecretsManagerClient);

const SECRET = 'test-webhook-secret';

function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
}

function makeEvent(body: string, eventName: string, signature = sign(body)): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /webhook/github',
    rawPath: '/webhook/github',
    rawQueryString: '',
    headers: { 'x-github-event': eventName, 'x-hub-signature-256': signature },
    requestContext: {
      accountId: '123',
      apiId: 'abc',
      domainName: 'x',
      domainPrefix: 'x',
      http: { method: 'POST', path: '/webhook/github', protocol: 'HTTP/1.1', sourceIp: '1.1.1.1', userAgent: 't' },
      requestId: 'r1',
      routeKey: 'POST /webhook/github',
      stage: '$default',
      time: 'now',
      timeEpoch: 0,
    },
    body,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

const PR_BODY = JSON.stringify({
  action: 'closed',
  pull_request: {
    number: 482,
    title: 'Add retry delay',
    body: 'Fixes #217 — payments failing under load',
    head: { sha: 'abc123def456' },
  },
  repository: { full_name: 'acme/shop' },
});

describe('github-webhook', () => {
  beforeEach(() => {
    s3Mock.reset();
    secretsMock.reset();
    __resetSecretCacheForTests();
    process.env.BUCKET_NAME = 'test-bucket';
    process.env.GITHUB_WEBHOOK_SECRET_NAME = 'test-secret';
    secretsMock.resolves({ SecretString: SECRET });
  });

  it('stores a thin pointer for a PR mentioning Fixes #217', async () => {
    const res = await handler(makeEvent(PR_BODY, 'pull_request'));
    assert.equal(res.statusCode, 200);

    const calls = s3Mock.commandCalls(PutObjectCommand);
    assert.equal(calls.length, 1);
    const input = calls[0]?.args[0].input;
    assert.equal(input?.Bucket, 'test-bucket');
    assert.match(input?.Key ?? '', /^raw\/github\/pull_request\/\d+-acme-shop\.json$/);

    const stored = JSON.parse(String(input?.Body));
    assert.equal(stored.source, 'github');
    assert.equal(stored.ids.pr, '482');
    assert.equal(stored.ids.issue, '217');
    assert.equal(stored.ids.sha, 'abc123def456');
  });

  it('rejects a bad signature without touching S3', async () => {
    const res = await handler(makeEvent(PR_BODY, 'pull_request', 'sha256=deadbeef'));
    assert.equal(res.statusCode, 401);
    assert.equal(s3Mock.commandCalls(PutObjectCommand).length, 0);
  });

  it('ignores unsupported events with 202', async () => {
    const res = await handler(makeEvent('{}', 'ping'));
    assert.equal(res.statusCode, 202);
    assert.equal(s3Mock.commandCalls(PutObjectCommand).length, 0);
  });

  it('fails closed when BUCKET_NAME is missing', async () => {
    delete process.env.BUCKET_NAME;
    const res = await handler(makeEvent(PR_BODY, 'pull_request'));
    assert.equal(res.statusCode, 500);
  });
});
