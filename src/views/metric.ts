import { parseViewOptions } from './options.js';
import type { CompiledChart } from '../families/metrics/document.js';
import type { MetricLayout } from '../families/metrics/layout-common.js';
import type { ResultRow } from '../data/result.js';
import type { MetricInspectionContext } from '../core/inspection-context.js';
import { createMetricPlot } from './metric-plot.js';
import { scalarView, type ScalarValue } from './scalar.js';
import type { ViewOptions, ChartView } from './view.js';
import { interactionHosts } from './interactions.js';
import { interactionFor, readingPhase } from '../core/interaction.js';

/** The general entry alone owns transitions between HTML aggregates and plotted metrics. */
export function createMetric(
  host: HTMLElement,
  compiled: CompiledChart,
  layout: MetricLayout,
  compile: (document: unknown) => CompiledChart,
  options: ViewOptions<ResultRow, MetricInspectionContext>
) {
  options = parseViewOptions(options);
  let revision = 0;
  let disposed = false;
  let inner: ChartView;
  let plot: ReturnType<typeof createMetricPlot> | null = null;
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
  const mount = (
    next: CompiledChart,
    nextLayout: MetricLayout,
    theme = options.theme ?? 'light'
  ): ChartView => {
    plot =
      next.config.mapping.kind === 'aggregate'
        ? null
        : createMetricPlot(host, next, nextLayout, { ...options, theme });
    const view = plot?.view ?? scalarView(host, scalarValues(next), { theme });
    interactionHosts.set(handle, interactionHosts.get(view));
    return view;
  };
  const handle: ChartView = {
    update(document) {
      if (disposed) throw new Error('This chart has been disposed.');
      replace(compile(document));
    },
    get theme() {
      return inner.theme;
    },
    set theme(value) {
      inner.theme = value;
    },
    refresh: () => inner.refresh(),
    dispose() {
      disposed = true;
      revision++;
      inner.dispose();
      interactionHosts.delete(handle);
    }
  };
  function replace(next: CompiledChart, nextLayout?: MetricLayout) {
    if (disposed) throw new Error('This chart has been disposed.');
    const current = ++revision;
    if ((next.config.mapping.kind !== 'aggregate') !== !!plot) {
      const interaction = interactionFor(plot?.view.runtime.session ?? handle);
      interaction.batch(() => {
        plot?.view.clearInspection();
        // Retire the old view only after its final readings finish broadcasting.
        interaction.effect(
          () => {
            const theme = inner.theme;
            inner.dispose();
            inner = mount(next, nextLayout ?? layout, theme);
          },
          handle,
          readingPhase,
          () => current === revision
        );
      });
    } else if (plot) plot.replace(next, nextLayout);
    else inner.update(scalarValues(next));
  }
  inner = mount(compiled, layout);
  return { view: handle, replace };
}
