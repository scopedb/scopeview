import { interactionHosts } from './interactions.js';
import { parseViewOptions } from './options.js';
import type { CompiledChart } from '../families/metrics/document.js';
import { metricLayoutKind } from '../families/metrics/layout-kind.js';
import type { MetricLayout } from '../families/metrics/layout-common.js';
import type { ResultRow } from '../data/result.js';
import type { MetricInspectionContext } from '../core/inspection-context.js';
import { createMetricPlot } from './metric-plot.js';
import type { ChartView, ViewOptions } from './view.js';

/** Fixed-type entries can omit the other layouts and the automatic download router. */
export function chartFactory(
  kind: Exclude<ReturnType<typeof metricLayoutKind>, 'aggregate'>,
  layout: MetricLayout,
  compile: (document: unknown) => CompiledChart
) {
  return (
    host: HTMLElement,
    document: unknown,
    options: ViewOptions<ResultRow, MetricInspectionContext> = {}
  ): ChartView => {
    const prepare = (document: unknown) => {
      const compiled = compile(document);
      if (metricLayoutKind(compiled) !== kind)
        throw new TypeError(
          `This chart entry supports ${kind} layouts. Use /chart for all metric layouts.`
        );
      return compiled;
    };
    const { view, replace } = createMetricPlot(
      host,
      prepare(document),
      layout,
      parseViewOptions(options)
    );
    const handle: ChartView = {
      update(document) {
        view.assertActive();
        replace(prepare(document));
      },
      get theme() {
        return view.theme;
      },
      set theme(value) {
        view.theme = value;
      },
      refresh: () => view.refresh(),
      dispose() {
        view.dispose();
        interactionHosts.delete(handle);
      }
    };
    interactionHosts.set(handle, interactionHosts.get(view));
    return handle;
  };
}
