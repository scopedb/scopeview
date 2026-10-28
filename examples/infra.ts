import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '../src/register.js';
import {
  buildChartDataset,
  compileChart,
  createChartSpec,
  fieldRef,
  layoutChart,
  type ChartDataType,
  type ChartDocument,
  type ResultSet,
  type TimeWindow
} from '../src/index.js';
import { ChartRuntime, SCOPE_CHART_STYLES } from '../src/runtime.js';
import type { ScopeChartElement } from '../src/element.js';
import type { ChartConfig } from '../src/families/metrics/spec.js';

function chart(
  fields: [string, ChartDataType][],
  rows: (string | null)[][],
  config: ChartConfig
): ChartDocument {
  const data: ResultSet = {
    fields: fields.map(([name, data_type]) => ({ name, data_type })),
    rows
  };
  return { version: 1, data, spec: createChartSpec(buildChartDataset(data), config) };
}
const hour = 3_600_000,
  day = 24 * hour,
  start = Date.UTC(2026, 8, 29);
const rows = [12, 27, 18, 0, null, 35, 22, 16].map((value, i) => [
  new Date(start + i * hour).toISOString(),
  value === null ? null : String(value)
]);
const timeline = chart(
  [
    ['time', 'timestamp'],
    ['records', 'number']
  ],
  rows,
  { displayType: 'bar', mapping: { kind: 'axis', x: 'result-column-0', y: ['result-column-1'] } }
);
timeline.options = {};
timeline.semantics = {
  time: {
    kind: 'buckets',
    field: fieldRef(buildChartDataset(timeline.data), 'result-column-0'),
    intervalMs: hour,
    coverage: 'complete',
    valueKind: 'count',
    window: { start: start + hour / 4, end: start + 8 * hour - hour / 4 }
  }
};
const records = document.querySelector<ScopeChartElement>('#timeline')!;
records.configure({ axes: 'minimal', legend: false, toolbar: false });
const snapshot = {};
let selected: TimeWindow | null = null;
function bindRange() {
  records.rangeSelection = {
    snapshot,
    value: selected,
    onCommit(value) {
      selected = value;
      showRange();
      bindRange();
    },
    onDismiss() {
      selected = null;
      showRange();
      bindRange();
    }
  };
}
function showRange() {
  document.querySelector('#range')!.textContent = selected
    ? `[${new Date(selected.start).toISOString()}, ${new Date(selected.end).toISOString()})`
    : 'Drag to select · Shift + arrows and Enter also work · Escape clears';
}
function setTimeline(resetSelection = false) {
  const value = structuredClone(timeline);
  value.spec.visualization = document.querySelector<HTMLSelectElement>('#time-style')!.value as
    | 'bar'
    | 'line';
  if (document.querySelector<HTMLInputElement>('#empty-time')!.checked) {
    value.data.rows = [];
  }
  records.document = value;
  if (resetSelection) selected = null;
  showRange();
  bindRange();
}
document.querySelector('#time-style')!.addEventListener('change', () => setTimeline());
document.querySelector('#empty-time')!.addEventListener('change', () => setTimeline(true));
setTimeline();

const usage = chart(
  [
    ['day', 'timestamp'],
    ['Ingress', 'number'],
    ['Egress', 'number']
  ],
  [
    ['2026-09-23T00:00:00Z', '9007199254740993', '4800000000000000'],
    ['2026-09-24T00:00:00Z', '7000000000000000', '5100000000000000'],
    ['2026-09-25T00:00:00Z', null, null],
    ['2026-09-26T00:00:00Z', '2000000000000000', '0'],
    ['2026-09-27T00:00:00Z', '3800000000000000', '4600000000000000'],
    ['2026-09-28T00:00:00Z', '10', '4200000000000000'],
    ['2026-09-29T00:00:00Z', '6000000000000000', '2800000000000000']
  ],
  {
    displayType: 'bar',
    mapping: { kind: 'axis', x: 'result-column-0', y: ['result-column-1', 'result-column-2'] },
    stack: false
  }
);
usage.options = {
  stack: false,
  colors: { Ingress: '#3280dd', Egress: '#88bcf2' }
};
usage.semantics = {
  time: {
    kind: 'buckets',
    field: fieldRef(buildChartDataset(usage.data), 'result-column-0'),
    intervalMs: day,
    coverage: 'unknown'
  }
};
function setUnit() {
  const value = structuredClone(usage),
    dataset = buildChartDataset(value.data);
  const bytes = document.querySelector<HTMLSelectElement>('#unit')!.value === 'B';
  value.options!.values = ['result-column-1', 'result-column-2'].map((id) => ({
    field: fieldRef(dataset, id as 'result-column-1'),
    divisor: bytes ? '1' : '1099511627776',
    unit: bytes ? 'B' : 'TiB',
    decimals: bytes ? 0 : 2
  }));
  const element = document.querySelector<ScopeChartElement>('#usage')!;
  element.configure({ axes: 'minimal', legend: false });
  element.document = value;
}
document.querySelector('#unit')!.addEventListener('change', setUnit);
setUnit();

