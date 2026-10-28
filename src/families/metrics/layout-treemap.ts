import { layoutContext, type MetricLayout } from './layout-common.js';
import { categoryContext } from './categories.js';
import { fitLabel } from '../../core/labels.js';
import { formatQuantity } from '../../data/semantics.js';
import type { PlotRect } from '../../core/scene.js';
import {
  labelSize as tokenLabelSize,
  treemapLabelMax as tokenTreemapLabelMax,
  treemapLabelMin as tokenTreemapLabelMin
} from '../../theme/visual-tokens.js';

/** Balanced rectangles normalize weights before summing to avoid finite-input overflow. */
export function weightedRectangles(
  values: readonly number[],
  bounds: PlotRect
): (PlotRect | null)[] {
  if (values.some((value) => !Number.isFinite(value) || value < 0))
    throw new TypeError('Treemap weights must be finite and non-negative.');
  const result: (PlotRect | null)[] = values.map(() => null);
  const max = Math.max(0, ...values);
  if (!max) return result;
  const items = values.flatMap((value, index) =>
    value / max > 0 ? [{ index, weight: value / max }] : []
  );
  const split = (items: { index: number; weight: number }[], r: PlotRect) => {
    if (items.length === 1) {
      result[items[0].index] = r;
      return;
    }
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let partial = 0,
      index = 0;
    while (index < items.length - 1 && partial < total / 2) partial += items[index++].weight;
    const fraction = partial / total;
    if (r.width >= r.height) {
      const width = r.width * fraction;
      split(items.slice(0, index), { ...r, width });
      split(items.slice(index), { ...r, x: r.x + width, width: r.width - width });
    } else {
      const height = r.height * fraction;
      split(items.slice(0, index), { ...r, height });
      split(items.slice(index), { ...r, y: r.y + height, height: r.height - height });
    }
  };
  split(items, bounds);
  return result;
}

export const layoutTreemap: MetricLayout = (
  compiled,
  hidden,
  width,
  height,
  measure,
  axes = 'full'
) => {
  const { model } = layoutContext(compiled, hidden, width, height, measure, axes);
  const baseSize = measure.fontSize ?? tokenLabelSize;
  const fontScale = baseSize / tokenLabelSize;
  const { items, staticView, display, bounds, makeInteraction } = categoryContext(
    compiled,
    model,
    hidden
  );
  model.emphasis = 'cell';
  const cells = weightedRectangles(
    items.map((item) => item.value ?? 0),
    bounds
  );
  for (const [i, item] of items.entries()) {
    const cell = cells[i];
    const interaction = makeInteraction(
      item,
      cell
        ? { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 }
        : { x: bounds.x, y: bounds.y + bounds.height }
    );
    model.interactions.push(interaction);
    model.interactionByKey.set(item.key, interaction);
    if (!cell) continue;
    const r = {
      ...cell,
      width: Math.max(0, cell.width - 2),
      height: Math.max(0, cell.height - 2)
    };
    model.marks.push({ kind: 'rect', ...r, fill: item.color, key: item.key });
    if (!staticView && r.width >= 40 && r.height >= 24 * fontScale) {
      const size = Math.min(
        tokenTreemapLabelMax * fontScale,
        Math.max(tokenTreemapLabelMin * fontScale, Math.floor(Math.min(r.width / 12, r.height / 5)))
      );
      const fitted = (text: string) =>
        fitLabel(text, r.width - 16, (text) => measure(text) * (size / baseSize) * 1.08);
      const twoLines = r.height >= size * 2 + 18;
      model.marks.push({
        kind: 'text',
        x: r.x + 8,
        y: r.y + 8 + size / 2,
        text: fitted(item.label),
        fontSize: size,
        key: item.key,
        fill: 'var(--color-text-primary)',
        contrastAgainst: item.color
      });
      if (twoLines)
        model.marks.push({
          kind: 'text',
          x: r.x + 8,
          y: r.y + 12 + size * 1.5,
          text: fitted(formatQuantity(item.raw, display)),
          fontSize: size,
          fontWeight: 600,
          key: item.key,
          fill: 'var(--color-text-primary)',
          contrastAgainst: item.color
        });
    }
  }
  return model;
};
