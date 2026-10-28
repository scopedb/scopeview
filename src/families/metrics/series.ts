import {
  type ChartColorStrategy,
  effectiveColorStrategy,
  semanticPaint,
  semanticFamily
} from '../../theme/colors.js';
import { type ChartDataset, type ChartColumn, chartColumn, chartValue } from './dataset.js';
import { type ChartMapping, fieldRef } from './spec.js';
import {
  prepareAxisData,
  groupSeriesName,
  prepareScatterData,
  prepareDistributionData,
  prepareAggregateValues
} from './prepared.js';

/** Color identity includes derived column semantics, independently of document serialization. */
function colorField(dataset: ChartDataset, id: ChartColumn['id']) {
  const ref = fieldRef(dataset, id);
  return {
    name: ref.name,
    kind: chartColumn(dataset, id)!.kind,
    occurrence: ref.occurrence,
    data_type: ref.data_type
  };
}

// Token generation retains every interpolated slot, including its paired line role.
export const CHART_PALETTE = /* @__PURE__ */ Array.from(
  { length: 10 },
  (_, index) => `var(--color-chart-series-${index + 1})`
);

/** FNV-1a over UTF-8. Keep this identity-to-slot mapping independent of visible series. */
function seriesColor(identity: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(identity)) {
    hash = Math.imul(hash ^ byte, 0x01000193);
  }
  // Collisions are intentional: local reassignment would break cross-chart consistency.
  return CHART_PALETTE[(hash >>> 0) % CHART_PALETTE.length];
}

export interface SeriesInfo {
  name: string;
  color: string;
  lineColor?: string;
  lineType?: 'solid' | 'dashed';
  sum: number;
  categories?: SeriesInfo[];
}

/** Derive line roles from assigned colors, never the current visible rank. */
function seriesPaint(color: string): Pick<SeriesInfo, 'color' | 'lineColor' | 'lineType'> {
  const index = (CHART_PALETTE as readonly string[]).indexOf(color);
  return {
    color,
    lineColor: index < 0 ? color : color.replace(')', '-line)'),
    lineType: [4, 6, 7, 8, 9].includes(index) ? 'dashed' : 'solid'
  };
}

function seriesInfoFromSums(
  sums: Map<string, number>,
  colorOverrides: ReadonlyMap<string, string> | undefined,
  identity: (name: string) => string,
  strategy: ChartColorStrategy,
  field: string | undefined,
  singleMetric: boolean
): SeriesInfo[] {
  const mode = effectiveColorStrategy(strategy, field, singleMetric);
  const ranking =
    mode === 'ranked'
      ? [...sums].sort(
          ([a, av], [b, bv]) =>
            bv - av || (identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0)
        )
      : [];
  const ranks = new Map(ranking.map(([name], index) => [name, index]));
  return [...sums].map(([name, sum]) => ({
    name,
    sum,
    ...(colorOverrides?.has(name)
      ? seriesPaint(colorOverrides.get(name)!)
      : mode === 'semantic'
        ? semanticPaint(name, semanticFamily(field))
        : seriesPaint(
            mode === 'theme'
              ? CHART_PALETTE[0]
              : mode === 'ranked'
                ? CHART_PALETTE[ranks.get(name)! % CHART_PALETTE.length]
                : seriesColor(identity(name))
          ))
  }));
}

/** The explicitly mapped category, including categorical axes with one measure. */
function chartColorField(dataset: ChartDataset, mapping: ChartMapping): ChartColumn | undefined {
  const id =
    mapping.kind === 'axis'
      ? (mapping.groupBy ??
        (mapping.y.length === 1 && chartColumn(dataset, mapping.x)?.kind === 'categorical'
          ? mapping.x
          : undefined))
      : mapping.kind === 'scatter'
        ? mapping.color
        : mapping.kind === 'distribution'
          ? mapping.category
          : undefined;
  return id ? chartColumn(dataset, id) : undefined;
}

