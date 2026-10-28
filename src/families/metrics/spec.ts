import type {
  ChartFieldRef,
  ChartFieldInput,
  ChartColumnKind,
  ResultField,
  ResultColumnId
} from '../../data/result.js';
import { object, choice, boolean } from '../../data/validation.js';

export type ChartType = 'bar' | 'line' | 'area';
export type ChartDisplayType =
  | ChartType
  | 'scatter'
  | 'pie'
  | 'big-number'
  | 'top-list'
  | 'treemap';

export interface AxisMapping {
  kind: 'axis';
  x: ResultColumnId;
  y: ResultColumnId[];
  groupBy?: ResultColumnId;
}

export interface ScatterMapping {
  kind: 'scatter';
  x: ResultColumnId;
  y: ResultColumnId;
  size?: ResultColumnId;
  color?: ResultColumnId;
}

export interface DistributionMapping {
  kind: 'distribution';
  category: ResultColumnId;
  value: ResultColumnId;
}

export interface AggregateMapping {
  kind: 'aggregate';
  values: ResultColumnId[];
}

export type ChartMapping = AxisMapping | ScatterMapping | DistributionMapping | AggregateMapping;

/**
 * Resolved chart configuration for one result snapshot. Positional column IDs
 * are intentionally local to that snapshot and never form the persistence
 * contract.
 */
export interface ChartConfig {
  mapping: ChartMapping;
  displayType: ChartDisplayType;
  /** Temporal bars stack by default. Independent usage series set `false` to group side by side. */
  stack?: boolean;
}

export interface AxisEncoding<F = ChartFieldRef> {
  x: F;
  y: F[];
  series?: F;
}

export interface ScatterEncoding<F = ChartFieldRef> {
  x: F;
  y: F;
  size?: F;
  color?: F;
}

export interface DistributionEncoding<F = ChartFieldRef> {
  category: F;
  value: F;
}

export interface AggregateEncoding<F = ChartFieldRef> {
  values: F[];
}

export type ChartEncoding<F = ChartFieldRef> =
  | AxisEncoding<F>
  | ScatterEncoding<F>
  | DistributionEncoding<F>
  | AggregateEncoding<F>;

/**
 * Renderer-neutral persistence boundary. Dashboard panel metadata such as the
 * query reference, title, layout, and refresh policy belongs outside this spec.
 */
export type ChartSpec<F = ChartFieldRef> =
  | { visualization: ChartType; encoding: AxisEncoding<F> }
  | { visualization: 'scatter'; encoding: ScatterEncoding<F> }
  | { visualization: 'pie' | 'top-list' | 'treemap'; encoding: DistributionEncoding<F> }
  | { visualization: 'big-number'; encoding: AggregateEncoding<F> };

/** Authoring fields may be unique names; the visualization selects their roles. */
export type ChartSpecInput<F = ChartFieldInput> = ChartSpec<F>;

interface ChartSpecColumn {
  id: ResultColumnId;
  field: ResultField;
  kind: ChartColumnKind;
}

interface ChartSpecDataset {
  columns: readonly ChartSpecColumn[];
}

export type ChartSpecResolution =
  | { config: ChartConfig; error?: never }
  | { config: null; error: string };

export function fieldRef(dataset: ChartSpecDataset, id: ResultColumnId): ChartFieldRef {
  const index = dataset.columns.findIndex((column) => column.id === id);
  const column = dataset.columns[index];
  if (!column) throw new TypeError(`Unknown chart column: ${id}`);

  const dataType = column.field.data_type;
  const occurrence = dataset.columns
    .slice(0, index)
    .filter(
      (candidate) =>
        candidate.field.name === column.field.name && candidate.field.data_type === dataType
    ).length;
  return {
    name: column.field.name,
    occurrence,
    data_type: dataType
  };
}

export function resolveField(dataset: ChartSpecDataset, ref: ChartFieldRef): ResultColumnId | null {
  const matches = dataset.columns.filter(
    (column) => column.field.name === ref.name && column.field.data_type === ref.data_type
  );
  return matches[ref.occurrence]?.id ?? null;
}

