import {
  type ChartDataset,
  classifyColumns,
  includesColumn,
  chartColumn,
  chartValue
} from './dataset.js';
import {
  type AxisMapping,
  type ChartMapping,
  type DistributionMapping,
  type ChartConfig,
  isAxisDisplayType
} from './spec.js';
import { prepareAxisData, axisPositionKey } from './prepared.js';

const DONUT_MAX_CATEGORIES = 12;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface DistributionCompatibility {
  compatible: boolean;
  categoryCount: number;
  total: number;
  reason?: string;
}

function validateAxisMapping(dataset: ChartDataset, mapping: AxisMapping): ValidationResult {
  const classified = classifyColumns(dataset.columns);
  const dimensions = [...classified.temporal, ...classified.categorical];
  if (!includesColumn(dimensions, mapping.x)) {
    return {
      valid: false,
      error: 'Choose a timestamp or category for the axis.'
    };
  }
  if (mapping.y.length === 0) return { valid: false, error: 'Choose at least one metric.' };
  if (new Set(mapping.y).size !== mapping.y.length) {
    return {
      valid: false,
      error: 'Each metric can be selected only once.'
    };
  }
  if (mapping.y.some((id) => !includesColumn(classified.numeric, id))) {
    return { valid: false, error: 'Axis metrics must be numeric.' };
  }
  if (mapping.groupBy) {
    if (!includesColumn(classified.categorical, mapping.groupBy)) {
      return {
        valid: false,
        error: 'Series must use a categorical column.'
      };
    }
    if (mapping.groupBy === mapping.x) {
      return {
        valid: false,
        error: 'Axis and series must use different columns.'
      };
    }
    if (mapping.y.length > 1) {
      return {
        valid: false,
        error: 'Series splitting supports one metric at a time.'
      };
    }
  }
  return { valid: true };
}

export function validateMapping(
  dataset: ChartDataset,
  mapping: ChartMapping | null
): ValidationResult {
  if (!mapping)
    return {
      valid: false,
      error: 'This result set is best viewed as a table.'
    };
  if (mapping.kind === 'axis') return validateAxisMapping(dataset, mapping);
  const classified = classifyColumns(dataset.columns);

  switch (mapping.kind) {
    case 'scatter': {
      if (
        !includesColumn(classified.numeric, mapping.x) ||
        !includesColumn(classified.numeric, mapping.y)
      ) {
        return {
          valid: false,
          error: 'Scatter axes must use numeric columns.'
        };
      }
      if (mapping.x === mapping.y) {
        return {
          valid: false,
          error: 'Scatter axes must use different columns.'
        };
      }
      if (mapping.size) {
        if (!includesColumn(classified.numeric, mapping.size)) {
          return {
            valid: false,
            error: 'Point size must use a numeric column.'
          };
        }
        if (mapping.size === mapping.x || mapping.size === mapping.y) {
          return {
            valid: false,
            error: 'Point size must use a different column from the axes.'
          };
        }
      }
      if (mapping.color && !includesColumn(classified.categorical, mapping.color)) {
        return {
          valid: false,
          error: 'Point color must use a categorical column.'
        };
      }
      return { valid: true };
    }
    case 'distribution':
      if (!includesColumn(classified.categorical, mapping.category)) {
        return { valid: false, error: 'Choose a categorical column.' };
      }
      if (!includesColumn(classified.numeric, mapping.value)) {
        return { valid: false, error: 'Choose a numeric value column.' };
      }
      return { valid: true };
    case 'aggregate':
      if (mapping.values.length === 0) return { valid: false, error: 'Choose at least one value.' };
      if (new Set(mapping.values).size !== mapping.values.length) {
        return { valid: false, error: 'Each value can be selected only once.' };
      }
      if (mapping.values.some((id) => !includesColumn(classified.numeric, id))) {
        return { valid: false, error: 'Value columns must be numeric.' };
      }
      return { valid: true };
  }
}

export function distributionCompatibility(
  dataset: ChartDataset,
  mapping: DistributionMapping
): DistributionCompatibility {
  // Compiled documents already declare their mapping. Inferring one here would pull
  // the authoring/type-switching machinery into every report chart.
  const mappingValidation = validateMapping(dataset, mapping);
  if (!mappingValidation.valid) {
    return {
      compatible: false,
      categoryCount: 0,
      total: 0,
      reason: mappingValidation.error
    };
  }

  const category = chartColumn(dataset, mapping.category)!;
  const value = chartColumn(dataset, mapping.value)!;
  const sums = new Map<string, number>();
  for (const row of dataset.rows) {
    const rawCategory = chartValue(row, category);
    const rawValue = chartValue(row, value);
    if (rawCategory === null || typeof rawValue !== 'number') continue;
    if (rawValue < 0) {
      return {
        compatible: false,
        categoryCount: 0,
        total: 0,
        reason: 'Donut charts do not support negative values.'
      };
    }
    const key = String(rawCategory);
    const sum = (sums.get(key) ?? 0) + rawValue;
    if (!Number.isFinite(sum)) {
      return {
        compatible: false,
        categoryCount: 0,
        total: 0,
        reason: 'Donut chart values exceed the supported numeric range.'
      };
    }
    sums.set(key, sum);
  }

  const positiveValues = [...sums.values()].filter((value) => value > 0);
  const categoryCount = positiveValues.length;
  const total = positiveValues.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return {
      compatible: false,
      categoryCount,
      total,
      reason: 'Donut charts require a positive total.'
    };
  }
  if (categoryCount < 2) {
    return {
      compatible: false,
      categoryCount,
      total,
      reason: 'Donut charts require at least two positive categories.'
    };
  }
  if (categoryCount > DONUT_MAX_CATEGORIES) {
    return {
      compatible: false,
      categoryCount,
      total,
      reason: 'Donut charts support up to 12 positive categories. Use a bar chart instead.'
    };
  }
  return { compatible: true, categoryCount, total };
}

