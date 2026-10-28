import type { ChartFieldRef } from './result.js';
import type { TimeWindow } from './time.js';
import { formatInteger } from './integer-format.js';

export type ChartPresentation = 'full' | 'sparkline';
/** Execution facts travel with a result, independently of a saved chart spec. */
export type TimeSemantics<F = ChartFieldRef> =
  | { kind: 'points'; field: F; window?: TimeWindow }
  | {
      kind: 'buckets';
      field: F;
      intervalMs: number;
      window?: TimeWindow;
      coverage: 'complete' | 'limited' | 'unknown';
      /** Host watermark in epoch milliseconds. Buckets ending after it are still accumulating. */
      completeThrough?: number;
      valueKind?: 'count' | 'number';
    };
export interface DataProvenance {
  kind: 'rows' | 'bins' | 'entities';
  scope: 'returned' | 'sample' | 'matching';
  approximate?: boolean;
  description?: string;
}
export interface ResultSemantics<F = ChartFieldRef> {
  time?: TimeSemantics<F>;
  provenance?: DataProvenance;
}
/** Declarative geometry/display conversion. Source values never change. */
export interface QuantityDisplay<F = ChartFieldRef> {
  field: F;
  divisor: string;
  unit?: string;
  decimals?: number;
}

/** Place a decimal point without passing supplied digits through binary floating point. */
function exactDecimal(raw: string): string {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(raw);
  if (!match) return raw;
  const exponent = Number(match[5] ?? 0);
  // Keep extreme exponent notation bounded instead of allocating an arbitrary expansion.
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return raw;
  const integer = match[2] ?? '0';
  const digits = integer + (match[3] ?? match[4] ?? '');
  const point = integer.length + exponent;
  const whole =
    point <= 0
      ? '0'
      : point >= digits.length
        ? digits + '0'.repeat(point - digits.length)
        : digits.slice(0, point);
  const fraction = (
    point <= 0 ? '0'.repeat(-point) + digits : point >= digits.length ? '' : digits.slice(point)
  ).replace(/0+$/, '');
  return `${match[1] === '-' ? '-' : ''}${formatInteger(BigInt(whole))}${fraction ? `.${fraction}` : ''}`;
}

/** Exact source readings; declared display conversion is separate from floating geometry. */
export function formatQuantity(
  raw: string | null,
  display?: Omit<QuantityDisplay, 'field'>
): string {
  if (raw === null) return 'NULL';
  if (!display) {
    if (/^[+-]?\d+$/.test(raw)) return formatInteger(BigInt(raw));
    const value = raw.trim();
    if (!value) return '0';
    if (/^0(?:x[\da-f]+|o[0-7]+|b[01]+)$/i.test(value)) return formatInteger(BigInt(value));
    return exactDecimal(value);
  }
  if (!/^[1-9]\d*$/.test(display.divisor))
    throw new TypeError('A quantity divisor must be a positive integer.');
  const decimals = display.decimals ?? 2;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8)
    throw new TypeError('Quantity decimals must be between 0 and 8.');
  const suffix = display.unit ? ` ${display.unit}` : '';
  if (!/^[+-]?\d+$/.test(raw))
    return `${(Number(raw) / Number(display.divisor)).toFixed(decimals)}${suffix}`;
  const n = BigInt(raw),
    divisor = BigInt(display.divisor),
    scale = 10n ** BigInt(decimals);
  const absolute = n < 0n ? -n : n;
  if (absolute > 0n && absolute * scale < divisor) {
    const limit = decimals ? `0.${'0'.repeat(decimals - 1)}1` : '1';
    return `${n < 0n ? '−' : ''}<${limit}${suffix}`;
  }
  const rounded = (absolute * scale * 2n + divisor) / (2n * divisor);
  const whole = formatInteger(rounded / scale);
  const fraction = decimals ? `.${String(rounded % scale).padStart(decimals, '0')}` : '';
  return `${n < 0n ? '−' : ''}${whole}${fraction}${suffix}`;
}

/** Ordered tuples retain NULL, empty strings and separators without merging groups. */
export function dimensionTuple(values: readonly (string | null)[]) {
  return {
    key: JSON.stringify(values),
    label: `(${values.map((value) => (value === null ? 'NULL' : JSON.stringify(value))).join(', ')})`
  };
}
