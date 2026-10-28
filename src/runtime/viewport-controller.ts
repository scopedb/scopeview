import type { PlotRect } from '../core/scene.js';
import type { ViewportSession, ViewportState } from '../core/viewport.js';
import { object } from '../data/validation.js';

export interface ViewportInputOptions {
  rect(): PlotRect | null | undefined;
  enabled?(): boolean;
  onChange(state: Readonly<ViewportState>): void;
}

/** Browser input policy over the DOM-free viewport. Dragging arbitrates with inspection. */
export class ViewportController {
  #events = new AbortController();
  #originalTouchAction: string;
  #originalPanning: string | null;
  #drag: {
    id: number;
    x: number;
    y: number;
    width: number;
    touch: boolean;
    state: ViewportState;
    consumed: boolean;
  } | null = null;
  #suppressClick = false;
  #seenPointerDown = false;
  constructor(
    private element: HTMLElement,
    readonly session: ViewportSession,
    private options: ViewportInputOptions
  ) {
    object(options, 'options', ['rect', 'enabled', 'onChange']);
    this.#originalTouchAction = element.style.touchAction;
    this.#originalPanning = element.getAttribute('data-scope-panning');
    element.removeAttribute('data-scope-panning');
    element.style.touchAction = 'pan-y';
    const signal = this.#events.signal;
    element.addEventListener('wheel', (event) => this.wheel(event), { passive: false, signal });
    element.addEventListener(
      'pointerdown',
      (event) => {
        this.#seenPointerDown = true;
        this.#suppressClick = false;
        const rect = options.rect(),
          bounds = element.getBoundingClientRect();
        if (
          !this.enabled ||
          !rect ||
          event.button !== 0 ||
          !event.isPrimary ||
          event.clientX < bounds.left + rect.x ||
          event.clientX > bounds.left + rect.x + rect.width ||
          event.clientY < bounds.top + rect.y ||
          event.clientY > bounds.top + rect.y + rect.height
        )
          return;
        this.#drag = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          width: rect.width,
          touch: event.pointerType === 'touch',
          state: { ...session.state },
          consumed: false
        };
      },
      { capture: true, signal }
    );
    element.addEventListener('pointermove', (event) => this.move(event), { capture: true, signal });
    element.addEventListener(
      'pointerup',
      (event) => {
        if (event.pointerId !== this.#drag?.id) return;
        this.#suppressClick = this.#drag.consumed;
        this.cancel(false);
      },
      { capture: true, signal }
    );
    element.addEventListener('pointercancel', () => this.cancel(), { signal });
    element.addEventListener(
      'lostpointercapture',
      (event) => {
        if (
          event.target === element &&
          this.#drag?.id === event.pointerId &&
          !element.hasPointerCapture(event.pointerId)
        )
          this.cancel();
      },
      { signal }
    );
    element.addEventListener(
      'click',
      (event) => {
        if (this.#suppressClick || (event.detail > 0 && !this.#seenPointerDown)) {
          this.#suppressClick = false;
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      { capture: true, signal }
    );
    element.addEventListener('keydown', (event) => this.keyboard(event), { capture: true, signal });
  }
  get enabled() {
    return this.options.enabled?.() !== false;
  }
  get consumed() {
    return this.#drag?.consumed === true;
  }
  private update(action: () => void) {
    const before = this.session.state;
    action();
    const after = this.session.state;
    if (
      before.start === after.start &&
      before.end === after.end &&
      before.scrollOffset === after.scrollOffset
    )
      return false;
    this.options.onChange(after);
    return true;
  }
  private wheel(event: WheelEvent) {
    const rect = this.options.rect();
    if (!this.enabled || !rect) return;
    this.cancel();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
    const x = (event.clientX - this.element.getBoundingClientRect().left - rect.x) / rect.width;
    const changed = this.update(() => {
      if (event.ctrlKey || event.metaKey)
        this.session.zoom(Math.exp(Math.max(-2, Math.min(2, (-event.deltaY * unit) / 250))), x);
      else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
        this.session.pan(((event.deltaX || event.deltaY) * unit) / rect.width);
      else this.session.scroll(event.deltaY * unit);
    });
    if (changed || event.ctrlKey || event.metaKey) event.preventDefault();
  }
  private move(event: PointerEvent) {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (!drag.consumed) {
      if (Math.hypot(dx, dy) < 4) return;
      if (drag.touch && Math.abs(dy) > Math.abs(dx)) {
        this.cancel();
        return;
      }
      drag.consumed = true;
      this.element.setAttribute('data-scope-panning', '');
      this.element.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    this.update(() => {
      const shift = (-dx / drag.width) * (drag.state.end - drag.state.start);
      this.session.set({
        start: drag.state.start + shift,
        end: drag.state.end + shift,
        scrollOffset: drag.state.scrollOffset - (drag.touch ? 0 : dy)
      });
    });
  }
  private keyboard(event: KeyboardEvent) {
    if (!this.enabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const action =
      event.key === '+' || event.key === '='
        ? () => this.session.zoom(2)
        : event.key === '-'
          ? () => this.session.zoom(0.5)
          : event.key === '0'
            ? () => this.session.reset()
            : event.shiftKey && event.key === 'ArrowRight'
              ? () => this.session.pan(0.2)
              : event.shiftKey && event.key === 'ArrowLeft'
                ? () => this.session.pan(-0.2)
                : event.key === 'PageDown'
                  ? () => this.session.scroll(this.options.rect()?.height ?? 100)
                  : event.key === 'PageUp'
                    ? () => this.session.scroll(-(this.options.rect()?.height ?? 100))
                    : null;
    if (!action) return;
    this.cancel();
    event.preventDefault();
    event.stopImmediatePropagation();
    this.update(action);
  }
  cancel(suppressClick = true) {
    const drag = this.#drag;
    if (suppressClick && drag) this.#suppressClick = true;
    this.#drag = null;
    this.element.removeAttribute('data-scope-panning');
    if (drag && this.element.hasPointerCapture(drag.id))
      this.element.releasePointerCapture(drag.id);
  }
  dispose() {
    this.cancel();
    this.#suppressClick = false;
    this.#events.abort();
    this.element.style.touchAction = this.#originalTouchAction;
    if (this.#originalPanning !== null)
      this.element.setAttribute('data-scope-panning', this.#originalPanning);
  }
}