function validateAxisData(dataset: ChartDataset, mapping: AxisMapping): ValidationResult {
  const xColumn = chartColumn(dataset, mapping.x);
  const seen = new Set<string>();
  for (const row of prepareAxisData(dataset, mapping).rows) {
    // Source text keeps sub-millisecond precision that Date truncates.
    const raw = xColumn?.kind === 'temporal' ? row.source[xColumn.columnIndex] : null;
    const x = raw ?? axisPositionKey(row.x);
    const key = JSON.stringify([x, row.series]);
    if (seen.has(key)) {
      return {
        valid: false,
        error:
          'This result has repeated X values within a series. Aggregate the rows or choose a different X field.'
      };
    }
    seen.add(key);
  }
  return { valid: true };
}

/** Fixed axis reports share the complete checks without retaining other chart validators. */
export function validateAxisConfig(dataset: ChartDataset, config: ChartConfig): ValidationResult {
  if (config.mapping.kind !== 'axis')
    return { valid: false, error: 'This chart type requires axis mappings.' };
  const validation = validateAxisMapping(dataset, config.mapping);
  return validation.valid ? validateAxisData(dataset, config.mapping) : validation;
}

export function validateChartConfig(
  dataset: ChartDataset,
  config: ChartConfig | null
): ValidationResult {
  if (!config) return validateMapping(dataset, null);
  const mappingValidation = validateMapping(dataset, config.mapping);
  if (!mappingValidation.valid) return mappingValidation;

  if (isAxisDisplayType(config.displayType)) {
    if (config.mapping.kind !== 'axis') {
      return { valid: false, error: 'This chart type requires axis mappings.' };
    }

    return validateAxisData(dataset, config.mapping);
  }
  if (config.displayType === 'scatter') {
    if (config.mapping.kind !== 'scatter') {
      return {
        valid: false,
        error: 'Scatter charts require X and Y mappings.'
      };
    }
    if (config.mapping.size) {
      const sizeColumn = chartColumn(dataset, config.mapping.size)!;
      const hasNegative = dataset.rows.some((row) => {
        const value = chartValue(row, sizeColumn);
        return typeof value === 'number' && value < 0;
      });
      if (hasNegative)
        return {
          valid: false,
          error: 'Point size values must be non-negative.'
        };
    }
    return { valid: true };
  }
  if (config.displayType === 'pie') {
    if (config.mapping.kind !== 'distribution') {
      return {
        valid: false,
        error: 'Donut charts require category and value mappings.'
      };
    }
    const compatibility = distributionCompatibility(dataset, config.mapping);
    return compatibility.compatible
      ? { valid: true }
      : { valid: false, error: compatibility.reason };
  }
  if (config.displayType === 'top-list' || config.displayType === 'treemap') {
    if (config.mapping.kind !== 'distribution')
      return { valid: false, error: 'Category charts require category and value mappings.' };
    if (config.displayType === 'treemap') {
      const column = chartColumn(dataset, config.mapping.value)!;
      if (
        dataset.rows.some((row) => {
          const value = chartValue(row, column);
          return value === null || typeof value !== 'number' || value < 0;
        })
      )
        return {
          valid: false,
          error:
            'Treemap weights must be non-negative and non-NULL. Use a Top list or Table for signed/missing values.'
        };
    }
    return { valid: true };
  }
  if (config.mapping.kind !== 'aggregate') {
    return {
      valid: false,
      error: 'Value charts require numeric value mappings.'
    };
  }

  const classified = classifyColumns(dataset.columns);
  if (
    dataset.rows.length !== 1 ||
    classified.numeric.length === 0 ||
    classified.temporal.length > 0 ||
    classified.categorical.length > 0
  ) {
    return {
      valid: false,
      error: 'Value charts require one row containing only numeric columns.'
    };
  }
  for (const id of config.mapping.values) {
    const column = chartColumn(dataset, id)!;
    const value = chartValue(dataset.rows[0], column);
    if (value !== null && typeof value !== 'number') {
      return {
        valid: false,
        error: 'Value charts require finite numeric values or NULL.'
      };
    }
  }
  return { valid: true };
}
