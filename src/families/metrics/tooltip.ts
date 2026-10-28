import { formatDate, formatLocalTime, localTimeZone, zoneLabel } from '../../data/date-time.js';

/** A compact visual header; both local dates, offsets and subsecond precision remain explicit. */
export function timeTooltipHeader(
  field: string,
  start: number,
  end?: number,
  timeZone = localTimeZone()
) {
  const dates = [new Date(start), ...(end === undefined ? [] : [new Date(end)])];
  const milliseconds = dates.some((date) => date.getUTCMilliseconds() !== 0);
  const seconds = milliseconds || dates.some((date) => date.getUTCSeconds() !== 0);
  const clock = (value: number) =>
    formatLocalTime(
      value,
      {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        ...(seconds ? { second: '2-digit' as const } : {}),
        ...(milliseconds ? { fractionalSecondDigits: 3 as const } : {})
      },
      timeZone
    );
  const startZone = zoneLabel(start, timeZone);
  const endZone = end === undefined ? startZone : zoneLabel(end, timeZone);
  const differentOffsets = startZone !== endZone;
  const startDate = formatDate(start, timeZone);
  const date =
    end !== undefined && startDate !== formatDate(end, timeZone)
      ? new Intl.DateTimeFormat('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          timeZone
        }).formatRange(start, end)
      : startDate;
  return {
    title:
      end === undefined
        ? clock(start)
        : differentOffsets
          ? `${clock(start)} ${startZone} – ${clock(end)} ${endZone}`
          : `${clock(start)} – ${clock(end)}`,
    context: `${field} · ${date}${differentOffsets ? '' : ` · ${startZone}`}`
  };
}
