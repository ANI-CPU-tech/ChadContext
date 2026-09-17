import { CfnOutput, RemovalPolicy, Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface IngestionStackProps extends StackProps {
  /** DynamoDB table name (from DataStack) — passed as Lambda env, never hardcoded. */
  tableName: string;
}

// Landing zone for raw ingested content. See docs/02-tech-stack.md §3.
// Webhook drops a thin pointer to S3; S3 -> EventBridge decouples ingest from
// the Day 2 Step Functions pipeline (no SNS/SQS needed).
export class IngestionStack extends Stack {
  public readonly bucket: Bucket;
  public readonly api: HttpApi;

  public constructor(scope: Construct, id: string, props: IngestionStackProps) {
    super(scope, id, props);

    this.bucket = new Bucket(this, 'RawLanding', {
      // Name left to CloudFormation; exported via CfnOutput below.
      eventBridgeEnabled: true,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY, // hackathon: tear down cleanly
    });

    // Webhook HMAC secret lives in Secrets Manager (created out-of-band, never
    // in the template or .env). Reference only — deploy succeeds even before
    // the secret exists; the Lambda fails at runtime until it is created.
    const webhookSecret = Secret.fromSecretNameV2(
      this,
      'GithubWebhookSecret',
      'chadcontext/github-webhook',
    );

    const webhookFn = new NodejsFunction(this, 'GithubWebhookFn', {
      entry: '../lambdas/github-webhook/index.ts',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        BUCKET_NAME: this.bucket.bucketName,
        TABLE_NAME: props.tableName,
        GITHUB_WEBHOOK_SECRET_NAME: webhookSecret.secretName,
      },
    });
    this.bucket.grantWrite(webhookFn, 'raw/github/*');
    webhookSecret.grantRead(webhookFn);

    this.api = new HttpApi(this, 'IngestionApi');
    this.api.addRoutes({
      path: '/webhook/github',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('GithubWebhookIntegration', webhookFn),
    });

    new CfnOutput(this, 'BucketName', { value: this.bucket.bucketName });
    new CfnOutput(this, 'ApiUrl', { value: this.api.apiEndpoint });
  }
}
