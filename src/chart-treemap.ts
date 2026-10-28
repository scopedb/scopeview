import { compileChart } from './families/metrics/document.js';
import { chartFactory } from './views/chart-type.js';
import { layoutTreemap } from './families/metrics/layout-treemap.js';

export const createChart = chartFactory('treemap', layoutTreemap, compileChart);
export type { ChartView, ChartTheme, ThemeConfig, ThemeMode, ViewOptions } from './views/view.js';
export type { ChartDocumentInput } from './families/metrics/document.js';
