import { layoutAxis } from './layout-axis.js';
import { layoutScatter } from './layout-scatter.js';
import { layoutDonut } from './layout-donut.js';
import { layoutTopList } from './layout-top-list.js';
import { layoutTreemap } from './layout-treemap.js';
import { layoutEmpty, type MetricLayout } from './layout-common.js';
import { metricLayoutKind } from './layout-kind.js';

const layouts = {
  axis: layoutAxis,
  scatter: layoutScatter,
  donut: layoutDonut,
  'top-list': layoutTopList,
  treemap: layoutTreemap,
  aggregate: layoutEmpty
};
/** Complete synchronous layout for the core API and components. Reports load each layout separately. */
export const layoutChart: MetricLayout = (...args) => layouts[metricLayoutKind(args[0])](...args);
