import { compileChart } from './families/metrics/document.js';
import { chartFactory } from './views/chart-type.js';
import { layoutDonut } from './families/metrics/layout-donut.js';

export const createChart = chartFactory('donut', layoutDonut, compileChart);
export type { ChartView, ChartTheme, ThemeConfig, ThemeMode, ViewOptions } from './views/view.js';
export type { ChartDocumentInput } from './families/metrics/document.js';
