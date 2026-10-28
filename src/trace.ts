import { compileTrace, createTraceView, type TraceSpan } from './families/trace.js';
import { createHierarchy } from './views/hierarchy.js';
import type { ViewOptions } from './views/view.js';
import type { TraceInspectionContext } from './core/inspection-context.js';
import { traceInspectionContext } from './families/hierarchy/inspection-context.js';

export function createTrace(
  host: HTMLElement,
  document: unknown,
  options: ViewOptions<TraceSpan, TraceInspectionContext> = {}
) {
  return createHierarchy(
    host,
    document,
    compileTrace,
    createTraceView,
    traceInspectionContext,
    options
  );
}
export type { ChartView, ChartTheme, ThemeConfig, ThemeMode, ViewOptions } from './views/view.js';
export type { TraceDocument } from './families/trace.js';
