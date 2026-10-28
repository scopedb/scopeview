import {
  buildChartDataset,
  createChartSpec,
  fieldRef,
  type ResultSet,
  type ChartDocument
} from '../src/index.js';

// Fixed one-second count fixture for exact readings and straight sample connections.
// 101 readings, 279 logs, Oct 2 2026 02:54:40–02:56:21 GMT+8.
const counts = [
  3, 4, 3, 2, 3, 3, 3, 3, 3, 3, 2, 2, 3, 4, 3, 2, 2, 3, 3, 3, 3, 3, 3, 2, 3, 2, 5, 2, 2, 2, 4, 4, 2,
  2, 3, 3, 3, 3, 3, 3, 2, 2, 3, 5, 2, 2, 2, 3, 4, 3, 2, 3, 3, 2, 3, 4, 3, 2, 2, 2, 4, 4, 2, 2, 3, 3,
  3, 3, 3, 3, 2, 2, 3, 5, 2, 2, 2, 3, 4, 3, 2, 3, 3, 2, 3, 4, 3, 2, 2, 2, 5, 2, 2, 2, 2, 3, 3, 1, 2,
  2, 3
];

export function countLineDocument(): ChartDocument {
  const start = Date.UTC(2026, 9, 1, 18, 54, 40);
  const data: ResultSet = {
    fields: [
      { name: 'Time', data_type: 'timestamp' },
      { name: 'count', data_type: 'number' }
    ],
    rows: counts.map((count, index) => [
      new Date(start + index * 1000).toISOString(),
      String(count)
    ])
  };
  const dataset = buildChartDataset(data);
  return {
    version: 1,
    title: 'Log count',
    description: '1-second counts · 101 returned buckets · 279 logs',
    data,
    spec: createChartSpec(dataset, {
      displayType: 'line',
      mapping: { kind: 'axis', x: 'result-column-0', y: ['result-column-1'] }
    }),
    options: {},
    semantics: {
      time: {
        kind: 'buckets',
        field: fieldRef(dataset, 'result-column-0'),
        intervalMs: 1000,
        coverage: 'complete',
        valueKind: 'count',
        window: { start, end: start + counts.length * 1000 }
      }
    }
  };
}
