// TODO Day 1: export a single shared DynamoDBDocumentClient instance.
// Run: pnpm add @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb -w
// then uncomment:
//
// import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
// import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
//
// export const TABLE_NAME = process.env.TABLE_NAME ?? 'ChadContextGraph';
// export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const TABLE_NAME = 'ChadContextGraph';
