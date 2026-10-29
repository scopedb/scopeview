import { chartFactory } from './views/chart-type.js';
import { layoutAxis } from './families/metrics/layout-axis.js';
import { compileAxis } from './families/metrics/compile-axis.js';

/** Line, area and vertical bar charts share their coordinate, stacking and reading model. */
export const createChart = chartFactory('axis', layoutAxis, compileAxis);
export type { ChartView, ChartTheme, ThemeConfig, ThemeMode, ViewOptions } from './views/view.js';
export type { ChartDocumentInput } from './families/metrics/document.js';
export type { MetricInspectionContext } from './core/inspection-context.js';
