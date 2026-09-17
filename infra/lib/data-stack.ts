import { CfnOutput, RemovalPolicy, Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import { AttributeType, BillingMode, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

// Single-table graph store. See docs/schema.md and docs/02-tech-stack.md §4.
// Core access: Query PK = NODE#<id> returns METADATA + all edges in one round trip.
// GSI1 (SK/PK flipped) enables reverse lookups, e.g. all PRs linked to a ticket.
export class DataStack extends Stack {
  public readonly table: Table;

  public constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.table = new Table(this, 'ChadContextGraph', {
      tableName: 'ChadContextGraph',
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // hackathon: tear down cleanly
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'SK', type: AttributeType.STRING },
      sortKey: { name: 'PK', type: AttributeType.STRING },
      projection: { type: ProjectionType.ALL },
    });

    new CfnOutput(this, 'TableName', { value: this.table.tableName });
    new CfnOutput(this, 'TableArn', { value: this.table.tableArn });
  }
}
