import type {
  MetricComponentOptions,
  EntityComponentOptions
} from '../../../src/families/component-options.js';
import { buildChartDataset } from '../../../src/families/metrics/dataset.js';
import { createChartSpec, fieldRef } from '../../../src/families/metrics/spec.js';
import type { ChartDocument } from '../../../src/families/metrics/document.js';
import type { ChartDataType, ResultSet } from '../../../src/data/result.js';
import type { TraceDocument } from '../../../src/families/trace.js';
import type { ProfileDocument } from '../../../src/families/profile.js';

export type DemoFamily =
  | 'line'
  | 'bar'
  | 'area'
  | 'scatter'
  | 'donut'
  | 'treemap'
  | 'ranked'
  | 'value'
  | 'trace'
  | 'profile';

export type DemoComponent = 'chart' | 'trace' | 'flame';

export function demoComponent(family: DemoFamily): DemoComponent {
  return family === 'trace' ? 'trace' : family === 'profile' ? 'flame' : 'chart';
}

export function demoUI(family: DemoFamily): MetricComponentOptions & EntityComponentOptions {
  if (family === 'trace' || family === 'profile') return {};
  return { axes: 'minimal', legend: ['line', 'area', 'scatter', 'donut'].includes(family) };
}

export function demoHostStyle(
  surface: 'light' | 'dark',
  family: DemoFamily
): Record<string, string> {
  return {
    'color-scheme': surface,
    '--scope-chart-height': family === 'trace' || family === 'profile' ? '260px' : '232px',
    ...(surface === 'dark'
      ? {
          '--color-text-primary': '#eef1f6',
          '--color-text-secondary': '#b6c0ce',
          '--color-text-tertiary': '#929cab',
          '--color-text-brand': '#77b4f1',
          '--color-text-danger': '#fa8796',
          '--color-surface': '#1a2029',
          '--color-surface-hover': '#2a3441',
          '--color-surface-pressed': '#374252',
          '--color-border': '#465362',
          '--color-border-light': '#333d4b'
        }
      : {
          '--color-text-primary': '#202b38',
          '--color-text-secondary': '#657286',
          '--color-text-tertiary': '#7b8798',
          '--color-surface': '#ffffff',
          '--color-border': '#dce3eb',
          '--color-border-light': '#edf0f4'
        })
  };
}

export const families: { value: DemoFamily; label: string; description: string }[] = [
  {
    value: 'line',
    label: 'Line',
    description: 'Compare hourly query and ingestion activity.'
  },
  {
    value: 'bar',
    label: 'Bar',
    description: 'Read requests by service, including a real zero.'
  },
  { value: 'area', label: 'Area', description: 'Read each service within a stacked total.' },
  {
    value: 'scatter',
    label: 'Scatter',
    description: 'Inspect latency and CPU, including overlapping observations.'
  },
  {
    value: 'donut',
    label: 'Donut',
    description: 'Explore service counts and their share of the total.'
  },
  {
    value: 'treemap',
    label: 'Treemap',
    description: 'Compare service volumes through proportional cells.'
  },
  {
    value: 'ranked',
    label: 'Top list',
    description: 'Compare ranked services and exact counts.'
  },
  {
    value: 'value',
    label: 'Value',
    description: 'Read the exact request count.'
  },
  {
    value: 'trace',
    label: 'Trace',
    description: 'Parallel spans with exact nanosecond timestamps.'
  },
  {
    value: 'profile',
    label: 'Flame graph',
    description: 'Inclusive widths computed from supplied self weights.'
  }
];

const serviceColors = {
  Query: 'var(--color-chart-series-1)',
  Ingest: 'var(--color-chart-series-2)',
  Gateway: 'var(--color-chart-series-3)',
  Storage: 'var(--color-chart-series-5)',
  Archive: 'var(--color-chart-series-7)'
};
const serviceRows = [
  ['Query', '43820'],
  ['Ingest', '18640'],
  ['Gateway', '12520'],
  ['Storage', '8940'],
  ['Archive', '0']
];
const hour = 3_600_000;
const start = Date.UTC(2026, 9, 2);
const queryCounts = [
  2120, 2240, 2350, 2480, 2410, 2290, 2460, 2620, 2740, 2890, 2830, 2710, 2980, 3200, 3410, 3350,
  3290, 3540, 3610, 3500, 3420, 3700, 3890, 4020
];
const ingestCounts = [
  1210, 1290, 1410, 1360, 1480, 1570, 1520, 1640, 1730, 1690, 1880, 1940, 1800, 2020, 2100, 2040,
  2150, 2220, 2300, 2270, 2410, 2490, 2580, 2620
];

function result(fields: [string, ChartDataType][], rows: string[][]): ResultSet {
  return {
    fields: fields.map(([name, data_type]) => ({ name, data_type })),
    rows
  };
}

