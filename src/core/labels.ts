import type { ChartInteraction, ChartScene, MeasureText, PlotRect, SceneMark } from './scene.js';
import { sparseTicks } from './axes.js';

export interface DataLabel {
  text: string;
  x: number;
  y: number;
  align?: 'start' | 'end';
  priority?: number;
  series?: string;
  /** Optional leader endpoint for a reading outside its mark. */
  from?: { x: number; y: number };
}

/** Bounded, deterministic label placement. Crowded labels defer to exact inspection. */
export function layoutDataLabels(
  candidates: readonly DataLabel[],
  bounds: PlotRect,
  measure: MeasureText
): SceneMark[] {
  const occupied: PlotRect[] = [],
    result: SceneMark[] = [];
  for (const label of [...candidates]
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, 128)) {
    const width = measure(label.text),
      height = (14 * (measure.fontSize ?? 11)) / 11;
    const box = {
      x: label.align === 'end' ? label.x - width : label.x,
      y: label.y - height / 2,
      width,
      height
    };
    if (
      !label.text ||
      box.x < bounds.x ||
      box.y < bounds.y ||
      box.x + width > bounds.x + bounds.width ||
      box.y + height > bounds.y + bounds.height
    )
      continue;
    if (
      occupied.some(
        (other) =>
          box.x < other.x + other.width + 6 &&
          box.x + width + 6 > other.x &&
          box.y < other.y + other.height + 4 &&
          box.y + height + 4 > other.y
      )
    )
      continue;
    occupied.push(box);
    if (label.from)
      result.push({
        kind: 'path',
        d: `M${label.from.x},${label.from.y}L${label.x},${label.y}`,
        fill: 'none',
        stroke: 'var(--color-chart-grid)'
      });
    result.push({
      kind: 'text',
      x: label.x,
      y: label.y,
      text: label.text,
      align: label.align,
      fill: 'var(--color-text-secondary)',
      series: label.series
    });
  }
  return result;
}

/** Accessible readings retain complete values, even when the visual preview is compact. */
export function inspectionText({ tooltip }: ChartInteraction<unknown>): string {
  return [
    tooltip.context,
    tooltip.title,
    ...tooltip.rows.map((row) => `${row.label}: ${row.value}`)
  ]
    .filter(Boolean)
    .join('; ');
}

const graphemes =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function fitLabel(
  text: string,
  width: number,
  measure: MeasureText,
  minimumPrefix = 1
): string {
  if (width < 0) return '';
  if (measure(text) <= width) return text;
  const points = graphemes ? [...graphemes.segment(text)].map((part) => part.segment) : [...text];
  let left = 0,
    right = points.length;
  while (left < right) {
    const middle = Math.ceil((left + right) / 2);
    if (measure(`${points.slice(0, middle).join('')}…`) <= width) left = middle;
    else right = middle - 1;
  }
  return left >= minimumPrefix ? `${points.slice(0, left).join('')}…` : '';
}

/** Resolve labels once so renderers cannot disagree about spacing or truncation. */
export function layoutAxisLabels<Source>(
  scene: ChartScene<Source>,
  measure: MeasureText
): ChartScene<Source> {
  const r = scene.rect;
  if (!r) return scene;
  let previousRight = -Infinity;
  const xTicks = scene.xTicks.flatMap((tick) => {
    const label = fitLabel(tick.label, Math.min(140, r.width), measure),
      width = measure(label);
    const left = Math.max(r.x, Math.min(tick.position - width / 2, r.x + r.width - width));
    if (left < previousRight + 8 || !label) return [];
    previousRight = left + width;
    return [{ ...tick, label, labelPosition: left }];
  });
  return {
    ...scene,
    xTicks,
    yTicks: (measure.fontSize && measure.fontSize > 11
      ? sparseTicks(
          scene.yTicks,
          Math.max(2, Math.floor(r.height / (measure.fontSize + 4))),
          scene.baseline
        )
      : scene.yTicks
    ).map((tick) => ({
      ...tick,
      label: fitLabel(tick.label, r.x - (scene.yTitle ? 32 : 12), measure)
    })),
    ...(scene.xTitle ? { xTitle: fitLabel(scene.xTitle, r.width, measure) } : {}),
    ...(scene.yTitle ? { yTitle: fitLabel(scene.yTitle, r.height, measure) } : {})
  };
}
