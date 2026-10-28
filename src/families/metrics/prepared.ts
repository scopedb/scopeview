import type { ResultRow, ResultColumnId } from '../../data/result.js';
import { type ChartValue, type ChartDataset, chartColumn, chartValue } from './dataset.js';
import type { AxisMapping, ScatterMapping, DistributionMapping, AggregateMapping } from './spec.js';

export interface AxisDatumBase {
  id: string;
  source: ResultRow;
  sourceIndex: number;
  y: number;
  series: string;
  metric: string;
}

export interface TemporalAxisDatum extends AxisDatumBase {
  x: Date;
}

export interface CategoricalAxisDatum extends AxisDatumBase {
  x: string;
}

export type PreparedAxisData =
  | { kind: 'temporal'; rows: TemporalAxisDatum[] }
  | { kind: 'categorical'; rows: CategoricalAxisDatum[] };

export function axisPositionKey(value: Date | string): number | string {
  return value instanceof Date ? value.getTime() : value;
}

export function axisGroupSourceRows(
  rows: readonly (TemporalAxisDatum | CategoricalAxisDatum)[],
  x: Date | string,
  hiddenSeries: ReadonlySet<string> = new Set()
): ResultRow[] {
  const key = axisPositionKey(x);
  return [
    ...new Set(
      rows
        .filter((row) => axisPositionKey(row.x) === key && !hiddenSeries.has(row.series))
        .map((row) => row.source)
    )
  ];
}

/** Keep SQL NULL, empty strings and literal NULL distinct in every shared series. */
export function groupSeriesName(value: ChartValue | null): string {
  if (value === null) return 'NULL';
  const label = String(value);
  return label === '' || label === 'NULL' || label.startsWith('"') ? JSON.stringify(label) : label;
}

const axisDataCache = new WeakMap<ChartDataset, WeakMap<AxisMapping, PreparedAxisData>>();

export function prepareAxisData(dataset: ChartDataset, mapping: AxisMapping): PreparedAxisData {
  const cached = axisDataCache.get(dataset)?.get(mapping);
  if (cached) return cached;
  const prepared = computeAxisData(dataset, mapping);
  let byMapping = axisDataCache.get(dataset);
  if (!byMapping) {
    byMapping = new WeakMap();
    axisDataCache.set(dataset, byMapping);
  }
  byMapping.set(mapping, prepared);
  return prepared;
}

function computeAxisData(dataset: ChartDataset, mapping: AxisMapping): PreparedAxisData {
  const xColumn = chartColumn(dataset, mapping.x)!;
  const yColumns = mapping.y.map((id) => chartColumn(dataset, id)!);
  const groupColumn = mapping.groupBy ? chartColumn(dataset, mapping.groupBy) : undefined;

  if (xColumn.kind === 'temporal') {
    const rows: TemporalAxisDatum[] = [];
    for (const row of dataset.rows) {
      const x = chartValue(row, xColumn);
      const group = groupColumn ? chartValue(row, groupColumn) : null;
      if (!(x instanceof Date)) continue;
      for (const yColumn of yColumns) {
        const y = chartValue(row, yColumn);
        if (typeof y !== 'number') continue;
        const series = groupColumn ? groupSeriesName(group) : yColumn.label;
        rows.push({
          id: `${row.id}:${yColumn.id}:${series}`,
          source: row.source,
          sourceIndex: row.sourceIndex,
          x,
          y,
          series,
          metric: yColumn.label
        });
      }
    }
    rows.sort((left, right) => left.x.getTime() - right.x.getTime());
    return { kind: 'temporal', rows };
  }

  const rows: CategoricalAxisDatum[] = [];
  for (const row of dataset.rows) {
    const x = chartValue(row, xColumn);
    const group = groupColumn ? chartValue(row, groupColumn) : null;
    if (x === null) continue;
    for (const yColumn of yColumns) {
      const y = chartValue(row, yColumn);
      if (typeof y !== 'number') continue;
      const series = groupColumn ? groupSeriesName(group) : yColumn.label;
      rows.push({
        id: `${row.id}:${yColumn.id}:${series}`,
        source: row.source,
        sourceIndex: row.sourceIndex,
        x: String(x),
        y,
        series,
        metric: yColumn.label
      });
    }
  }
  return { kind: 'categorical', rows };
}

export interface ScatterDatum {
  id: string;
  source: ResultRow;
  sourceIndex: number;
  x: number;
  y: number;
  size?: number;
  series: string;
}

export function prepareScatterData(dataset: ChartDataset, mapping: ScatterMapping): ScatterDatum[] {
  const xColumn = chartColumn(dataset, mapping.x)!;
  const yColumn = chartColumn(dataset, mapping.y)!;
  const sizeColumn = mapping.size ? chartColumn(dataset, mapping.size) : undefined;
  const colorColumn = mapping.color ? chartColumn(dataset, mapping.color) : undefined;
  const fallbackSeries = yColumn.label;
  const rows: ScatterDatum[] = [];

  for (const row of dataset.rows) {
    const x = chartValue(row, xColumn);
    const y = chartValue(row, yColumn);
    const size = sizeColumn ? chartValue(row, sizeColumn) : undefined;
    const color = colorColumn ? chartValue(row, colorColumn) : undefined;
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    if (sizeColumn && typeof size !== 'number') continue;
    if (colorColumn && color === null) continue;
    rows.push({
      id: row.id,
      source: row.source,
      sourceIndex: row.sourceIndex,
      x,
      y,
      size: typeof size === 'number' ? size : undefined,
      series: colorColumn ? groupSeriesName(color!) : fallbackSeries
    });
  }
  return rows;
}

export interface DistributionDatum {
  id: string;
  category: string;
  value: number;
  sources: readonly ResultRow[];
}

export function prepareDistributionData(
  dataset: ChartDataset,
  mapping: DistributionMapping
): DistributionDatum[] {
  const categoryColumn = chartColumn(dataset, mapping.category)!;
  const valueColumn = chartColumn(dataset, mapping.value)!;
  const grouped = new Map<string, { value: number; sources: ResultRow[] }>();
  for (const row of dataset.rows) {
    const category = chartValue(row, categoryColumn);
    const value = chartValue(row, valueColumn);
    if (category === null || typeof value !== 'number') continue;
    const key = groupSeriesName(category);
    const current = grouped.get(key) ?? { value: 0, sources: [] };
    current.value += value;
    current.sources.push(row.source);
    grouped.set(key, current);
  }
  return [...grouped]
    .filter(([, item]) => item.value > 0)
    .sort((left, right) => right[1].value - left[1].value)
    .map(([category, item], index) => ({
      id: `distribution-${index}`,
      category,
      value: item.value,
      sources: item.sources
    }));
}

export interface AggregateValue {
  id: ResultColumnId;
  label: string;
  value: number | null;
}

export function prepareAggregateValues(
  dataset: ChartDataset,
  mapping: AggregateMapping
): AggregateValue[] {
  const row = dataset.rows[0];
  if (!row) return [];
  return mapping.values.flatMap((id) => {
    const column = chartColumn(dataset, id);
    if (!column) return [];
    const value = chartValue(row, column);
    return value === null || typeof value === 'number' ? [{ id, label: column.label, value }] : [];
  });
}
