import { compactFormat, formatInspectionNumber } from '../../data/format.js';

export type Domain = readonly [number, number];
export interface NumericAxis {
  domain: Domain;
  ticks: number[];
  labels: string[];
}

export function extent(values: readonly number[]): [number, number] {
  let min = Infinity,
    max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value))
      throw new Error('The plotted range exceeds finite number precision.');
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return min === Infinity ? [0, 1] : [min, max];
}

/** Normalize first so both subnormal values and opposite 1e308 endpoints remain finite. */
export function linear(domain: Domain, range: Domain): (value: number) => number {
  const unit = Math.max(Math.abs(domain[0]), Math.abs(domain[1])) || 1;
  const lower = domain[0] / unit,
    span = domain[1] / unit - lower;
  return (value) => {
    const ratio = span === 0 ? 0.5 : (value / unit - lower) / span;
    return range[0] + ratio * (range[1] - range[0]);
  };
}

/** Linear axes only. Round tick positions, never the observations or inspection values. */
export function numericAxis(values: readonly number[], count: number, zero = false): NumericAxis {
  let [min, max] = extent(values);
  if (zero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  const nonnegative = min >= 0,
    nonpositive = max <= 0;
  const pad =
    min === max ? Math.abs(min) * 0.1 || (min ? Number.MIN_VALUE : 1) : max * 0.04 - min * 0.04;
  const lower = min - pad,
    upper = max + pad;
  min = Number.isFinite(lower) ? lower : min;
  max = Number.isFinite(upper) ? upper : max;
  if (nonnegative) min = Math.max(0, min);
  if (nonpositive) max = Math.min(0, max);
  if (min === max) {
    min = 0;
    max = 1;
  }
  const rough = max / count - min / count;
  const unit = 10 ** Math.floor(Math.log10(rough)) || Number.MIN_VALUE;
  const error = rough / unit;
  const step = (error >= 5 ? 5 : error >= 2 ? 2 : 1) * unit;
  const floor = Math.floor(min / step) * step,
    ceiling = Math.ceil(max / step) * step;
  if (Number.isFinite(floor)) min = floor;
  if (Number.isFinite(ceiling)) max = ceiling;
  const ticks: number[] = [];
  const first = Math.ceil(min / step);
  for (let i = 0; i < 20; i++) {
    const value = Number(((first + i) * step).toPrecision(15));
    if (!Number.isFinite(value) || value > max) break;
    if (value >= min && value !== ticks.at(-1)) ticks.push(value === 0 ? 0 : value);
  }
  if (ticks.length < 2) ticks.splice(0, ticks.length, min, max);
  const labels = ticks.map((value) =>
    Math.abs(value) >= 1e12 ? value.toExponential(2) : compactFormat(value)
  );
  if (new Set(labels).size !== labels.length) {
    for (let i = 0; i < ticks.length; i++) labels[i] = formatInspectionNumber(ticks[i]);
  }
  return { domain: [min, max], ticks, labels };
}