const categories = chart(
  [
    ['service', 'string'],
    ['delta', 'number']
  ],
  [
    ['API', '42'],
    ['Worker', '-16'],
    ['Query', '24'],
    ['No change', '0'],
    ['No report', null]
  ],
  {
    displayType: 'top-list',
    mapping: { kind: 'distribution', category: 'result-column-0', value: 'result-column-1' }
  }
);
categories.options = {};
const ranked = document.querySelector<ScopeChartElement>('#ranked')!;
ranked.configure({ axes: 'minimal', legend: false });
ranked.document = categories;
const weights = structuredClone(categories);
weights.data.rows = [
  ['API', '420'],
  ['Worker', '260'],
  ['Query', '180'],
  ['Ingest', '80'],
  ['Zero', '0']
];
weights.spec.visualization = 'treemap';
document.querySelector<ScopeChartElement>('#treemap')!.document = weights;

const bins = chart(
  [
    ['range', 'string'],
    ['count', 'number']
  ],
  Array.from({ length: 12 }, (_, i) => [
    `[${i * 10}, ${(i + 1) * 10})`,
    String([2, 4, 9, 14, 28, 35, 18, 11, 6, 3, 1, 0][i])
  ]),
  { displayType: 'bar', mapping: { kind: 'axis', x: 'result-column-0', y: ['result-column-1'] } }
);
bins.semantics = {
  provenance: {
    kind: 'bins',
    scope: 'returned',
    approximate: true,
    description: 'Derived from 131 synthetic returned rows.'
  }
};
bins.options = {};
const summary = document.querySelector<ScopeChartElement>('#summary')!;
summary.configure({ axes: 'minimal', legend: false, toolbar: false });
summary.document = bins;
const mini = structuredClone(bins);
mini.options = { presentation: 'sparkline' };
document.querySelector<ScopeChartElement>('#mini')!.document = mini;
const frequency = chart(
  [
    ['service', 'string'],
    ['count', 'number']
  ],
  [
    ['API', '62'],
    ['Worker', '40'],
    ['Query', '29']
  ],
  { displayType: 'bar', mapping: { kind: 'axis', x: 'result-column-0', y: ['result-column-1'] } }
);
frequency.options = { presentation: 'sparkline', orientation: 'horizontal' };
document.querySelector<ScopeChartElement>('#frequency')!.document = frequency;
document.querySelector('#mini-trigger')!.addEventListener('click', () => {
  document.querySelector('#mini-feedback')!.textContent =
    'Parent action received the click. The decorative chart has no focus or pointer controls.';
});

// A framework host can reuse measurement, input, state and painting without the element.
const host = document.querySelector('#custom-host')!;
const root = host.attachShadow({ mode: 'open' }),
  css = document.createElement('style'),
  viewport = document.createElement('div'),
  canvas = document.createElement('div'),
  decoration = document.createElement('div');
css.textContent = `${SCOPE_CHART_STYLES}.viewport{height:180px}`;
viewport.className = 'viewport';
canvas.className = 'canvas';
decoration.className = 'decoration';
viewport.append(canvas, decoration);
root.append(css, viewport);
const compiled = compileChart(weights);
const runtime = new ChartRuntime(canvas, decoration, {
  layout: (width, height, measure, hidden) => layoutChart(compiled, hidden, width, height, measure),
  onInspect(target) {
    document.querySelector('#custom-reading')!.textContent = target
      ? `${target.tooltip.title}: ${target.tooltip.rows[0].value}`
      : 'Focus the chart and use arrow keys. Same scene and runtime, independent host.';
  }
});
window.addEventListener('pagehide', () => runtime.dispose(), { once: true });
