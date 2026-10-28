import { defineScopeChart } from '../../../src/element.js';
import type { ChartDocumentInput, MetricInspectionContext } from '../../../src/index.js';

export function metricDocument(value: string, id = 'a'): ChartDocumentInput {
  return {
    version: 1,
    data: {
      fields: [
        { name: 'category', data_type: 'string' },
        { name: 'value', data_type: 'number' }
      ],
      rows: [[id, value]]
    },
    spec: { visualization: 'bar', encoding: { x: 'category', y: ['value'] } }
  };
}

/** A selected metric and its host's event cache, with an outside focus target. */
export async function createSelectedMetric() {
  defineScopeChart();
  const outside = document.createElement('button');
  outside.textContent = 'Outside action';
  const chart = document.createElement('scope-chart');
  chart.style.cssText = 'width:600px;--scope-chart-height:200px';
  document.body.append(outside, chart);
  const ready = new Promise((resolve) =>
    chart.addEventListener('scope-ready', resolve, { once: true })
  );
  chart.document = metricDocument('100');
  await ready;
  let selection: MetricInspectionContext | null = null;
  const events: { type: string; context: MetricInspectionContext | null }[] = [];
  for (const type of ['scope-inspect', 'scope-select'] as const)
    chart.addEventListener(type, (event) => {
      events.push({ type, context: event.detail.context });
      if (type === 'scope-select') selection = event.detail.context;
    });
  for (const key of ['Home', 'Enter'])
    chart
      .shadowRoot!.querySelector('.viewport')!
      .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  events.length = 0;
  return {
    chart,
    outside,
    events,
    get selection() {
      return selection;
    },
    settle: () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  };
}
