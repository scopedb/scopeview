import type { CompiledChart } from '../families/metrics/document.js';
import { layoutChart } from '../families/metrics/layout.js';
import type { ChartRenderer } from './plot-contract.js';
import type { AxisMode, Inspect } from '../core/scene.js';
import { ChartRuntime } from '../runtime/chart-runtime.js';

/** Metric/category family adapter for the shared browser runtime. */
export class Plot extends ChartRuntime implements ChartRenderer {
  private compiled: CompiledChart | null = null;
  private hiddenKeys = '';
  private axes: AxisMode = 'full';
  constructor(
    canvas: HTMLElement,
    decoration: HTMLElement,
    inspect: Inspect,
    invalidate?: () => void
  ) {
    super(canvas, decoration, { inspection: inspect, keyboard: false, invalidate });
  }
  update(compiled: CompiledChart, hidden: Set<string>, axes: AxisMode = 'full') {
    const keys = JSON.stringify([...hidden].sort());
    const reason =
      compiled === this.compiled && keys === this.hiddenKeys && axes === this.axes
        ? 'paint'
        : 'layout';
    this.paint(
      (width, height, measure) => layoutChart(compiled, hidden, width, height, measure, axes),
      reason
    );
    this.compiled = compiled;
    this.hiddenKeys = keys;
    this.axes = axes;
  }
}