function metricDocument(family: Exclude<DemoFamily, 'trace' | 'profile'>): ChartDocument {
  const temporal = family === 'line' || family === 'area';
  const data = temporal
    ? result(
        [
          ['Time', 'timestamp'],
          ['Service', 'string'],
          ['Requests', 'number']
        ],
        queryCounts.flatMap((value, index) => {
          const time = new Date(start + index * hour).toISOString();
          return [
            [time, 'Query', String(value)],
            [time, 'Ingest', String(ingestCounts[index])]
          ];
        })
      )
    : family === 'scatter'
      ? result(
          [
            ['Latency (ms)', 'number'],
            ['CPU (%)', 'number'],
            ['Service', 'string']
          ],
          [
            ...Array.from({ length: 18 }, (_, index) => [
              String(18 + index * 4),
              String(14 + ((index * 7) % 23) + index * 2),
              ['Query', 'Ingest', 'Gateway'][index % 3]
            ]),
            ['86', '52', 'Ingest']
          ]
        )
      : family === 'value'
        ? result([['Requests', 'number']], [['83920']])
        : result(
            [
              ['Service', 'string'],
              ['Requests', 'number']
            ],
            serviceRows.map((row) => [...row])
          );
  const dataset = buildChartDataset(data);
  return {
    version: 1,
    title: {
      line: 'Request activity',
      area: 'Traffic by service',
      bar: 'Requests by service',
      scatter: 'Latency and CPU',
      donut: 'Request share',
      treemap: 'Service volumes',
      ranked: 'Service ranking',
      value: 'Total requests'
    }[family],
    description: temporal
      ? 'Query and ingestion · 24 hourly observations'
      : family === 'scatter'
        ? 'Service observations · latency in ms, CPU in %'
        : 'Service requests · synthetic snapshot',
    data,
    spec: createChartSpec(dataset, {
      displayType:
        family === 'donut'
          ? 'pie'
          : family === 'ranked'
            ? 'top-list'
            : family === 'value'
              ? 'big-number'
              : family,
      mapping: temporal
        ? { kind: 'axis', x: 'result-column-0', groupBy: 'result-column-1', y: ['result-column-2'] }
        : family === 'scatter'
          ? {
              kind: 'scatter',
              x: 'result-column-0',
              y: 'result-column-1',
              color: 'result-column-2'
            }
          : family === 'bar'
            ? { kind: 'axis', x: 'result-column-0', y: ['result-column-1'] }
            : family === 'value'
              ? { kind: 'aggregate', values: ['result-column-0'] }
              : { kind: 'distribution', category: 'result-column-0', value: 'result-column-1' }
    }),
    options: {
      colors: serviceColors,
      labels: ['bar', 'donut', 'treemap', 'ranked'].includes(family) ? 'auto' : 'none',
      ...(family === 'area' ? { stack: true } : {})
    },
    ...(temporal
      ? {
          semantics: {
            time: {
              kind: 'buckets' as const,
              field: fieldRef(dataset, 'result-column-0'),
              intervalMs: hour,
              coverage: 'complete' as const,
              valueKind: 'count' as const,
              window: { start, end: start + queryCounts.length * hour },
              completeThrough: start + queryCounts.length * hour
            }
          }
        }
      : {})
  };
}

const origin = 1790643600000000001n;
const time = (offset: bigint) => (origin + offset).toString();
const trace: TraceDocument = {
  version: 1,
  kind: 'trace',
  title: 'Query execution',
  description: '100 ms · parallel storage workers',
  coverage: 'complete',
  spans: [
    {
      id: 'query',
      name: 'SELECT · logs',
      service: 'query',
      startTimeNs: time(0n),
      endTimeNs: time(100_000_000n)
    },
    {
      id: 'parse',
      parentId: 'query',
      name: 'parse SQL',
      service: 'query',
      startTimeNs: time(0n),
      endTimeNs: time(10_000_001n)
    },
    {
      id: 'worker-a',
      parentId: 'query',
      name: 'scan · worker A',
      service: 'storage',
      startTimeNs: time(12_000_000n),
      endTimeNs: time(76_000_000n)
    },
    {
      id: 'read',
      parentId: 'worker-a',
      name: 'read object',
      service: 'storage',
      startTimeNs: time(14_000_000n),
      endTimeNs: time(60_000_000n)
    },
    {
      id: 'worker-b',
      parentId: 'query',
      name: 'scan · worker B',
      service: 'storage',
      startTimeNs: time(20_000_000n),
      endTimeNs: time(84_000_000n)
    },
    {
      id: 'retry',
      parentId: 'worker-b',
      name: 'retry · timeout',
      service: 'storage',
      status: 'error',
      startTimeNs: time(40_000_000n),
      endTimeNs: time(48_000_000n)
    },
    {
      id: 'merge',
      parentId: 'query',
      name: 'merge results',
      service: 'query',
      startTimeNs: time(86_000_000n),
      endTimeNs: time(100_000_000n)
    }
  ]
};
const profile: ProfileDocument = {
  version: 1,
  kind: 'profile',
  title: 'Query CPU profile',
  description: '100 samples · exact self and inclusive weights',
  unit: 'samples',
  frames: [
    { id: 'query', name: 'executeQuery', selfWeight: '10' },
    { id: 'scan', parentId: 'query', name: 'scanSegments', selfWeight: '15' },
    {
      id: 'decode',
      parentId: 'scan',
      name: 'decodeBatch',
      selfWeight: '45',
      file: 'decoder.ts',
      line: 42
    },
    { id: 'filter', parentId: 'scan', name: 'evaluatePredicate', selfWeight: '20' },
    { id: 'merge', parentId: 'query', name: 'mergeResults', selfWeight: '10' }
  ]
};

export function demoDocument(family: DemoFamily): ChartDocument | TraceDocument | ProfileDocument {
  if (family === 'trace') return structuredClone(trace);
  if (family === 'profile') return structuredClone(profile);
  return metricDocument(family);
}
