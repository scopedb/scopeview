import type { TimeWindow } from '../../data/time.js';
import type { ResultColumnId, ResultRow } from '../../data/result.js';
import type { AxisMapping } from './spec.js';
import {
  type CategoricalAxisDatum,
  groupSeriesName,
  prepareAxisData,
  type TemporalAxisDatum
} from './prepared.js';
import { type ChartDataset, chartColumn, chartValue } from './dataset.js';
/** Execution metadata supplied by a host. Never persisted in Chart Spec v1. */
export type TimeSeriesSource =
  | { kind: 'points'; field: ResultColumnId; window?: TimeWindow }
  | {
      kind: 'buckets';
      valueKind?: 'count' | 'number';
      field: ResultColumnId;
      intervalMs: number;
      window?: TimeWindow;
      coverage: 'complete' | 'limited' | 'unknown';
      completeThrough?: number;
    };

export interface TimeSample {
  time: number;
  series: string;
  value: number | null;
  state: 'value' | 'null';
  source: ResultRow;
}
interface TimeSeriesBase {
  kind: 'time-series';
  valueKind: 'count' | 'number';
  rows: TemporalAxisDatum[];
  samples: TimeSample[];
  positions: Date[];
  domain: TimeWindow & { source: 'executed' | 'observed' };
  window?: TimeWindow;
}
export type TimeSeriesModel =
  | (TimeSeriesBase & { sampling: 'points' })
  | (TimeSeriesBase & {
      sampling: 'buckets';
      intervalMs: number;
      coverage: 'complete' | 'limited' | 'unknown';
      completeThrough?: number;
      gaps: { start: number; end: number; state: 'not-returned' }[];
    });
export type AxisChartModel =
  | TimeSeriesModel
  | {
      kind: 'categorical';
      rows: CategoricalAxisDatum[];
      positions: string[];
    };

/** Semantic compilation is independent of chart style, visibility and painter implementation. */
export function compileAxisChartModel(
  dataset: ChartDataset,
  mapping: AxisMapping,
  source?: TimeSeriesSource
): AxisChartModel {
  const prepared = prepareAxisData(dataset, mapping);
  if (prepared.kind === 'categorical') {
    if (source) throw new Error('Time metadata requires a time axis.');
    return {
      kind: 'categorical',
      rows: prepared.rows,
      positions: [...new Set(prepared.rows.map((row) => row.x))]
    };
  }
  if (source && source.field !== mapping.x)
    throw new Error('Time metadata does not match the time field.');
  if (source?.kind === 'buckets' && (!Number.isFinite(source.intervalMs) || source.intervalMs < 1))
    throw new Error('A time bucket requires a positive interval.');
  const window = source?.window;
  if (
    window &&
    (!Number.isFinite(window.start) || !Number.isFinite(window.end) || window.start >= window.end)
  )
    throw new Error('The executed time window is invalid.');
  const completeThrough = source?.kind === 'buckets' ? source.completeThrough : undefined;
  if (
    completeThrough !== undefined &&
    (!Number.isSafeInteger(completeThrough) ||
      Math.abs(completeThrough) > 8.64e15 ||
      (window && (completeThrough < window.start || completeThrough > window.end)))
  )
    throw new Error('The bucket completeness watermark is invalid.');
  const x = chartColumn(dataset, mapping.x)!;
  const group = mapping.groupBy ? chartColumn(dataset, mapping.groupBy)! : undefined;
  const metrics = mapping.y.map((id) => chartColumn(dataset, id)!);
  const samples: TimeSample[] = [];
  const times = new Set<number>();
  for (const row of dataset.rows) {
    const time = chartValue(row, x);
    if (!(time instanceof Date)) continue;
    times.add(time.getTime());
    for (const metric of metrics) {
      const value = chartValue(row, metric);
      samples.push({
        time: time.getTime(),
        series: group ? groupSeriesName(chartValue(row, group)) : metric.label,
        value: typeof value === 'number' ? value : null,
        state: typeof value === 'number' ? 'value' : 'null',
        source: row.source
      });
    }
  }
  const sorted = [...times].sort((a, b) => a - b);
  const start = window?.start ?? sorted[0] ?? 0;
  const end = window?.end ?? sorted.at(-1) ?? start;
  const base: TimeSeriesBase = {
    kind: 'time-series',
    valueKind: source?.kind === 'buckets' && source.valueKind === 'count' ? 'count' : 'number',
    rows: prepared.rows,
    samples,
    window,
    positions: sorted.map((time) => new Date(time)),
    domain: { start, end, source: window ? 'executed' : 'observed' }
  };
  if (source?.kind !== 'buckets') return { ...base, sampling: 'points' };
  const gaps: { start: number; end: number; state: 'not-returned' }[] = [];
  for (let index = 1; index < sorted.length; index++) {
    const missing = sorted[index - 1] + source.intervalMs;
    if (missing < sorted[index])
      gaps.push({ start: missing, end: sorted[index], state: 'not-returned' });
  }
  // A sentinel is geometry only: no source row, value or inspection target is invented.
  base.positions = [...sorted, ...gaps.map((gap) => gap.start)]
    .sort((a, b) => a - b)
    .map((time) => new Date(time));
  if (!window && sorted.length) base.domain.end = sorted.at(-1)! + source.intervalMs;
  if (window) base.domain.start = Math.floor(window.start / source.intervalMs) * source.intervalMs;
  return {
    ...base,
    sampling: 'buckets',
    intervalMs: source.intervalMs,
    coverage: source.coverage,
    completeThrough: source.completeThrough,
    gaps
  };
}
