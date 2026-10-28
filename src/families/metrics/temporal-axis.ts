import { localTimeZone, formatLocalTime, formatDate, zoneLabel } from '../../data/date-time.js';

const MINUTE_MS = 60_000;

const HOUR_MS = 60 * MINUTE_MS;

const DAY_MS = 24 * 60 * MINUTE_MS;

const YEAR_MS = 365 * DAY_MS;

export function formatTemporalTick(
  value: Date,
  spanMs: number,
  timeZone = localTimeZone()
): string {
  const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  if (spanMs < HOUR_MS) time.second = '2-digit';
  if (spanMs < 10_000) time.fractionalSecondDigits = 3;
  if (spanMs < DAY_MS) return formatLocalTime(value, time, timeZone);
  if (spanMs < 3 * DAY_MS)
    return formatLocalTime(value, { month: 'short', day: 'numeric', ...time }, timeZone);
  if (spanMs < 120 * DAY_MS)
    return formatLocalTime(value, { month: 'short', day: 'numeric' }, timeZone);
  if (spanMs < 2 * YEAR_MS)
    return formatLocalTime(value, { month: 'short', year: '2-digit' }, timeZone);
  return formatLocalTime(value, { year: 'numeric' }, timeZone);
}

export function temporalTickMinInterval(spanMs: number): number {
  if (spanMs < 10_000) return 1;
  if (spanMs < HOUR_MS) return 1_000;
  if (spanMs < 3 * DAY_MS) return MINUTE_MS;
  if (spanMs < 120 * DAY_MS) return DAY_MS;
  if (spanMs < 2 * YEAR_MS) return 28 * DAY_MS;
  return YEAR_MS;
}

export type TemporalStepUnit =
  | 'millisecond'
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'month'
  | 'year';

/** One interval labels the whole temporal axis, never a month-restarted day sequence. */
export interface TemporalStep {
  unit: TemporalStepUnit;
  count: number;
}

const TEMPORAL_STEPS: readonly TemporalStep[] = [
  ...[1, 2, 5, 10, 20, 50, 100, 200, 500].map((count) => ({
    unit: 'millisecond' as const,
    count
  })),
  ...[1, 2, 5, 10, 15, 30].map((count) => ({ unit: 'second' as const, count })),
  ...[1, 2, 5, 10, 15, 30].map((count) => ({ unit: 'minute' as const, count })),
  ...[1, 2, 3, 6, 12].map((count) => ({ unit: 'hour' as const, count })),
  ...[1, 2, 3, 7, 14].map((count) => ({ unit: 'day' as const, count })),
  ...[1, 2, 3, 6].map((count) => ({ unit: 'month' as const, count })),
  ...[1, 2, 5, 10].map((count) => ({ unit: 'year' as const, count }))
];

// Calendar units select by their average length; their ticks still step whole months and years.
const STEP_UNIT_MS: Record<TemporalStepUnit, number> = {
  millisecond: 1,
  second: 1_000,
  minute: MINUTE_MS,
  hour: HOUR_MS,
  day: DAY_MS,
  month: 30.436_875 * DAY_MS,
  year: 365.242_5 * DAY_MS
};

function temporalStepMilliseconds(step: TemporalStep): number {
  return STEP_UNIT_MS[step.unit] * step.count;
}

/**
 * The uniform step a temporal axis labels: the closest readable step to the width budget,
 * never finer than the span's label granularity.
 */
export function temporalStep(spanMs: number, splitNumber: number): TemporalStep {
  const target = Math.max(spanMs / Math.max(1, splitNumber), temporalTickMinInterval(spanMs));
  let best = TEMPORAL_STEPS[0],
    distance = Infinity;
  for (const step of TEMPORAL_STEPS) {
    const candidate = Math.abs(Math.log(temporalStepMilliseconds(step) / target));
    if (candidate < distance) {
      best = step;
      distance = candidate;
    }
  }
  return best;
}

/** Bound the render loop even if a caller asks for a denser grid than the axis shows. */
const MAX_TEMPORAL_TICKS = 240;

function startOfLocalDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addLocalDays(value: number, count: number): number {
  const date = new Date(value);
  date.setDate(date.getDate() + count);
  return date.getTime();
}

/**
 * Every tick of one step inside `[start, end]`, each on the local boundary its unit names:
 * clock times inside a local day, local midnights for day steps, and the first of the month
 * or year for calendar steps. Local stepping keeps daylight-saving days intact.
 */
export function temporalTicks(start: number, end: number, step: TemporalStep): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const ticks: number[] = [];
  const add = (value: number) => {
    if (value >= start && value <= end && ticks.length < MAX_TEMPORAL_TICKS) ticks.push(value);
  };
  if (step.unit === 'month' || step.unit === 'year') {
    const anchor = new Date(start);
    if (step.unit === 'month') anchor.setDate(1);
    else anchor.setMonth(0, 1);
    anchor.setHours(0, 0, 0, 0);
    for (let value = anchor.getTime(); value <= end; ) {
      add(value);
      const next = new Date(value);
      if (step.unit === 'month') next.setMonth(next.getMonth() + step.count);
      else next.setFullYear(next.getFullYear() + step.count);
      value = next.getTime();
    }
    return ticks;
  }
  if (step.unit === 'day') {
    for (let value = startOfLocalDay(start); value <= end; value = addLocalDays(value, step.count))
      add(value);
    return ticks;
  }
  const size = temporalStepMilliseconds(step);
  for (let day = startOfLocalDay(start); day <= end; day = addLocalDays(day, 1)) {
    const nextDay = addLocalDays(day, 1),
      // Skip the wall-clock values before the window so dense steps never walk a whole day.
      first = day + Math.max(0, Math.ceil((start - day) / size)) * size;
    for (let value = first; value < nextDay && value <= end; value += size) add(value);
  }
  return ticks;
}

/** Keep date/year context visible even when the ticks only need hours or seconds. */
export function temporalAxisCaption(
  label: string,
  start: number,
  end: number,
  timeZone = localTimeZone()
): string {
  const first = formatDate(start, timeZone),
    last = formatDate(end, timeZone);
  const startZone = zoneLabel(start, timeZone),
    endZone = zoneLabel(end, timeZone);
  return [
    label,
    first === last ? first : `${first} – ${last}`,
    startZone === endZone ? startZone : `${startZone}/${endZone}`
  ]
    .filter(Boolean)
    .join(' · ');
}
