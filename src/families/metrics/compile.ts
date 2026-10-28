import { fail } from '../../data/validation.js';
import type { QuantityDisplay } from '../../data/semantics.js';
import { resolveChartSpec, resolveField, type ChartConfig } from './spec.js';
import { compileAxisChartModel, type TimeSeriesSource } from './model.js';
import { buildChartDataset, type ChartDataset } from './dataset.js';
import type { ChartDocument } from './parse.js';
import type { buildSeriesInfo } from './series.js';
import type { ValidationResult } from './validation.js';

/** Shared semantic checks and exact source snapshots, independent of supported chart types. */
export function compileMetric(
  document: ChartDocument,
  validate: (dataset: ChartDataset, config: ChartConfig) => ValidationResult,
  buildSeries: typeof buildSeriesInfo
) {
  const original = buildChartDataset(document.data);
  const displays = new Map<string, QuantityDisplay>();
  for (const display of document.options?.values ?? []) {
    const id = resolveField(original, display.field);
    if (!id || display.field.data_type !== 'number')
      fail('options.values', 'Display quantities must match numeric fields.');
    if (displays.has(id)) fail('options.values', 'A field can have only one display policy.');
    displays.set(id, display);
  }
  const dataset = displays.size
    ? {
        ...original,
        rows: original.rows.map((row) => ({
          ...row,
          values: row.values.map((value, index) => {
            const display = displays.get(original.columns[index].id);
            return display && typeof value === 'number' ? value / Number(display.divisor) : value;
          })
        }))
      }
    : original;
  const resolved = resolveChartSpec(dataset, document.spec);
  if (!resolved.config) fail('spec.encoding', resolved.error);
  const config = { ...resolved.config, stack: document.options?.stack };
  const xId = config.mapping.kind === 'axis' ? config.mapping.x : null;
  if (
    document.options?.orientation === 'horizontal' &&
    (config.displayType !== 'bar' ||
      config.mapping.kind !== 'axis' ||
      config.mapping.y.length !== 1 ||
      config.mapping.groupBy ||
      dataset.columns.find((c) => c.id === xId)?.kind !== 'categorical')
  )
    fail(
      'options.orientation',
      'Horizontal frequency bars require one categorical axis and one measure.'
    );
  const validation = validate(dataset, config);
  if (!validation.valid) fail('spec', validation.error ?? 'Invalid mapping.');
  let timeSource: TimeSeriesSource | undefined;
  if (document.semantics?.time) {
    const time = document.semantics.time,
      field = resolveField(dataset, time.field);
    if (
      config.mapping.kind !== 'axis' ||
      field !== config.mapping.x ||
      time.field.data_type !== 'timestamp'
    )
      fail('semantics.time.field', 'Time semantics must match the time axis.');
    timeSource = { ...time, field: field! };
    if (time.kind === 'buckets') {
      const column = dataset.columns.find((column) => column.id === field)!;
      for (const row of dataset.rows) {
        const value = row.values[column.columnIndex];
        const fraction = row.source[column.columnIndex]?.match(/\.(\d+)/)?.[1];
        if (fraction && /[1-9]/.test(fraction.slice(3)))
          fail('semantics.time', 'Bucket starts cannot contain sub-millisecond offsets.');
        if (value instanceof Date && Number(value) % time.intervalMs !== 0)
          fail('semantics.time', 'Bucket starts must align to the epoch interval.');
        if (
          value instanceof Date &&
          time.window &&
          (Number(value) + time.intervalMs <= time.window.start || Number(value) >= time.window.end)
        )
          fail('semantics.time', 'A bucket is outside the executed window.');
      }
      if (
        time.valueKind === 'count' &&
        config.mapping.y.some((id) =>
          dataset.rows.some((row) => {
            const c = dataset.columns.find((c) => c.id === id)!;
            const raw = row.source[c.columnIndex];
            return raw !== null && (!/^\d+$/.test(raw) || BigInt(raw) < 0n);
          })
        )
      )
        fail('semantics.time.valueKind', 'Counts require non-negative integer source values.');
    }
  }
  const axisModel =
    config.mapping.kind === 'axis'
      ? compileAxisChartModel(dataset, config.mapping, timeSource)
      : undefined;
  const series = buildSeries(
    dataset,
    config.mapping,
    document.options?.colors ? new Map(Object.entries(document.options.colors)) : undefined,
    document.options?.colorStrategy,
    ['top-list', 'treemap'].includes(config.displayType)
  );
  return { document, dataset, config, series, axisModel, displays };
}
export type CompiledChart = ReturnType<typeof compileMetric>;
