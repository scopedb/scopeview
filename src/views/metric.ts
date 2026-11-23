import { parseViewOptions } from './options.js';
import type { CompiledChart } from '../families/metrics/document.js';
import { chartColumn } from '../families/metrics/dataset.js';
import type { MetricLayout } from '../families/metrics/layout-common.js';
import { prepareAggregateValues } from '../families/metrics/prepared.js';
import type { ResultRow } from '../data/result.js';
import type { MetricInspectionContext } from '../core/inspection-context.js';
import { scalarView, type ScalarValue } from './scalar.js';
import { View, type ViewOptions, type ChartView } from './view.js';
import { interactionHosts } from './interactions.js';
import { metricInspectionContext } from '../families/metrics/inspection-context.js';
import tokens from '../theme/metric-tokens.css?inline';

/** Aggregate documents use HTML; plot documents instantiate the report Canvas runtime. */
export function createMetric(
  host: HTMLElement,
  compiled: CompiledChart,
  layout: MetricLayout,
  compile: (document: unknown) => CompiledChart,
  options: ViewOptions<ResultRow, MetricInspectionContext> = {}
) {
  const parsed = parseViewOptions(options);
  let inner: ChartView;
  let disposed = false;
  let revision = 0;
  let theme = parsed.theme ?? 'light';
  let rendered = compiled;
  const scalarValues = (value: CompiledChart): ScalarValue[] => {
    const mapping = value.config.mapping;
    if (mapping.kind !== 'aggregate') return [];
    return prepareAggregateValues(value.dataset, mapping).map(({ id, label }) => ({
      value: value.document.data.rows[0][chartColumn(value.dataset, id)!.columnIndex],
      label,
      display: value.displays.get(id)
    }));
  };
  const statusMessage = (value: CompiledChart) =>
    value.document.data.rows.length ? null : 'No data';
  const mount = () => {
    if (compiled.config.mapping.kind === 'aggregate')
      return scalarView(host, scalarValues(compiled), { theme });
    const view: View<ResultRow, MetricInspectionContext> = new View(
      host,
      { ...parsed, theme },
      tokens,
      (width, height, measure, hidden) => {
        rendered = compiled;
        return layout(compiled, hidden, width, height, measure, parsed.axes);
      },
      {
        snapshot: () => rendered,
        contextFor: (target, series) => metricInspectionContext(rendered, target, series)
      }
    );
    view.status(statusMessage(compiled));
    view.changed();
    return view;
  };
  inner = mount();
  const handle: ChartView = {
    update(document) {
      if (disposed) throw new Error('This chart has been disposed.');
      const next = compile(document);
      replace(next);
    },
    get theme() {
      return theme;
    },
    set theme(value) {
      inner.theme = value;
      theme = inner.theme;
    },
    refresh: () => inner.refresh(),
    dispose() {
      disposed = true;
      revision++;
      inner.dispose();
      interactionHosts.delete(handle);
    }
  };
  function bind() {
    const binding = interactionHosts.get(inner);
    if (binding) interactionHosts.set(handle, binding);
    else interactionHosts.delete(handle);
  }
  function replace(next: CompiledChart, nextLayout: MetricLayout = layout) {
    if (disposed) throw new Error('This chart has been disposed.');
    const current = ++revision;
    layout = nextLayout;
    const aggregate = next.config.mapping.kind === 'aggregate';
    if (aggregate !== (compiled.config.mapping.kind === 'aggregate')) {
      if (inner instanceof View) inner.clearInspection();
      if (disposed || current !== revision) return;
      inner.dispose();
      compiled = next;
      inner = mount();
      bind();
    } else {
      compiled = next;
      if (inner instanceof View) {
        const view = inner;
        view.status(statusMessage(compiled));
        if (disposed || current !== revision) return;
        view.changed();
      } else inner.update(scalarValues(compiled));
    }
  }
  bind();
  return { view: handle, replace };
}
