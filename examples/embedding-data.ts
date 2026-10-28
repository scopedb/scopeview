import sample from './requests.json';
import {
  compileChart,
  type ChartDocument,
  type TraceDocument,
  type ProfileDocument
} from '../src/index.js';

/** The same source snapshots are reused in every host; only presentation changes. */
export function metricDocument(bar = false): ChartDocument {
  const document = compileChart(sample).document;
  if (bar) document.spec.visualization = 'bar';
  return document;
}

export const traceDocument: TraceDocument = {
  version: 1,
  kind: 'trace',
  title: 'Query execution',
  description: 'Parallel work · exact source timestamps',
  coverage: 'complete',
  spans: [
    {
      id: 'query',
      name: 'SELECT · events',
      service: 'query',
      startTimeNs: '1790643600000000001',
      endTimeNs: '1790643600100000001'
    },
    {
      id: 'plan',
      parentId: 'query',
      name: 'parse & plan',
      service: 'query',
      startTimeNs: '1790643600000000001',
      endTimeNs: '1790643600012000001'
    },
    {
      id: 'scan',
      parentId: 'query',
      name: 'scan · storage',
      service: 'storage',
      startTimeNs: '1790643600014000001',
      endTimeNs: '1790643600076000001'
    },
    {
      id: 'worker',
      parentId: 'query',
      name: 'scan · parallel worker',
      service: 'storage',
      startTimeNs: '1790643600022000001',
      endTimeNs: '1790643600084000001'
    },
    {
      id: 'decode',
      parentId: 'scan',
      name: 'decodeBatch',
      service: 'storage',
      startTimeNs: '1790643600020000001',
      endTimeNs: '1790643600062000001'
    },
    {
      id: 'retry',
      parentId: 'worker',
      name: 'object read · timeout',
      service: 'storage',
      status: 'error',
      startTimeNs: '1790643600044000001',
      endTimeNs: '1790643600051000001'
    }
  ]
};

export const profileDocument: ProfileDocument = {
  version: 1,
  kind: 'profile',
  unit: 'samples',
  title: 'CPU profile',
  description: 'Frame width represents inclusive weight',
  frames: [
    { id: 'root', name: 'executeQuery', selfWeight: '10' },
    { id: 'scan', parentId: 'root', name: 'scanSegments', selfWeight: '15' },
    {
      id: 'decode',
      parentId: 'scan',
      name: 'decodeBatch',
      selfWeight: '45',
      file: 'decoder.ts',
      line: 42
    },
    { id: 'filter', parentId: 'scan', name: 'evaluatePredicate', selfWeight: '20' },
    { id: 'merge', parentId: 'root', name: 'mergeResults', selfWeight: '10' }
  ]
};
