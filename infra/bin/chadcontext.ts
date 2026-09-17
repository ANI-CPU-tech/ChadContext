import { App } from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack.js';

const app = new App();

// Day 1: data stack only. Ingestion/pipeline stacks land in tasks 4+.
new DataStack(app, 'ChadContextData');

app.synth();
