import { CfnOutput, Duration, Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import { EventField, Rule, RuleTargetInput } from 'aws-cdk-lib/aws-events';
import { SfnStateMachine } from 'aws-cdk-lib/aws-events-targets';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { DefinitionBody, StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export interface PipelineStackProps extends StackProps {
  /** DynamoDB table name (owned by DataStack) — passed as Lambda env, never hardcoded. */
  tableName: string;
  /** Landing bucket (owned by IngestionStack) — source of the EventBridge trigger. */
  bucket: Bucket;
  /** Bedrock Knowledge Base id for correlate. TODO: wire real KB; placeholder until it exists. */
  knowledgeBaseId?: string;
}

// Day 2 intelligence layer. See docs/02-tech-stack.md §6 and docs/03-task-split.md Day 2.
// S3 Object Created (raw/*) -> EventBridge -> Step Functions:
// extract (Nova Micro) -> correlate (KB Retrieve) -> score+store (Nova Pro + DynamoDB).
// Handler logic lands in the next task; this stack is infra + IAM only.
export class PipelineStack extends Stack {
  public readonly stateMachine: StateMachine;

  public constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const table = Table.fromTableName(this, 'GraphTable', props.tableName);
    const stack = Stack.of(this);
    const novaMicroArn = `arn:${stack.partition}:bedrock:${stack.region}::foundation-model/amazon.nova-micro-v1:0`;
    const novaProArn = `arn:${stack.partition}:bedrock:${stack.region}::foundation-model/amazon.nova-pro-v1:0`;

    const extractFn = new NodejsFunction(this, 'ExtractFn', {
      entry: '../lambdas/extract-entities/index.ts',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
    });
    extractFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [novaMicroArn],
      }),
    );

    const correlateFn = new NodejsFunction(this, 'CorrelateFn', {
      entry: '../lambdas/correlate-semantic/index.ts',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      environment: {
        KNOWLEDGE_BASE_ID: props.knowledgeBaseId ?? 'TODO-create-kb',
      },
    });
    correlateFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        // Narrowed to KB ARNs in this account+region; tightened to the real
        // KB id once it exists (TODO Day 2).
        actions: ['bedrock:Retrieve'],
        resources: [
          `arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:knowledge-base/*`,
        ],
      }),
    );

    const scoreFn = new NodejsFunction(this, 'ScoreStoreFn', {
      entry: '../lambdas/score-and-store/index.ts',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(120),
      environment: {
        TABLE_NAME: props.tableName,
      },
    });
    scoreFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [novaProArn],
      }),
    );
    table.grantWriteData(scoreFn);

    // Exactly the CDK chainable shape from docs/02-tech-stack.md §6.
    const extractEntities = new LambdaInvoke(this, 'ExtractEntities', {
      lambdaFunction: extractFn,
      outputPath: '$.Payload',
    });
    const correlateSemantic = new LambdaInvoke(this, 'CorrelateSemantic', {
      lambdaFunction: correlateFn,
      outputPath: '$.Payload',
    });
    const scoreAndStore = new LambdaInvoke(this, 'ScoreAndStore', {
      lambdaFunction: scoreFn,
      outputPath: '$.Payload',
    });
    const definition = extractEntities.next(correlateSemantic).next(scoreAndStore);

    this.stateMachine = new StateMachine(this, 'ChadContextPipeline', {
      definitionBody: DefinitionBody.fromChainable(definition),
      timeout: Duration.minutes(5),
    });

    const input = RuleTargetInput.fromObject({
      bucketName: props.bucket.bucketName,
      key: EventField.fromPath('$.detail.object.key'),
    });
    const rule = new Rule(this, 'NewRawObject', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: { name: [props.bucket.bucketName] },
          object: { key: [{ prefix: 'raw/' }] },
        },
      },
    });
    rule.addTarget(new SfnStateMachine(this.stateMachine, { input }));

    new CfnOutput(this, 'StateMachineArn', { value: this.stateMachine.stateMachineArn });
  }
}
