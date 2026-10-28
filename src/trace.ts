import { compileTrace, createTraceView, type TraceSpan } from './families/trace.js';
import { createHierarchy } from './views/hierarchy.js';
import type { ViewOptions } from './views/view.js';

export function createTrace(
  host: HTMLElement,
  document: unknown,
  options: ViewOptions<TraceSpan> = {}
) {
  return createHierarchy(host, document, (value) => createTraceView(compileTrace(value)), options);
}
export type { ChartView, ChartTheme, ThemeConfig, ThemeMode, ViewOptions } from './views/view.js';
export type { TraceDocument } from './families/trace.js';
