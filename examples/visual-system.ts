import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '../src/register.js';
import {
  buildChartDataset,
  createChartSpec,
  type ChartDataType,
  type ChartDocument,
  type ResultSet
} from '../src/index.js';
import { SCOPE_CHART_TOKENS } from '../src/styles.js';
import type { ChartConfig } from '../src/families/metrics/spec.js';
import type { ScopeChartElement, ScopeTraceElement, ScopeFlameElement } from '../src/element.js';

function chart(
  title: string,
  description: string,
  fields: [string, ChartDataType][],
  rows: string[][],
  config: ChartConfig
): ChartDocument {
  const data: ResultSet = {
    fields: fields.map(([name, data_type]) => ({ name, data_type })),
    rows
  };
  return {
    version: 1,
    title,
    description,
    data,
    spec: createChartSpec(buildChartDataset(data), config),
    options: {}
  };
}
function mount(id: string, document: ChartDocument, legend = false) {
  const element = window.document.querySelector<ScopeChartElement>(`#${id}`)!;
  element.configure({ axes: 'minimal', legend });
  element.document = document;
}
const start = Date.UTC(2026, 8, 29);
const traffic = chart(
  'Request activity',
  'Query and ingestion requests · hourly observations',
  [
    ['time', 'timestamp'],
    ['Query', 'number'],
    ['Ingest', 'number']
  ],
  Array.from({ length: 24 }, (_, i) => [
    new Date(start + i * 3_600_000).toISOString(),
    String(Math.round(2400 + 850 * Math.sin(i / 3) + (i > 15 ? 900 : 0))),
    String(Math.round(1100 + 420 * Math.sin(i / 4 + 0.6)))
  ]),
  {
    displayType: 'line',
    mapping: { kind: 'axis', x: 'result-column-0', y: ['result-column-1', 'result-column-2'] }
  }
);
traffic.options!.colors = {
  Query: 'var(--color-chart-series-1)',
  Ingest: 'var(--color-chart-series-2)'
};
mount('traffic', traffic, true);
const distribution = {
  kind: 'distribution' as const,
  category: 'result-column-0' as const,
  value: 'result-column-1' as const
};
const status = chart(
  'Response status',
  'HTTP codes retain their status meaning',
  [
    ['status', 'string'],
    ['requests', 'number']
  ],
  [
    ['200', '8210'],
    ['302', '410'],
    ['404', '280'],
    ['500', '90']
  ],
  { displayType: 'pie', mapping: distribution }
);
mount('status', status, true);
const volume = chart(
  'Processed records',
  'Hourly counts · zero remains a real zero',
  [
    ['time', 'timestamp'],
    ['records', 'number']
  ],
  [820, 1200, 910, 0, 1470, 1320, 1980, 1640].map((value, i) => [
    new Date(start + i * 3_600_000).toISOString(),
    String(value)
  ]),
  { displayType: 'bar', mapping: { kind: 'axis', x: 'result-column-0', y: ['result-column-1'] } }
);
mount('volume', volume);
const services = chart(
  'By service',
  'Returned order · original source values',
  [
    ['service', 'string'],
    ['requests', 'number']
  ],
  [
    ['Query', '43820'],
    ['Ingest', '18640'],
    ['Gateway', '12520'],
    ['Storage', '8940']
  ],
  { displayType: 'top-list', mapping: distribution }
);
services.options = {
  ...services.options,
  colors: {
    Query: 'var(--color-chart-series-1)',
    Ingest: 'var(--color-chart-series-2)',
    Gateway: 'var(--color-chart-series-3)',
    Storage: 'var(--color-chart-series-4)'
  }
};
mount('services', services);
mount(
  'total',
  chart(
    'Source precision',
    'Exact integers remain available with the summary',
    [['records', 'number']],
    [['9007199254740993']],
    { displayType: 'big-number', mapping: { kind: 'aggregate', values: ['result-column-0'] } }
  )
);
const trace = document.querySelector<ScopeTraceElement>('#trace')!;
const origin = 1790643600000000001n;
const time = (offset: bigint) => (origin + offset).toString();
trace.document = {
  version: 1,
  kind: 'trace',
  title: 'Query execution',
  description: 'Parallel work on an elapsed-time axis. Inspect a span for its exact duration.',
  coverage: 'complete',
  spans: [
    {
      id: 'query',
      name: 'SELECT · events',
      service: 'query',
      startTimeNs: time(0n),
      endTimeNs: time(100_000_000n)
    },
    {
      id: 'parse',
      parentId: 'query',
      name: 'parse & plan',
      service: 'query',
      startTimeNs: time(0n),
      endTimeNs: time(12_000_000n)
    },
    {
      id: 'scan',
      parentId: 'query',
      name: 'scan · storage',
      service: 'storage',
      startTimeNs: time(14_000_000n),
      endTimeNs: time(76_000_000n)
    },
    {
      id: 'scan-b',
      parentId: 'query',
      name: 'scan · parallel worker',
      service: 'storage',
      startTimeNs: time(22_000_000n),
      endTimeNs: time(84_000_000n)
    },
    {
      id: 'decode',
      parentId: 'scan',
      name: 'decode batch',
      service: 'storage',
      startTimeNs: time(20_000_000n),
      endTimeNs: time(62_000_000n)
    },
    {
      id: 'retry',
      parentId: 'scan-b',
      name: 'object read · timeout',
      service: 'storage',
      status: 'error',
      startTimeNs: time(44_000_000n),
      endTimeNs: time(51_000_000n)
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
document
  .querySelector('#pin')!
  .addEventListener('click', () => trace.focusNode('scan', { pin: true }));
document.querySelector<ScopeFlameElement>('#profile')!.document = {
  version: 1,
  kind: 'profile',
  unit: 'samples',
  title: 'CPU profile',
  description: 'Frame width represents inclusive weight. The horizontal axis is not elapsed time.',
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

const palette = document.querySelector<HTMLElement>('#palette')!;
const paletteRoot = palette.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent =
  SCOPE_CHART_TOKENS +
  ':host{display:block} .palette{display:flex;flex-wrap:wrap;gap:16px;padding:16px 0;border-block:1px solid var(--color-border-light);color:var(--color-text-secondary);font:11px var(--font-sans)} .key{display:flex;align-items:center;gap:7px} i{width:3px;height:14px;border-radius:1px}';
const keys = document.createElement('div');
keys.className = 'palette';
for (const [i, name] of [
  'Blue',
  'Jade',
  'Violet',
  'Amber',
  'Sky',
  'Rose',
  'Pine',
  'Lilac',
  'Ochre',
  'Sage'
].entries()) {
  const key = document.createElement('span'),
    mark = document.createElement('i');
  key.className = 'key';
  mark.style.backgroundColor = `var(--color-chart-series-${i + 1})`;
  key.append(mark, document.createTextNode(name));
  keys.append(key);
}
paletteRoot.append(style, keys);
const darkTokens: Record<string, string> = {
  '--color-surface': '#181e27',
  '--color-text-primary': '#f0f0f0',
  '--color-text-secondary': '#b5becb',
  '--color-text-tertiary': '#9ca8b8',
  '--color-text-brand': '#70b5f6',
  '--color-border': '#384150',
  '--color-border-light': '#2c3441',
  '--color-surface-hover': 'rgb(255 255 255 / 5%)',
  '--color-surface-pressed': 'rgb(255 255 255 / 8%)',
  '--color-text-danger': '#fa9090',
  '--color-chart-warning': '#e4bd66'
};
document.querySelector<HTMLSelectElement>('#surface')!.addEventListener('change', (event) => {
  const surface = (event.target as HTMLSelectElement).value;
  document.documentElement.dataset.surface = surface;
  for (const element of [
    palette,
    ...document.querySelectorAll<ScopeChartElement | ScopeTraceElement | ScopeFlameElement>(
      'scope-chart, scope-trace, scope-flame'
    )
  ]) {
    for (const [token, value] of Object.entries(darkTokens)) {
      if (surface === 'dark') element.style.setProperty(token, value);
      else element.style.removeProperty(token);
    }
    element.style.colorScheme = surface;
    if ('refresh' in element && typeof element.refresh === 'function') element.refresh();
  }
});
