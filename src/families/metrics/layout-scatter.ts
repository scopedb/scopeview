import { layoutContext, frame, yTicks, add, type MetricLayout } from './layout-common.js';
import { extent, linear, numericAxis } from './scale.js';
import { chartColumnLabel } from './dataset.js';
import { prepareScatterData } from './prepared.js';
import {
  pointFillOpacity as tokenPointFillOpacity,
  pointPinnedGrowth as tokenPointPinnedGrowth
} from '../../theme/visual-tokens.js';

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
  const maximum = mapping.size ? extent(rows.map((row) => row.size ?? 0))[1] : 0;
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
  const clipPad = inset + tokenPointPinnedGrowth;
  model.rect = r;
  model.clipRect = {
    x: r.x - clipPad,
    y: r.y - clipPad,
    width: r.width + clipPad * 2,
    height: r.height + clipPad * 2
  };
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
    add(model, { key, anchor, points: [], sources: [row.source] }, () => {
      const item = (id: typeof mapping.x) => ({
        label: chartColumnLabel(dataset, id),
        value: quantity(id, row.source),
        format: 'number' as const
      });
      return {
        title: mapping.color
          ? `${chartColumnLabel(dataset, mapping.color)}: ${row.series}`
          : undefined,
        color: mapping.color ? fill : undefined,
        rows: [
          item(mapping.x),
          item(mapping.y),
          ...(mapping.size && row.size !== undefined ? [item(mapping.size)] : [])
        ]
      };
    });
  }
  return finish(model);
};
