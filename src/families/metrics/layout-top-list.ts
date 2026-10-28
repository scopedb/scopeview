import { layoutContext, type MetricLayout } from './layout-common.js';
import { categoryContext } from './categories.js';
import { fitLabel } from '../../core/labels.js';
import { formatQuantity } from '../../data/semantics.js';
import { linear } from './scale.js';

export const layoutTopList: MetricLayout = (
  compiled,
  hidden,
  width,
  height,
  measure,
  axes = 'full'
) => {
  const { model } = layoutContext(compiled, hidden, width, height, measure, axes);
  const { items, staticView, display, bounds, makeInteraction } = categoryContext(
    compiled,
    model,
    hidden
  );
  model.emphasis = 'row';
  const labelWidth = staticView ? 0 : Math.min(width * 0.3, 160);
  const valueWidth = staticView
    ? 0
    : Math.min(
        width * 0.28,
        Math.max(50, ...items.map((item) => measure(formatQuantity(item.raw, display))))
      );
  const left = bounds.x + labelWidth,
    right = Math.max(left + 1, width - valueWidth - 16);
  const max = Math.max(0, ...items.map((item) => item.value ?? 0)),
    min = Math.min(0, ...items.map((item) => item.value ?? 0));
  const x = linear([min, max || (min ? 0 : 1)], [left, right]);
  const rowHeight = bounds.height / Math.max(1, items.length);
  for (const [i, item] of items.entries()) {
    const y = bounds.y + i * rowHeight,
      middle = y + rowHeight / 2;
    // The transparent row is an inspection surface for zero and NULL too.
    model.marks.push({
      kind: 'rect',
      x: bounds.x,
      y,
      width: bounds.width,
      height: rowHeight,
      fill: 'transparent',
      key: item.key
    });
    if (item.value !== null && item.value !== 0)
      model.marks.push({
        kind: 'rect',
        x: Math.min(x(0), x(item.value)),
        y: y + rowHeight * 0.14,
        width: Math.abs(x(item.value) - x(0)),
        height: rowHeight * 0.72,
        fill: item.color,
        key: item.key
      });
    if (
      !staticView &&
      (!(measure.fontSize && measure.fontSize > 11) || rowHeight >= measure.fontSize + 4)
    ) {
      model.marks.push({
        kind: 'text',
        x: bounds.x,
        y: middle,
        text: fitLabel(item.label, labelWidth - 8, measure),
        fill: 'var(--color-text-secondary)'
      });
      model.marks.push({
        kind: 'text',
        x: width - 8,
        y: middle,
        text: fitLabel(formatQuantity(item.raw, display), valueWidth, measure),
        align: 'end',
        fill: 'var(--color-text-primary)'
      });
    }
    const interaction = makeInteraction(item, {
      x: item.value === null ? x(0) : x(item.value),
      y: middle
    });
    model.interactions.push(interaction);
    model.interactionByKey.set(item.key, interaction);
  }
  if (min < 0)
    model.marks.push({
      kind: 'path',
      d: `M${x(0)},${bounds.y}V${bounds.y + bounds.height}`,
      fill: 'none',
      stroke: 'var(--color-chart-axis)'
    });
  return model;
};
