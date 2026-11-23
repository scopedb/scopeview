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
  let max = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0)
      throw new TypeError('Treemap weights must be finite and non-negative.');
    if (value > max) max = value;
  }
  const result: (PlotRect | null)[] = values.map(() => null);
  if (!max) return result;
  const indices: number[] = [],
    prefix = [0];
  for (let i = 0; i < values.length; i++) {
    const weight = values[i] / max;
    if (weight > 0) {
      indices.push(i);
      prefix.push(prefix[prefix.length - 1] + weight);
    }
  }
  const split = (lo: number, hi: number, r: PlotRect) => {
    if (hi - lo === 1) {
      result[indices[lo]] = r;
      return;
    }
    let p = prefix,
      offset = 0,
      base = p[lo],
      total = p[hi] - base;
    if (!(total > 0) || base > total * 1e6) {
      p = [0];
      for (let i = lo; i < hi; i++) p.push(p[p.length - 1] + values[indices[i]] / max);
      offset = lo;
      base = 0;
      total = p[p.length - 1];
    }
    const target = total / 2;
    let left = lo + 1,
      right = hi - 1;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (p[mid - offset] - base < target) left = mid + 1;
      else right = mid;
    }
    const fraction = (p[left - offset] - base) / total;
    if (r.width >= r.height) {
      const width = r.width * fraction;
      split(lo, left, { ...r, width });
      split(left, hi, { ...r, x: r.x + width, width: r.width - width });
    } else {
      const height = r.height * fraction;
      split(lo, left, { ...r, height });
      split(left, hi, { ...r, y: r.y + height, height: r.height - height });
    }
  };
  if (indices.length) split(0, indices.length, bounds);
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
  const { model, miniature } = layoutContext(compiled, hidden, width, height, measure, axes);
  const baseSize = measure.fontSize ?? tokenLabelSize;
  const fontScale = baseSize / tokenLabelSize;
  const { items, staticView, display, bounds, makeInteraction } = categoryContext(
    compiled,
    model,
    hidden,
    miniature
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
