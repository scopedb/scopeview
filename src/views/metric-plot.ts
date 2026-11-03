import { captureScene } from '../core/scene-snapshot.js';
import { interactionFor } from '../core/interaction.js';
import type { CompiledChart } from '../families/metrics/document.js';
import type { MetricLayout } from '../families/metrics/layout-common.js';
import { metricInspectionContext } from '../families/metrics/inspection-context.js';
import type { ResultRow } from '../data/result.js';
import type { MetricInspectionContext } from '../core/inspection-context.js';
import { View, type ViewOptions } from './view.js';
import tokens from '../theme/metric-tokens.css?inline';

/** Plotted metrics share one transaction owner; fixed entries exclude scalar switching. */
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
