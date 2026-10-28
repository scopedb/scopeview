import { object } from '../data/validation.js';

export interface ViewportState {
  start: number;
  end: number;
  scrollOffset: number;
}
export interface ViewportBounds {
  contentHeight: number;
  visibleHeight: number;
  minSpan?: number;
}

/** Normalized horizontal domain and CSS-pixel vertical position; no DOM or input policy. */
export class ViewportSession {
  #state: ViewportState = { start: 0, end: 1, scrollOffset: 0 };
  #bounds: ViewportBounds = { contentHeight: 0, visibleHeight: 0, minSpan: 1e-12 };
  get state(): Readonly<ViewportState> {
    return { ...this.#state };
  }
  configure(bounds: ViewportBounds) {
    object(bounds, 'viewport.bounds', ['contentHeight', 'visibleHeight', 'minSpan']);
    if (
      ![bounds.contentHeight, bounds.visibleHeight, bounds.minSpan ?? 1e-12].every(
        Number.isFinite
      ) ||
      bounds.contentHeight < 0 ||
      bounds.visibleHeight < 0 ||
      (bounds.minSpan ?? 1e-12) <= 0 ||
      (bounds.minSpan ?? 1e-12) > 1
    )
      throw new RangeError('Invalid viewport bounds.');
    this.#bounds = { ...bounds };
    this.set(this.#state);
  }
  set(value: ViewportState) {
    object(value, 'viewport', ['start', 'end', 'scrollOffset']);
    if (
      ![value.start, value.end, value.scrollOffset].every(Number.isFinite) ||
      value.start >= value.end
    )
      throw new RangeError('Viewport needs a finite positive window and scroll offset.');
    const span = Math.max(this.#bounds.minSpan ?? 1e-12, Math.min(1, value.end - value.start));
    const start = Math.max(0, Math.min(1 - span, value.start));
    this.#state = {
      start,
      end: start + span,
      scrollOffset: Math.max(
        0,
        Math.min(
          Math.max(0, this.#bounds.contentHeight - this.#bounds.visibleHeight),
          value.scrollOffset
        )
      )
    };
  }
  zoom(factor: number, anchor = 0.5) {
    if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(anchor))
      throw new RangeError('Invalid zoom.');
    anchor = Math.max(0, Math.min(1, anchor));
    const oldSpan = this.#state.end - this.#state.start;
    const span = Math.min(1, Math.max(this.#bounds.minSpan ?? 1e-12, oldSpan / factor));
    const point = this.#state.start + anchor * oldSpan;
    this.set({ ...this.#state, start: point - anchor * span, end: point + (1 - anchor) * span });
  }
  pan(fraction: number) {
    if (!Number.isFinite(fraction)) throw new RangeError('Invalid pan.');
    const shift = fraction * (this.#state.end - this.#state.start);
    this.set({ ...this.#state, start: this.#state.start + shift, end: this.#state.end + shift });
  }
  scroll(pixels: number) {
    if (!Number.isFinite(pixels)) throw new RangeError('Invalid scroll.');
    this.set({ ...this.#state, scrollOffset: this.#state.scrollOffset + pixels });
  }
  reveal(start: number, end: number, top: number, bottom: number) {
    if (![start, end, top, bottom].every(Number.isFinite) || start > end || top > bottom)
      throw new RangeError('Invalid reveal bounds.');
    let state = { ...this.#state };
    const span = state.end - state.start;
    if (end < state.start || start > state.end || start < state.start || end > state.end) {
      const width = Math.min(1, Math.max(span, end - start));
      const midpoint = (start + end) / 2;
      state = { ...state, start: midpoint - width / 2, end: midpoint + width / 2 };
    }
    if (top < state.scrollOffset) state.scrollOffset = top;
    else if (bottom > state.scrollOffset + this.#bounds.visibleHeight)
      state.scrollOffset = bottom - this.#bounds.visibleHeight;
    this.set(state);
  }
  reset() {
    this.#state = { start: 0, end: 1, scrollOffset: 0 };
  }
}
