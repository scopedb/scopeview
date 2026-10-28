import { layoutContext, frame, yTicks, add, type MetricLayout } from './layout-common.js';
import { extent, linear, numericAxis } from './scale.js';
import { chartColumnLabel } from './dataset.js';
import { prepareScatterData } from './prepared.js';
import { pointFillOpacity as tokenPointFillOpacity } from '../../theme/visual-tokens.js';

export const layoutScatter: MetricLayout = (
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
  if (mapping.kind !== 'scatter')
    throw new TypeError('A scatter layout requires a scatter mapping.');
  const { model, finish, visible, quantity, miniature } = layoutContext(
    compiled,
    hidden,
    width,
    height,
    measure,
    axes
  );
  model.emphasis = 'point';
  const rows = prepareScatterData(dataset, mapping).filter((row) => !hidden.has(row.series));
  const maximum = extent(rows.map((row) => row.size ?? 0))[1];
  const maxRadius = width < 480 ? 14 : 20;
  const inset = mapping.size ? maxRadius : 5;
  const xAxis = numericAxis(
    rows.map((r) => r.x),
    width < 480 ? 3 : 5
  );
  const yAxis = numericAxis(
    rows.map((r) => r.y),
    height < 240 ? 3 : 5
  );
  const r = frame(width, height, yAxis, !miniature, measure, inset, miniature);
  model.rect = r;
  model.clipRect = { x: r.x - 22, y: r.y - 22, width: r.width + 44, height: r.height + 44 };
  const x = linear(xAxis.domain, [r.x, r.x + r.width]);
  const y = linear(yAxis.domain, [r.y + r.height, r.y]);
  model.xTicks = xAxis.ticks.map((value, i) => ({ position: x(value), label: xAxis.labels[i] }));
  model.yTicks = yTicks(yAxis, y);
  model.baseline = r.y + r.height;
  if (!miniature) {
    const axisTitle = (id: typeof mapping.x) => {
      const unit = compiled.displays.get(id)?.unit;
      return `${chartColumnLabel(dataset, id)}${unit ? ` (${unit})` : ''}`;
    };
    model.xTitle = axisTitle(mapping.x);
    model.yTitle = axisTitle(mapping.y);
  }
  const paints = new Map(visible.map((s) => [s.name, s.color]));
  for (const row of rows) {
    const key = `point:${row.id}`,
      fill = paints.get(row.series)!;
    const anchor = { x: x(row.x), y: y(row.y) };
    const radius =
      row.size === undefined
        ? 5
        : 4 + (maximum > 0 ? Math.sqrt(row.size / maximum) : 0) * (maxRadius - 4);
    model.marks.push({
      kind: 'circle',
      ...anchor,
      radius,
      fill,
      opacity: tokenPointFillOpacity,
      key
    });
    add(model, { key, anchor, points: [], sources: [row.source] }, () => ({
      title: mapping.color
        ? `${chartColumnLabel(dataset, mapping.color)}: ${row.series}`
        : undefined,
      color: mapping.color ? fill : undefined,
      rows: [
        {
          label: chartColumnLabel(dataset, mapping.x),
          value: quantity(mapping.x, row.source),
          format: 'number'
        },
        {
          label: chartColumnLabel(dataset, mapping.y),
          value: quantity(mapping.y, row.source),
          format: 'number'
        },
        ...(mapping.size && row.size !== undefined
          ? [
              {
                label: chartColumnLabel(dataset, mapping.size),
                format: 'number' as const,
                value: quantity(mapping.size, row.source)
              }
            ]
          : [])
      ]
    }));
  }
  return finish(model);
};
