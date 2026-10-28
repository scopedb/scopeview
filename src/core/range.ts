import type { TimeWindow } from '../data/time.js';

export interface RangeContext {
  snapshot: object;
  window: TimeWindow;
  intervalMs: number;
  enabled?: boolean;
}
export interface RangeSelectionBinding {
  /** The host's originating result identity, not a draft or wall clock. */
  snapshot: object;
  value: TimeWindow | null;
  enabled?: boolean;
  onCommit(value: TimeWindow, snapshot: object): void;
  onDismiss?(snapshot: object): void;
  onPreview?(value: TimeWindow | null): void;
}

/** Half-open epoch buckets, snapped outwards and clipped to the executed window. */
export function snapTimeRange(
  start: number,
  end: number,
  window: TimeWindow,
  intervalMs: number
): TimeWindow | null {
  if (
    ![start, end, window.start, window.end, intervalMs].every(Number.isFinite) ||
    intervalMs < 1 ||
    window.start >= window.end ||
    start === end
  )
    return null;
  const from = Math.max(window.start, Math.floor(Math.min(start, end) / intervalMs) * intervalMs);
  const to = Math.min(window.end, Math.ceil(Math.max(start, end) / intervalMs) * intervalMs);
  return from < to ? { start: from, end: to } : null;
}
function equal(a: TimeWindow | null, b: TimeWindow | null) {
  return a?.start === b?.start && a?.end === b?.end;
}

/** Preview is local; commits request a host update and never change the controlled value. */
export class RangeSelectionSession {
  #context: RangeContext | null = null;
  #value: TimeWindow | null = null;
  #pending: TimeWindow | null = null;
  get value() {
    return this.#value && { ...this.#value };
  }
  get preview() {
    return this.#pending && { ...this.#pending };
  }
  get displayed() {
    return this.preview ?? this.value;
  }
  get enabled() {
    return !!this.#context && this.#context.enabled !== false;
  }
  configure(context: RangeContext | null, value: TimeWindow | null) {
    if (
      context &&
      (!Number.isSafeInteger(context.intervalMs) ||
        context.intervalMs < 1 ||
        !Number.isSafeInteger(context.window.start) ||
        !Number.isSafeInteger(context.window.end) ||
        Math.abs(context.window.start) > 8.64e15 ||
        Math.abs(context.window.end) > 8.64e15 ||
        context.window.start >= context.window.end)
    )
      throw new TypeError('Range selection requires a valid executed bucket window.');
    const previous = this.#context;
    const changed =
      context?.snapshot !== previous?.snapshot ||
      context?.window.start !== previous?.window.start ||
      context?.window.end !== previous?.window.end ||
      context?.intervalMs !== previous?.intervalMs;
    const next =
      context && value
        ? snapTimeRange(value.start, value.end, context.window, context.intervalMs)
        : null;
    // Controlled values must already obey the same contract as pointer/keyboard commits.
    if (context && value && !equal(value, next))
      throw new TypeError('The controlled range must be snapped and inside the executed window.');
    this.#context = context ? { ...context, window: { ...context.window } } : null;
    if (changed || !this.enabled || !equal(this.#value, next)) this.#pending = null;
    this.#value = next;
  }
  update(start: number, end: number) {
    if (!this.enabled || !this.#context) return null;
    this.#pending = snapTimeRange(start, end, this.#context.window, this.#context.intervalMs);
    return this.preview;
  }
  adjust(endpoint: 'start' | 'end', action: number | 'Home' | 'End') {
    if (!this.enabled || !this.#context) return null;
    const { window, intervalMs } = this.#context;
    const range = this.displayed ?? {
      start: window.start,
      end: Math.min(window.end, (Math.floor(window.start / intervalMs) + 1) * intervalMs)
    };
    const position =
      action === 'Home'
        ? window.start
        : action === 'End'
          ? window.end
          : range[endpoint] + action * intervalMs;
    const start =
      endpoint === 'start'
        ? Math.max(window.start, Math.min(position, range.end - 1))
        : range.start;
    const end =
      endpoint === 'end' ? Math.min(window.end, Math.max(position, range.start + 1)) : range.end;
    return this.update(start, end);
  }
  commit(snapshot: object): TimeWindow | null {
    if (!this.enabled || snapshot !== this.#context?.snapshot) {
      this.cancel();
      return null;
    }
    const result = this.preview;
    this.#pending = null;
    return result;
  }
  cancel() {
    this.#pending = null;
  }
  reset() {
    this.configure(null, null);
  }
}
