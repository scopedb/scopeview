export type ChartColumnKind = 'temporal' | 'numeric' | 'categorical';
/** The three authoring types. Numeric cell strings retain their original precision. */
export const CHART_DATA_TYPES = ['string', 'number', 'timestamp'] as const;
export type ChartDataType = (typeof CHART_DATA_TYPES)[number];

/**
 * Durable field identity for saved chart specifications. Occurrence is counted
 * among fields with the same name and data type, so harmless result-column
 * reordering does not change the binding and duplicate names remain resolvable.
 */
export interface ChartFieldRef {
  name: string;
  occurrence: number;
  data_type: ChartDataType;
}
/**
 * Authoring shorthand: a field name that is unique in the result. Parsing normalizes it to a
 * ChartFieldRef, so saved documents always contain durable references.
 */
export type ChartFieldInput = string | ChartFieldRef;

/** Tabular sources preserve column positions, duplicate names and exact cell strings. */
export interface ResultField {
  name: string;
  data_type: ChartDataType;
}
export interface ResultSet {
  fields: ResultField[];
  rows: (string | null)[][];
}
export type ResultRow = (string | null)[];
export type ResultColumnId = `result-column-${number}`;
export function resultColumnId(columnIndex: number): ResultColumnId {
  return `result-column-${columnIndex}`;
}
export function describeResultColumns(fields: readonly ResultField[]) {
  return fields.map((field, columnIndex) => ({
    id: resultColumnId(columnIndex),
    field,
    columnIndex
  }));
}
