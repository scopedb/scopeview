export interface TimeWindow {
  start: number;
  end: number;
}

export function parseResultTimestamp(value: string): number | null {
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}:\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!match) return null;
  const day = Date.parse(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== match[1]) return null;
  if (
    match[2] &&
    (Number(match[2].slice(0, 2)) > 23 ||
      Number(match[2].slice(3, 5)) > 59 ||
      Number(match[2].slice(6)) > 59)
  )
    return null;
  const parsed = Date.parse(
    `${match[1]}T${match[2] ?? '00:00:00'}${match[3] ?? ''}${match[4] ?? 'Z'}`
  );
  return Number.isFinite(parsed) ? parsed : null;
}
