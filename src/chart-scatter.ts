import { compileChart } from './families/metrics/document.js';
import { chartFactory } from './views/chart-type.js';
import { layoutScatter } from './families/metrics/layout-scatter.js';

export const createChart = chartFactory('scatter', layoutScatter, compileChart);
export type { ChartView, ChartTheme, ThemeConfig, ThemeMode, ViewOptions } from './views/view.js';
export type { ChartDocumentInput } from './families/metrics/document.js';
export type { MetricInspectionContext } from './core/inspection-context.js';
