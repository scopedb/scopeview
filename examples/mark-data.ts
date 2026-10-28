import {
  buildChartDataset,
  createChartSpec,
  fieldRef,
  type ResultField,
  type ChartDocument
} from '../src/index.js';

export type Family = 'bar' | 'line' | 'donut' | 'treemap' | 'scatter' | 'area';
const start = Date.UTC(2026, 9, 2, 1),
  minute = 60_000;

export function markDocument(family: Family): ChartDocument {
  const temporal = family === 'area' || family === 'line';
  const fields: ResultField[] =
    family === 'scatter'
      ? [
          { name: 'Latency', data_type: 'number' },
          { name: 'CPU', data_type: 'number' },
          { name: 'status', data_type: 'string' }
        ]
      : temporal
        ? [
            { name: 'Time', data_type: 'timestamp' },
            { name: 'status', data_type: 'string' },
            { name: 'Requests', data_type: 'number' }
          ]
        : [
            { name: 'status', data_type: 'string' },
            { name: 'Requests', data_type: 'number' }
          ];
  const rows =
    family === 'scatter'
      ? Array.from({ length: 18 }, (_, index) => [
          String(18 + index * 4),
          String(14 + ((index * 7) % 23) + index * 2),
          ['info', 'warning', 'error'][index % 3]
        ])
      : temporal
        ? Array.from({ length: 20 }, (_, index) =>
            ['info', 'warning', 'error'].map((status, series) => [
              new Date(start + index * minute).toISOString(),
              status,
              String(
                index === 19
                  ? series === 0
                    ? 9
                    : series === 1
                      ? 2
                      : 1
                  : series === 0
                    ? 24 + Math.round(Math.sin(index / 3) * 9)
                    : series === 1
                      ? 6 + (index % 4)
                      : index % 3
              )
            ])
          ).flat()
        : [
            ['info', '428'],
            ['warning', '43'],
            ['error', '43'],
            ['debug', '0']
          ];
  // An explicit collision demonstrates source choice without moving either observation.
  if (family === 'scatter') rows.push(['86', '52', 'warning']);
  const data = { fields, rows },
    dataset = buildChartDataset(data);
  return {
    version: 1,
    title: {
      donut: 'Request share',
      bar: 'Requests by outcome',
      line: 'Request volume',
      treemap: 'Request composition',
      scatter: 'Latency and CPU',
      area: 'Request outcomes over time'
    }[family],
    description: {
      donut: '514 requests · stable center total',
      bar: 'Returned requests · exact values above each bar',
      line: 'One-minute buckets · latest bucket still accumulating',
      treemap: 'Returned categories · size-aware labels',
      scatter: 'Supplied observations · click overlapping points to choose a source',
      area: 'One-minute buckets · individual series values'
    }[family],
    data,
    spec: createChartSpec(dataset, {
      displayType: family === 'donut' ? 'pie' : family,
      mapping:
        family === 'scatter'
          ? {
              kind: 'scatter',
              x: 'result-column-0',
              y: 'result-column-1',
              color: 'result-column-2'
            }
          : temporal
            ? {
                kind: 'axis',
                x: 'result-column-0',
                groupBy: 'result-column-1',
                y: ['result-column-2']
              }
            : family === 'bar'
              ? { kind: 'axis', x: 'result-column-0', y: ['result-column-1'] }
              : { kind: 'distribution', category: 'result-column-0', value: 'result-column-1' }
    }),
    options: {
      labels: 'auto'
    },
    ...(temporal
      ? {
          semantics: {
            time: {
              kind: 'buckets' as const,
              field: fieldRef(dataset, 'result-column-0'),
              intervalMs: minute,
              coverage: 'complete' as const,
              valueKind: 'count' as const,
              window: { start, end: start + 20 * minute },
              completeThrough: start + 19 * minute
            }
          }
        }
      : {})
  };
}
