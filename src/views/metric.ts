import { captureScene } from '../core/scene-snapshot.js';
import { metricInspectionContext } from '../families/metrics/inspection-context.js';
import tokens from '../theme/metric-tokens.css?inline';
import { parseViewOptions } from './options.js';
import type { CompiledChart } from '../families/metrics/document.js';
import type { MetricLayout } from '../families/metrics/layout-common.js';
import type { ResultRow } from '../data/result.js';
import type { MetricInspectionContext } from '../core/inspection-context.js';
import { scalarView, type ScalarValue } from './scalar.js';
import { View, type ViewOptions, type ChartView } from './view.js';
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
  // A negative revision retires the handle and invalidates queued replacements.
  let revision = 0;
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
    theme = options.theme
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
      if (revision < 0) throw new Error('This chart has been disposed.');
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
      revision = -1;
      inner.dispose();
      interactionHosts.delete(handle);
    }
  };
  function replace(next: CompiledChart, nextLayout?: MetricLayout) {
    if (revision < 0) throw new Error('This chart has been disposed.');
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

/** Fixed entries omit HTML switching while sharing the same plotted-view lifecycle. */
export function createMetricPlot(
  host: HTMLElement,
  compiled: CompiledChart,
  layout: MetricLayout,
  options: ViewOptions<ResultRow, MetricInspectionContext>
) {
  const view = new View(
    host,
    options,
    tokens,
    (width, height, measure, hidden) =>
      captureScene(
        layout(compiled, hidden, width, height, measure, options.axes ?? 'minimal'),
        compiled
      ),
    (target, series, snapshot) => metricInspectionContext(snapshot as CompiledChart, target, series)
  );
  const interaction = interactionFor(view.runtime.session);
  const replace = (next: CompiledChart, nextLayout: MetricLayout = layout) => {
    view.assertActive();
    interaction.batch(() => {
      compiled = next;
      layout = nextLayout;
      view.status(next.document.data.rows.length ? null : 'No data');
      view.changed();
    });
  };
  view.status(compiled.document.data.rows.length ? null : 'No data');
  return { view, replace };
}
