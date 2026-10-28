import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '../src/register.js';
import {
  buildChartDataset,
  createChartSpec,
  fieldRef,
  type ResultSet,
  type ChartDocument
} from '../src/index.js';
import type { ScopeChartElement, ScopeInspectionDetail } from '../src/element.js';
import { countLineDocument } from './line-data.js';

const start = Date.UTC(2026, 9, 2, 1),
  minute = 60_000,
  end = start + 40 * minute;
const charts = [...document.querySelectorAll<ScopeChartElement>('scope-chart')];
function documentFor(kind: 'grouped' | 'stacked' | 'line' | 'count'): ChartDocument {
  if (kind === 'count') return countLineDocument();
  const temporal = kind !== 'grouped';
  const names =
    kind === 'grouped'
      ? ['Reads', 'Writes']
      : kind === 'stacked'
        ? ['Success', 'Warning', 'Error']
        : ['p50', 'p95', 'p99'];
  const rows: (string | null)[][] =
    kind === 'grouped'
      ? [
          ['US East', '148', '96'],
          ['Europe', '106', '71'],
          ['APAC', '84', '62'],
          ['South America · edge deployment', '39', '-12'],
          ['Idle', '0', '0']
        ]
      : Array.from({ length: kind === 'stacked' ? 8 : 40 }, (_, index) => [
          new Date(start + index * minute * (kind === 'stacked' ? 5 : 1)).toISOString(),
          ...(kind === 'stacked'
            ? [String(120 + index * 13), String(4 + (index % 4) * 3), String((index % 3) * 2)]
            : index === 12
              ? [null, null, null]
              : [
                  String(index === 5 ? 0 : 24 + Math.round(Math.sin(index / 4) * 8)),
                  String(48 + Math.round(Math.sin(index / 4) * 16)),
                  index === 20 ? null : String(70 + Math.round(Math.sin(index / 4) * 23))
                ])
        ]);
  const data: ResultSet = {
    fields: [
      { name: temporal ? 'Time' : 'Region', data_type: temporal ? 'timestamp' : 'string' },
      ...names.map((name) => ({ name, data_type: 'number' as const }))
    ],
    rows
  };
  const dataset = buildChartDataset(data);
  const y = names.map((_, index) => `result-column-${index + 1}` as const);
  return {
    version: 1,
    title:
      kind === 'grouped'
        ? 'Requests by region'
        : kind === 'stacked'
          ? 'Request outcomes'
          : 'Query latency',
    description:
      kind === 'grouped'
        ? 'Returned requests · regional comparison'
        : kind === 'stacked'
          ? 'SUM(requests) · five-minute buckets'
          : 'Supplied observations · milliseconds',
    data,
    spec: createChartSpec(dataset, {
      displayType: kind === 'line' ? 'line' : 'bar',
      mapping: { kind: 'axis', x: 'result-column-0', y },
      stack: kind === 'stacked'
    }),
    options: {
      stack: kind === 'stacked',
      ...(kind === 'stacked'
        ? {
            colors: {
              Success: 'var(--color-chart-semantic-success)',
              Warning: 'var(--color-chart-semantic-warning)',
              Error: 'var(--color-chart-semantic-error)'
            }
          }
        : {}),
      ...(kind === 'line'
        ? {
            values: y.map((id) => ({
              field: fieldRef(dataset, id),
              divisor: '1',
              unit: 'ms',
              decimals: 0
            }))
          }
        : {})
    },
    ...(temporal
      ? {
          semantics: {
            time:
              kind === 'stacked'
                ? {
                    kind: 'buckets',
                    field: fieldRef(dataset, 'result-column-0'),
                    intervalMs: 5 * minute,
                    coverage: 'complete',
                    valueKind: 'count',
                    window: { start, end }
                  }
                : {
                    kind: 'points',
                    field: fieldRef(dataset, 'result-column-0'),
                    window: { start, end }
                  }
          }
        }
      : {})
  };
}
for (const chart of charts) {
  chart.configure({ axes: 'minimal', legend: true });
  const kind = chart.id.split('-')[0] as 'grouped' | 'stacked' | 'line' | 'count';
  chart.document = documentFor(kind);
  const timeWindow = chart.document.semantics?.time?.window ?? { start, end };
  chart.addEventListener('scope-inspect', (event) => {
    const { cursorTimeMs } = (event as CustomEvent<ScopeInspectionDetail>).detail;
    if (kind === 'grouped') return;
    for (const peer of charts) {
      if (peer === chart || peer.id.startsWith('grouped')) continue;
      if ((kind === 'count') !== peer.id.startsWith('count')) continue;
      peer.linkedHighlight = {
        inspectionKey: null,
        cursor:
          cursorTimeMs == null
            ? null
            : (cursorTimeMs - timeWindow.start) / (timeWindow.end - timeWindow.start)
      };
    }
  });
  chart.addEventListener('scope-select', () => {
    const selected = charts.filter((chart) => chart.viewState.pinnedKey !== null).length;
    document.querySelector('#feedback')!.textContent = selected
      ? `${selected} selection${selected === 1 ? '' : 's'} retained · hover another position to compare`
      : 'Independent selections · shared time cursor';
  });
}
document.querySelector('#reset')!.addEventListener('click', () => {
  for (const chart of charts) {
    chart.viewState = { ...chart.viewState, pinnedKey: null };
    chart.linkedHighlight = null;
  }
  document.querySelector('#feedback')!.textContent = 'Independent selections · shared time cursor';
});
