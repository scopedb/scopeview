import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '../src/register.js';
import type { ScopeChartElement } from '../src/element.js';
import {
  buildChartDataset,
  createChartSpec,
  type ChartDataType,
  type ChartDocument,
  type ResultSet
} from '../src/index.js';
import type { ChartConfig } from '../src/families/metrics/spec.js';
import requests from './requests.json';

function make(
  title: string,
  fields: [string, ChartDataType][],
  rows: (string | null)[][],
  config: ChartConfig
): ChartDocument {
  const data: ResultSet = {
    fields: fields.map(([name, data_type]) => ({ name, data_type })),
    rows
  };
  return { version: 1, title, data, spec: createChartSpec(buildChartDataset(data), config) };
}
const chart = document.querySelector<ScopeChartElement>('scope-chart#requests')!;
const type = document.querySelector<HTMLSelectElement>('#visualization')!;
const state = document.querySelector<HTMLSelectElement>('#state')!;
function update() {
  const doc = structuredClone(requests) as ChartDocument;
  doc.spec.visualization = type.value as 'line' | 'bar' | 'area';
  if (state.value === 'empty') {
    doc.data.rows = [];
  }
  chart.document = doc;
  chart.loading = state.value === 'loading';
  if (state.value === 'error')
    chart.setAttribute('error', 'Unable to load the result. Retry in the host application.');
  else chart.removeAttribute('error');
  document.querySelector('#spec')!.textContent = JSON.stringify(doc, null, 2);
}
type.addEventListener('change', update);
state.addEventListener('change', update);
update();
chart.addEventListener('scope-select', (event) => {
  const detail = (event as CustomEvent).detail;
  document.querySelector('#selection')!.textContent = detail.pinned
    ? `Selected ${detail.rowIndices.length} source rows · ${detail.rows.map((row: (string | null)[]) => row.join(' / ')).join(' · ')}`
    : 'Selection cleared. Inspect another value to continue.';
});
document.querySelector<ScopeChartElement>('scope-chart#status')!.document = make(
  'Response status',
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
  {
    displayType: 'pie',
    mapping: { kind: 'distribution', category: 'result-column-0', value: 'result-column-1' }
  }
);
document.querySelector<ScopeChartElement>('scope-chart#scatter')!.document = make(
  'Query latency by scanned data',
  [
    ['scanned_mb', 'number'],
    ['latency_ms', 'number'],
    ['service', 'string']
  ],
  [
    ['8', '12', 'api'],
    ['20', '18', 'api'],
    ['35', '27', 'api'],
    ['60', '39', 'api'],
    ['12', '18', 'worker'],
    ['28', '30', 'worker'],
    ['48', '42', 'worker'],
    ['85', '64', 'worker']
  ],
  {
    displayType: 'scatter',
    mapping: {
      kind: 'scatter',
      x: 'result-column-0',
      y: 'result-column-1',
      color: 'result-column-2'
    }
  }
);
document.querySelector<ScopeChartElement>('scope-chart#metric')!.document = make(
  'Result snapshot',
  [
    ['requests', 'number'],
    ['p95_ms', 'number'],
    ['error_rate', 'number']
  ],
  [['8990', '38.24', '0.01001']],
  {
    displayType: 'big-number',
    mapping: {
      kind: 'aggregate',
      values: ['result-column-0', 'result-column-1', 'result-column-2']
    }
  }
);
