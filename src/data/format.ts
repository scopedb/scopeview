import { formatDateTime } from './date-time.js';

export function compactFormat(value: number | string): string {
  const number = Number(value);
  if (Number.isNaN(number)) return String(value);
  const absolute = Math.abs(number);
  if (absolute > 0 && absolute < 0.0001) return number.toExponential(2);
  // Keep huge summaries bounded; the complete source integer belongs to exact reading.
  if (absolute >= 1e12) return number.toExponential(2);
  if (absolute >= 1e9) return `${(number / 1e9).toFixed(absolute >= 1e10 ? 0 : 1)}B`;
  if (absolute >= 1e6) return `${(number / 1e6).toFixed(absolute >= 1e7 ? 0 : 1)}M`;
  if (absolute >= 1e4) return `${(number / 1e3).toFixed(absolute >= 1e5 ? 0 : 1)}K`;
  return Number.isInteger(number)
    ? String(number)
    : number.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

// Inspection shows the represented numeric value; compact notation belongs to axes and summaries.
const INSPECTION_NUMBER = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 21 });

export function formatInspectionNumber(value: number): string {
  return INSPECTION_NUMBER.format(value);
}

export function formatChartValue(value: number | Date | string): string {
  if (value instanceof Date) return formatDateTime(value);
  return typeof value === 'number' ? compactFormat(value) : value;
}
