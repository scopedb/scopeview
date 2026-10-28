import {
  type ResultColumnId,
  type ResultField,
  type ResultRow,
  type ResultSet,
  describeResultColumns,
  type ChartColumnKind,
  type ChartDataType,
  CHART_DATA_TYPES
} from '../../data/result.js';
import { choice, object } from '../../data/validation.js';
import { parseResultTimestamp } from '../../data/time.js';

export type ChartValue = number | Date | string;

export interface ChartColumn {
  id: ResultColumnId;
  field: ResultField;
  columnIndex: number;
  kind: ChartColumnKind;
  label: string;
}

export interface ChartSourceRow {
  id: string;
  sourceIndex: number;
  source: ResultRow;
  values: readonly (ChartValue | null)[];
}

export interface ChartDataset {
  columns: readonly ChartColumn[];
  rows: readonly ChartSourceRow[];
}

export interface ClassifiedColumns {
  temporal: ChartColumn[];
  numeric: ChartColumn[];
  categorical: ChartColumn[];
}

export function classifyDataType(dataType: ChartDataType): ChartColumnKind {
  const type = choice(dataType, CHART_DATA_TYPES, 'data_type');
  return type === 'timestamp' ? 'temporal' : type === 'number' ? 'numeric' : 'categorical';
}

function parseChartValue(raw: string | null | undefined, kind: ChartColumnKind): ChartValue | null {
  if (raw === null || raw === undefined) return null;
  if (kind === 'numeric') {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }
  if (kind === 'temporal') {
    const value = parseResultTimestamp(raw);
    return value === null ? null : new Date(value);
  }
  return raw;
}

const chartDatasetCache = new WeakMap<ResultSet, ChartDataset>();

export function buildChartDataset(resultSet: ResultSet): ChartDataset {
  object(resultSet, 'data', ['fields', 'rows']);
  resultSet.fields.forEach((field, index) => {
    object(field, `data.fields[${index}]`, ['name', 'data_type']);
  });
  const cached = chartDatasetCache.get(resultSet);
  if (cached) return cached;

  const nameCounts = new Map<string, number>();
  for (const field of resultSet.fields) {
    nameCounts.set(field.name, (nameCounts.get(field.name) ?? 0) + 1);
  }

  const occurrences = new Map<string, number>();
  const columns = describeResultColumns(resultSet.fields).map(
    ({ id, field, columnIndex }): ChartColumn => {
      const occurrence = (occurrences.get(field.name) ?? 0) + 1;
      occurrences.set(field.name, occurrence);
      return {
        id,
        field,
        columnIndex,
        kind: classifyDataType(field.data_type),
        label: (nameCounts.get(field.name) ?? 0) > 1 ? `${field.name} · ${occurrence}` : field.name
      };
    }
  );

  const rows = resultSet.rows.map(
    (source, sourceIndex): ChartSourceRow => ({
      id: `result-row-${sourceIndex}`,
      sourceIndex,
      source,
      values: columns.map((column) => parseChartValue(source[column.columnIndex], column.kind))
    })
  );

  const dataset = { columns, rows };
  chartDatasetCache.set(resultSet, dataset);
  return dataset;
}

export function classifyColumns(columns: readonly ChartColumn[]): ClassifiedColumns {
  const result: ClassifiedColumns = {
    temporal: [],
    numeric: [],
    categorical: []
  };
  for (const column of columns) result[column.kind].push(column);
  return result;
}

export function chartColumn(dataset: ChartDataset, id: ResultColumnId): ChartColumn | undefined {
  return dataset.columns.find((column) => column.id === id);
}

export function chartColumnLabel(dataset: ChartDataset, id: ResultColumnId): string {
  return chartColumn(dataset, id)?.label ?? id;
}

export function chartValue(row: ChartSourceRow, column: ChartColumn): ChartValue | null {
  return row.values[column.columnIndex] ?? null;
}

export function includesColumn(
  columns: readonly ChartColumn[],
  id: ResultColumnId | undefined
): boolean {
  return id !== undefined && columns.some((column) => column.id === id);
}
