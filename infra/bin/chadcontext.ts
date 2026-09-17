import { App } from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack.js';
import { IngestionStack } from '../lib/ingestion-stack.js';

const app = new App();

const data = new DataStack(app, 'ChadContextData');
// Day 1: data + ingestion. Pipeline stack lands in the Day 2 task.
new IngestionStack(app, 'ChadContextIngestion', { tableName: data.table.tableName });

app.synth();