function missingField(ref: ChartFieldRef): ChartSpecResolution {
  const duplicate = ref.occurrence > 0 ? ` (${ref.occurrence + 1})` : '';
  return {
    config: null,
    error: `The chart field “${ref.name}${duplicate}” is not available in this result.`
  };
}

export function createChartSpec(dataset: ChartSpecDataset, config: ChartConfig): ChartSpec {
  object(config, 'config', ['displayType', 'mapping', 'stack']);
  choice(
    config.displayType,
    ['line', 'area', 'bar', 'scatter', 'pie', 'big-number', 'top-list', 'treemap'],
    'config.displayType'
  );
  if (config.stack !== undefined) boolean(config.stack, 'config.stack');
  const { mapping } = config;
  const roles = {
    axis: ['kind', 'x', 'y', 'groupBy'],
    scatter: ['kind', 'x', 'y', 'size', 'color'],
    distribution: ['kind', 'category', 'value'],
    aggregate: ['kind', 'values']
  };
  object(mapping, 'config.mapping');
  const kind = choice(
    mapping.kind,
    ['axis', 'scatter', 'distribution', 'aggregate'],
    'config.mapping.kind'
  );
  object(mapping, 'config.mapping', roles[kind]);
  let encoding: ChartEncoding;
  switch (mapping.kind) {
    case 'axis':
      encoding = {
        x: fieldRef(dataset, mapping.x),
        y: mapping.y.map((id) => fieldRef(dataset, id)),
        series: mapping.groupBy ? fieldRef(dataset, mapping.groupBy) : undefined
      };
      break;
    case 'scatter':
      encoding = {
        x: fieldRef(dataset, mapping.x),
        y: fieldRef(dataset, mapping.y),
        size: mapping.size ? fieldRef(dataset, mapping.size) : undefined,
        color: mapping.color ? fieldRef(dataset, mapping.color) : undefined
      };
      break;
    case 'distribution':
      encoding = {
        category: fieldRef(dataset, mapping.category),
        value: fieldRef(dataset, mapping.value)
      };
      break;
    case 'aggregate':
      encoding = {
        values: mapping.values.map((id) => fieldRef(dataset, id))
      };
      break;
  }
  return { visualization: config.displayType, encoding } as ChartSpec;
}

export function resolveChartSpec(dataset: ChartSpecDataset, spec: ChartSpec): ChartSpecResolution {
  let missing: ChartFieldRef | undefined;
  const resolve = (ref: ChartFieldRef): ResultColumnId => {
    const id = resolveField(dataset, ref);
    if (id === null) missing ??= ref;
    // A mapping with missing fields is discarded below; preserve the first error.
    return id!;
  };
  const optional = (ref: ChartFieldRef | undefined) => (ref ? resolve(ref) : undefined);
  let mapping: ChartMapping;
  switch (spec.visualization) {
    case 'line':
    case 'area':
    case 'bar': {
      const { encoding } = spec;
      mapping = {
        kind: 'axis',
        x: resolve(encoding.x),
        y: encoding.y.map(resolve),
        groupBy: optional(encoding.series)
      };
      break;
    }
    case 'scatter': {
      const { encoding } = spec;
      mapping = {
        kind: 'scatter',
        x: resolve(encoding.x),
        y: resolve(encoding.y),
        size: optional(encoding.size),
        color: optional(encoding.color)
      };
      break;
    }
    case 'pie':
    case 'top-list':
    case 'treemap': {
      const { encoding } = spec;
      mapping = {
        kind: 'distribution',
        category: resolve(encoding.category),
        value: resolve(encoding.value)
      };
      break;
    }
    case 'big-number':
      mapping = { kind: 'aggregate', values: spec.encoding.values.map(resolve) };
      break;
  }
  return missing ? missingField(missing) : { config: { displayType: spec.visualization, mapping } };
}

const AXIS_DISPLAY_TYPES: ChartType[] = ['bar', 'line', 'area'];

export function isAxisDisplayType(type: ChartDisplayType): type is ChartType {
  return AXIS_DISPLAY_TYPES.includes(type as ChartType);
}
