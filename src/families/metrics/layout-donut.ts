import { layoutContext, add, type MetricLayout } from './layout-common.js';
import { formatQuantity } from '../../data/semantics.js';
import { chartColumn, chartColumnLabel } from './dataset.js';
import { compactFormat, formatInspectionNumber } from '../../data/format.js';
import { prepareDistributionData } from './prepared.js';
import { ringSectorPath } from './radial-geometry.js';
import {
  donutHoverExpansion as tokenDonutHoverExpansion,
  donutHoverExpansionRatio as tokenDonutHoverExpansionRatio
} from '../../theme/visual-tokens.js';
const surface = 'var(--color-surface)';

export const layoutDonut: MetricLayout = (
  compiled,
  hidden,
  width,
  height,
  measure,
  axes = 'full'
) => {
  const {
    dataset,
    config: { mapping }
  } = compiled;
  if (mapping.kind !== 'distribution')
    throw new TypeError('A donut layout requires a distribution mapping.');
  const { model, finish, visible, labels, showLabels } = layoutContext(
    compiled,
    hidden,
    width,
    height,
    measure,
    axes
  );
  model.emphasis = 'radial';
  const rows = prepareDistributionData(dataset, mapping).filter((row) => !hidden.has(row.category));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!Number.isFinite(total))
    throw new Error('The distribution total exceeds finite number precision.');
  const radius = showLabels
      ? Math.min(height * 0.35, width * 0.28)
      : Math.min(width, height) * 0.41,
    inner = radius * 0.61;
  const cx = width / 2,
    cy = height / 2;
  let angle = -Math.PI / 2;
  for (const row of rows) {
    const fraction = total > 0 ? row.value / total : 0,
      end = angle + fraction * Math.PI * 2;
    const mid = (angle + end) / 2;
    const key = `slice:${row.id}`;
    const fill = visible.find((s) => s.name === row.category)!.color;
    if (fraction > 0)
      model.marks.push({
        kind: 'path',
        d: ringSectorPath(cx, cy, angle, end, radius, inner),
        fill,
        stroke: surface,
        key
      });
    add(
      model,
      {
        key,
        sources: row.sources,
        points: [],
        ...(fraction > 0
          ? {
              radial: {
                expandedPath: ringSectorPath(
                  cx,
                  cy,
                  angle,
                  end,
                  radius +
                    Math.min(tokenDonutHoverExpansion, radius * tokenDonutHoverExpansionRatio),
                  inner
                )
              }
            }
          : {}),
        anchor: {
          x: cx + (Math.cos(mid) * (inner + radius)) / 2,
          y: cy + (Math.sin(mid) * (inner + radius)) / 2
        }
      },
      () => ({
        title: `${chartColumnLabel(dataset, mapping.category)}: ${row.category}`,
        color: fill,
        context: 'Share of visible total',
        rows: [
          {
            label: chartColumnLabel(dataset, mapping.value),
            format: 'number',
            value: (() => {
              const column = chartColumn(dataset, mapping.value)!,
                display = compiled.displays.get(mapping.value);
              const raw = row.sources.map((source) => source[column.columnIndex]);
              if (raw.every((value) => value !== null && /^[+-]?\d+$/.test(value)))
                return formatQuantity(
                  String(raw.reduce((sum, value) => sum + BigInt(value!), 0n)),
                  display
                );
              return display
                ? `${row.value.toFixed(display.decimals ?? 2)}${display.unit ? ` ${display.unit}` : ''}`
                : formatInspectionNumber(row.value);
            })()
          },
          { label: 'Share', value: `${(fraction * 100).toFixed(1)}%`, format: 'number' }
        ]
      })
    );
    if (showLabels && fraction > 0) {
      const right = Math.cos(mid) >= 0;
      const labelX = cx + (right ? 1 : -1) * (radius + 16);
      const y = cy + Math.sin(mid) * (radius + 12);
      labels.push({
        text: `${row.category} ${model.interactionByKey.get(key)!.tooltip.rows[0].value}`,
        x: labelX,
        y,
        align: right ? 'start' : 'end',
        priority: fraction,
        from: { x: cx + Math.cos(mid) * (radius + 4), y: cy + Math.sin(mid) * (radius + 4) }
      });
    }
    angle = end;
  }
  model.center = { value: compactFormat(total), label: chartColumnLabel(dataset, mapping.value) };
  return finish(model);
};
