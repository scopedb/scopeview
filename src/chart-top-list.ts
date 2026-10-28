import { compileChart } from './families/metrics/document.js';
import { chartFactory } from './views/chart-type.js';
import { layoutTopList } from './families/metrics/layout-top-list.js';

/** Ranked lists and horizontal category bars. */
export const createChart = chartFactory('top-list', layoutTopList, compileChart);
export type { ChartView, ChartTheme, ThemeConfig, ThemeMode, ViewOptions } from './views/view.js';
export type { ChartDocumentInput } from './families/metrics/document.js';
