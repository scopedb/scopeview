/** UI presentation only. Never use these labels as query literals or raw result values. */
type Instant = Date | number | string;
const cache = new Map<string, Intl.DateTimeFormat>();
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
export function formatLocalTime(
  value: Instant,
  options: Intl.DateTimeFormatOptions,
  timeZone = localTimeZone()
): string {
  const key = JSON.stringify([timeZone, options]);
  let formatter = cache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone });
    if (cache.size >= 64) cache.clear();
    cache.set(key, formatter);
  }
  return formatter.format(new Date(value));
}
export function formatDate(value: Instant, timeZone = localTimeZone()): string {
  return formatLocalTime(value, { month: 'short', day: 'numeric', year: 'numeric' }, timeZone);
}
export function formatDateTime(value: Instant, timeZone = localTimeZone()): string {
  const date = new Date(value);
  return formatLocalTime(
    date,
    {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      ...(date.getMilliseconds() ? { fractionalSecondDigits: 3 as const } : {}),
      timeZoneName: 'short'
    },
    timeZone
  );
}
export function formatTimeRange(start: Instant, end: Instant, timeZone = localTimeZone()): string {
  return `${formatDateTime(start, timeZone)} → ${formatDateTime(end, timeZone)}`;
}
export function zoneLabel(value: Instant = Date.now(), timeZone = localTimeZone()): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(new Date(value))
    .find((part) => part.type === 'timeZoneName')!.value;
}
