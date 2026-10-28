import type { CompiledChart } from './document.js';
import type { ChartScene, SceneInteraction } from '../../core/scene.js';
import { formatQuantity } from '../../data/semantics.js';
import { chartColumn } from './dataset.js';
import { groupSeriesName } from './prepared.js';
import type { ResultRow } from '../../data/result.js';

export interface CategoryDatum {
  key: string;
  label: string;
  value: number | null;
  raw: string | null;
  source: ResultRow;
  color: string;
}
/** Ranked results remain in returned order; no implicit re-aggregation or ranking. */
function categoryData(compiled: CompiledChart): CategoryDatum[] {
  const { dataset, config } = compiled;
  const mapping = config.mapping;
  const category =
    mapping.kind === 'distribution' ? mapping.category : mapping.kind === 'axis' ? mapping.x : null;
  const metric =
    mapping.kind === 'distribution' ? mapping.value : mapping.kind === 'axis' ? mapping.y[0] : null;
  if (!category || !metric)
    throw new TypeError('A category family requires one category and measure.');
  const c = chartColumn(dataset, category)!,
    v = chartColumn(dataset, metric)!;
  const paints = new Map(compiled.series.map((series) => [series.name, series.color]));
  for (const item of compiled.series[0]?.categories ?? []) paints.set(item.name, item.color);
  return dataset.rows.map((row) => {
    const label = groupSeriesName(row.source[c.columnIndex]),
      value = row.values[v.columnIndex];
    return {
      key: row.id,
      label,
      value: typeof value === 'number' ? value : null,
      raw: row.source[v.columnIndex],
      source: row.source,
      color: paints.get(label) ?? compiled.series[0]?.color ?? 'var(--color-chart-series-1)'
    };
  });
}

export function categoryContext(
  compiled: CompiledChart,
  model: ChartScene,
  hidden: ReadonlySet<string>
) {
  const { width, height } = model,
    { config, dataset } = compiled;
  const mapping = config.mapping;
  const metric =
    mapping.kind === 'distribution' ? mapping.value : mapping.kind === 'axis' ? mapping.y[0] : null;
  if (!metric) throw new TypeError('A category layout requires one measure.');
  const column = chartColumn(dataset, metric)!;
  const display = compiled.displays.get(metric);
  const items = categoryData(compiled).filter((item) => !hidden.has(item.label));
  const staticView = compiled.document.options?.presentation === 'sparkline';
  const ranked = config.displayType !== 'treemap';
  const maximum = Math.max(0, ...items.map((item) => item.value ?? 0));
  const scaledTotal = items.reduce(
    (sum, item) => sum + (maximum > 0 ? (item.value ?? 0) / maximum : 0),
    0
  );
  const bounds = { x: 8, y: 8, width: Math.max(1, width - 16), height: Math.max(1, height - 16) };
  model.rect = bounds;
  const makeInteraction = (
    item: CategoryDatum,
    anchor: { x: number; y: number }
  ): SceneInteraction => ({
    key: item.key,
    sources: [item.source],
    anchor,
    points: [],
    tooltip: {
      title: item.label,
      ...(!ranked ? { context: 'Share of visible total' } : {}),
      rows: [
        {
          label: column.label,
          value: formatQuantity(item.raw, display),
          color: item.color,
          format: 'number'
        },
        ...(!ranked
          ? [
              {
                label: 'Share',
                value:
                  item.value === null
                    ? 'NULL'
                    : `${(maximum > 0 ? (item.value / maximum / scaledTotal) * 100 : 0).toFixed(1)}%`,
                format: 'number' as const
              }
            ]
          : [])
      ]
    }
  });
  return { items, staticView, display, bounds, makeInteraction };
}
