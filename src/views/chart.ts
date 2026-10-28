import { compileChart } from '../families/metrics/document.js';
import { layoutChart } from '../families/metrics/layout.js';
import type { ResultRow } from '../data/result.js';
import type { MetricInspectionContext } from '../core/inspection-context.js';
import { createMetric } from './metric.js';
import type { ChartView, ViewOptions } from './view.js';

/** Complete synchronous metric entry. Use /report to load layouts by type. */
export function createChart(
  host: HTMLElement,
  document: unknown,
  options: ViewOptions<ResultRow, MetricInspectionContext> = {}
): ChartView {
  return createMetric(host, compileChart(document), layoutChart, compileChart, options).view;
}
