import { parseViewOptions } from './options.js';
import type { CompiledChart } from '../families/metrics/document.js';
import type { MetricLayout } from '../families/metrics/layout-common.js';
import type { ResultRow } from '../data/result.js';
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
  options: ViewOptions<ResultRow> = {}
) {
  options = parseViewOptions(options);
  let inner: ChartView;
  let disposed = false;
  let theme = options.theme ?? 'light';
  let rendered = compiled;
  const scalarValues = (value: CompiledChart): ScalarValue[] => {
    const mapping = value.config.mapping;
    if (mapping.kind !== 'aggregate' || !value.document.data.rows.length) return [];
    return mapping.values.map((id) => {
      const column = value.dataset.columns.find((column) => column.id === id)!;
      return {
        value: value.document.data.rows[0][column.columnIndex],
        label: column.label,
        display: value.displays.get(id)
      };
    });
  };
  const mount = () => {
    if (compiled.config.mapping.kind === 'aggregate')
      return scalarView(host, scalarValues(compiled), { theme });
    const view = new View(
      host,
      { ...options, theme },
      tokens,
      (width, height, measure, hidden) => {
        rendered = compiled;
        return layout(compiled, hidden, width, height, measure, options.axes ?? 'minimal');
      },
      (target, series) => metricInspectionContext(rendered, target, series)
    );
    view.status(compiled.document.data.rows.length ? null : 'No data');
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
    layout = nextLayout;
    const aggregate = next.config.mapping.kind === 'aggregate';
    if (aggregate !== (compiled.config.mapping.kind === 'aggregate')) {
      if (inner instanceof View && inner.runtime.session.selected) options.onSelect?.(null, null);
      if (inner instanceof View) inner.hideReading();
      inner.dispose();
      compiled = next;
      inner = mount();
      bind();
    } else {
      compiled = next;
      if (inner instanceof View) {
        inner.status(compiled.document.data.rows.length ? null : 'No data');
        inner.changed();
      } else inner.update(scalarValues(compiled));
    }
  }
  bind();
  return { view: handle, replace };
}