function seriesContext(
  dataset: ChartDataset,
  mapping: ChartMapping,
  colorOverrides?: ReadonlyMap<string, string>,
  strategy: ChartColorStrategy = 'auto'
) {
  const dimension =
    mapping.kind === 'axis'
      ? mapping.groupBy
      : mapping.kind === 'scatter'
        ? mapping.color
        : mapping.kind === 'distribution'
          ? mapping.category
          : undefined;
  const identity = (name: string) =>
    dimension
      ? JSON.stringify(['dimension', colorField(dataset, dimension), name])
      : JSON.stringify([
          'metric',
          colorField(dataset, dataset.columns.find((column) => column.label === name)!.id)
        ]);
  const fromSums = (sums: Map<string, number>) =>
    seriesInfoFromSums(
      sums,
      colorOverrides,
      identity,
      strategy,
      dimension ? chartColumn(dataset, dimension)?.field.name : undefined,
      mapping.kind === 'axis'
        ? mapping.y.length === 1
        : mapping.kind === 'scatter' ||
            (mapping.kind === 'aggregate' && mapping.values.length === 1)
    );
  return { dimension, fromSums };
}

export function buildAxisSeriesInfo(
  dataset: ChartDataset,
  mapping: ChartMapping,
  colorOverrides?: ReadonlyMap<string, string>,
  strategy: ChartColorStrategy = 'auto'
): SeriesInfo[] {
  if (mapping.kind !== 'axis') throw new TypeError('Axis series require axis mappings.');
  const { dimension, fromSums } = seriesContext(dataset, mapping, colorOverrides, strategy);
  const prepared = prepareAxisData(dataset, mapping);
  const sums = new Map<string, number>();
  for (const row of prepared.rows) sums.set(row.series, (sums.get(row.series) ?? 0) + row.y);
  // A returned NULL is still a series and a source reading, even with no painted values.
  if (prepared.kind === 'temporal')
    for (const row of dataset.rows)
      for (const id of mapping.y) {
        const name = dimension
          ? groupSeriesName(chartValue(row, chartColumn(dataset, dimension)!))
          : chartColumn(dataset, id)!.label;
        if (!sums.has(name)) sums.set(name, 0);
      }
  const series = fromSums(sums);
  const category = !dimension ? chartColorField(dataset, mapping) : undefined;
  if (category && (strategy !== 'auto' || semanticFamily(category.field.name))) {
    const values = new Map<string, number>();
    for (const row of prepared.rows) {
      const name = groupSeriesName(row.x);
      values.set(name, (values.get(name) ?? 0) + row.y);
    }
    const categories = seriesInfoFromSums(
      values,
      undefined,
      (name) => JSON.stringify(['dimension', colorField(dataset, category.id), name]),
      strategy,
      category.field.name,
      false
    );
    return series.map((item) => ({ ...item, categories }));
  }
  return series;
}

export function buildSeriesInfo(
  dataset: ChartDataset,
  mapping: ChartMapping,
  colorOverrides?: ReadonlyMap<string, string>,
  strategy: ChartColorStrategy = 'auto',
  retainCategories = false
): SeriesInfo[] {
  if (mapping.kind === 'axis')
    return buildAxisSeriesInfo(dataset, mapping, colorOverrides, strategy);
  const { fromSums } = seriesContext(dataset, mapping, colorOverrides, strategy);
  if (mapping.kind === 'scatter') {
    const prepared = prepareScatterData(dataset, mapping);
    const sums = new Map<string, number>();
    for (const row of prepared) sums.set(row.series, (sums.get(row.series) ?? 0) + 1);
    return fromSums(sums);
  }
  if (mapping.kind === 'distribution') {
    if (retainCategories) {
      const c = chartColumn(dataset, mapping.category)!,
        v = chartColumn(dataset, mapping.value)!;
      const sums = new Map<string, number>();
      for (const row of dataset.rows) {
        const name = groupSeriesName(row.source[c.columnIndex]),
          value = chartValue(row, v);
        sums.set(name, (sums.get(name) ?? 0) + (typeof value === 'number' ? value : 0));
      }
      return fromSums(sums);
    }
    const sums = new Map(
      prepareDistributionData(dataset, mapping).map((row) => [row.category, row.value])
    );
    return fromSums(sums);
  }
  return fromSums(
    new Map(
      prepareAggregateValues(dataset, mapping).flatMap((item) =>
        item.value === null ? [] : [[item.label, item.value] as const]
      )
    )
  );
}
