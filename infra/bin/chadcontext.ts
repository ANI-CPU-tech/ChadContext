import { App } from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack.js';
import { IngestionStack } from '../lib/ingestion-stack.js';
import { PipelineStack } from '../lib/pipeline-stack.js';

const app = new App();

const data = new DataStack(app, 'ChadContextData');
const ingestion = new IngestionStack(app, 'ChadContextIngestion', {
  tableName: data.table.tableName,
});
// Day 2: pipeline wired to the landing bucket; KB id follows when it exists.
new PipelineStack(app, 'ChadContextPipeline', {
  tableName: data.table.tableName,
  bucket: ingestion.bucket,
});

app.synth();
