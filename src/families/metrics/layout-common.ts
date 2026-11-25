import type { CompiledChart } from './document.js';
import { sparseTicks } from '../../core/axes.js';
import { layoutAxisLabels, layoutDataLabels, type DataLabel } from '../../core/labels.js';
import { formatQuantity } from '../../data/semantics.js';
import type {
  AxisMode,
  ChartInteraction,
  ChartScene,
  SceneInteraction,
  MeasureText,
  PlotRect,
  Tick
} from '../../core/scene.js';
import type { NumericAxis } from './scale.js';
import { chartAriaLabel } from './accessibility.js';
import {
  reportAxisTicks as tokenReportAxisTicks,
  reportDirectLabels as tokenReportDirectLabels
} from '../../theme/visual-tokens.js';

export type MetricLayout = (
  compiled: CompiledChart,
  hidden: ReadonlySet<string>,
  width: number,
  height: number,
  measure: MeasureText,
  axes?: AxisMode
) => ChartScene;
export function frame(
  width: number,
  height: number,
  axis: NumericAxis,
  full: boolean,
  measure: MeasureText,
  inset = 0,
  miniature = false,
  caption = full,
  compact = false
): PlotRect {
  if (miniature)
    return { x: 1, y: 1, width: Math.max(1, width - 2), height: Math.max(1, height - 2) };
  const labelWidth = Math.min(width * 0.25, Math.max(...axis.labels.map(measure)));
  const x = Math.max(full ? 30 : 8, inset + 8) + labelWidth + 8,
    pad = compact ? 6 : 16,
    y = pad + inset;
  return {
    x,
    y,
    width: Math.max(1, width - x - pad - inset),
    height: Math.max(
      1,
      compact
        ? height - y * 2
        : height - y - (caption ? 56 : 30) - Math.max(0, (measure.fontSize ?? 11) - 11) * 2
    )
  };
}
export function yTicks(axis: NumericAxis, scale: (n: number) => number): Tick[] {
  return axis.ticks.map((value, i) => ({ position: scale(value), label: axis.labels[i] }));
}
export function add(
  model: ChartScene,
  fields: Omit<SceneInteraction, 'tooltip'>,
  inspect: () => ChartInteraction['tooltip']
) {
  let tooltip: ChartInteraction['tooltip'] | undefined;
  // Formatting is comparatively expensive, especially local time zones. A chart with
  // 10,000 observations should only format the positions that the user inspects.
  // Keep family getters lazy too: spreading fields would evaluate every time label.
  const interaction = Object.defineProperty(fields, 'tooltip', {
    enumerable: true,
    get() {
      tooltip ??= inspect();
      return tooltip;
    }
  }) as SceneInteraction;
  model.interactions.push(interaction);
  model.interactionByKey.set(interaction.key, interaction);
}

export function layoutContext(
  compiled: CompiledChart,
  hidden: ReadonlySet<string>,
  width: number,
  height: number,
  measure: MeasureText,
  axes?: AxisMode
) {
  const { dataset, config } = compiled;
  const { mapping, displayType } = config;
  const presentation = compiled.document.options?.presentation ?? 'full';
  const sparkline = presentation === 'sparkline';
  const mode: AxisMode = axes ?? (sparkline ? 'none' : 'full');
  const full = !sparkline && mode === 'full';
  const compact = sparkline && mode === 'minimal';
  const miniature = mode === 'none' || (sparkline && !compact);
  const report = mode === 'minimal' && !miniature;
  const directLabels =
    report &&
    !compact &&
    displayType === 'bar' &&
    compiled.axisModel?.kind === 'categorical' &&
    compiled.series.length === 1 &&
    dataset.rows.length <= tokenReportDirectLabels;
  const labels: DataLabel[] = [];
  const showLabels =
    !miniature &&
    !compact &&
    (compiled.document.options?.labels === 'auto' ||
      (compiled.document.options?.labels === undefined && directLabels));
  const finish = (scene: ChartScene) => {
    if (miniature || compact) {
      scene.xTicks = [];
      delete scene.baseline;
      if (miniature) scene.yTicks = [];
    }
    if (showLabels)
      scene.labels = layoutDataLabels(
        labels,
        { x: 4, y: 4, width: width - 8, height: height - 8 },
        measure
      );
    if (report) {
      scene.axisStyle = 'minimal';
      scene.yTicks = sparseTicks(scene.yTicks, compact ? 2 : tokenReportAxisTicks, scene.baseline);
      if (!compact) {
        if (compiled.axisModel?.kind === 'time-series' || mapping.kind === 'scatter')
          scene.xTicks = sparseTicks(scene.xTicks, tokenReportAxisTicks);
        // Only omit the value ruler when every source has a visible exact label.
        if (
          directLabels &&
          scene.labels?.length === scene.interactions.length &&
          scene.labels.length
        )
          scene.yTicks = [];
      }
    }
    return layoutAxisLabels(scene, measure);
  };
  const visible = compiled.series.filter((series) => !hidden.has(series.name));
  const quantity = (id: string, source: readonly (string | null)[]) =>
    formatQuantity(
      source[dataset.columns.find((c) => c.id === id)!.columnIndex],
      compiled.displays.get(id)
    );
  const model: ChartScene = {
    width,
    height,
    rect: null,
    marks: [],
    xTicks: [],
    yTicks: [],
    hitMode: 'item',
    interactions: [],
    interactionByKey: new Map(),
    ariaLabel: chartAriaLabel(dataset, config),
    interactive: compiled.document.options?.interactive ?? !sparkline,
    provenance: compiled.document.semantics?.provenance
  };
  return {
    model,
    finish,
    visible,
    quantity,
    labels,
    showLabels,
    full,
    miniature,
    report,
    compact
  };
}

export const layoutEmpty: MetricLayout = (...args) => layoutContext(...args).model;
