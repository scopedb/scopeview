import { createChart } from './views/chart.js';
import { createTrace } from './trace.js';
import { createFlame } from './flame.js';
import type { ViewOptions, ChartView } from './views/view.js';

export { createChart, createTrace, createFlame };
export { createScalar, type ScalarInput, type ScalarValue } from './scalar.js';
export type { ChartView, ChartTheme, ThemeConfig, ThemeMode, ViewOptions } from './views/view.js';
export type {
  InspectionContext,
  HierarchyInspectionContext,
  MetricInspectionContext,
  TraceInspectionContext,
  ProfileInspectionContext
} from './core/inspection-context.js';
export type { AxisMode } from './core/scene.js';

/** Use a family entry when its kind is known, so other families need not be shipped. */
export function createVisualization(
  host: HTMLElement,
  document: unknown,
  options: ViewOptions<unknown> = {}
): ChartView {
  const kind =
    document && typeof document === 'object' && 'kind' in document ? document.kind : undefined;
  const create = kind === 'trace' ? createTrace : kind === 'profile' ? createFlame : createChart;
  return create(host, document, options);
}
