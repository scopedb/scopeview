import { ChartSession } from '../core/session.js';
import { inspectionText } from '../core/labels.js';
import type { ChartInteraction, ChartScene } from '../core/scene.js';
import type { PaintInvalidation } from '../core/painter.js';
import { CanvasRenderer } from '../renderers/canvas/renderer.js';
import { canvasFont } from '../renderers/canvas/typography.js';
import type { ReadingOptions } from './types.js';

/** Report lifecycle and transient reading. Range, links and viewport controllers stay optional. */
export class ReadingRuntime<Source> {
  readonly session = new ChartSession<Source>('compare');
  selectable = false;
  #painter: CanvasRenderer<Source>;
  #events = new AbortController();
  #resize: ResizeObserver;
  #context = document.createElement('canvas').getContext('2d');
  #frame = 0;
  #disposed = false;
  #needsLayout = true;
  #width = 0;
  #height = 0;
  #font = '';

  constructor(
    private canvas: HTMLElement,
    decoration: HTMLElement,
    private options: ReadingOptions<Source>
  ) {
    this.#painter = new CanvasRenderer(canvas, decoration, (target, position, pin, series) => {
      if (options.inputConsumed?.()) return;
      if (!this.session.inspect(target?.key ?? null, pin && this.selectable, false, series)) return;
      this.focus(this.session.active);
      this.announce();
      options.onInspect?.(this.session.active, position, this.session.pinned, series);
    });
    const signal = this.#events.signal;
    this.#resize = new ResizeObserver(() => {
      const { width, height } = canvas.getBoundingClientRect();
      if (width !== this.#width || height !== this.#height || this.#needsLayout) this.refresh();
    });
    this.#resize.observe(canvas);
    window.addEventListener('resize', () => this.refresh(), { signal });
    document.fonts?.addEventListener(
      'loadingdone',
      () => {
        this.#painter.invalidate();
        this.refresh();
      },
      { signal }
    );
    this.watchDensity();
    canvas.setAttribute('role', 'group');
    canvas.addEventListener('keydown', (event) => this.keyboard(event), { signal });
    this.refresh();
  }
  get model() {
    return this.#painter.model;
  }
  anchor(target: ChartInteraction<Source>) {
    return this.#painter.anchor(target);
  }
  focus(target: ChartInteraction<Source> | null) {
    this.#painter.focus(
      target,
      this.session.pinned,
      this.session.series,
      this.session.selected?.key ?? null
    );
  }
  private watchDensity() {
    window.matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener(
      'change',
      () => {
        if (this.#disposed) return;
        this.watchDensity();
        this.refresh('paint');
      },
      { once: true, signal: this.#events.signal }
    );
  }
  refresh(reason: PaintInvalidation = 'layout') {
    if (this.#disposed) return;
    if (reason === 'layout') this.#needsLayout = true;
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      try {
        this.paint('paint');
      } catch (error) {
        this.#needsLayout = true;
        this.#painter.model = null;
        this.session.setModel(null);
        this.canvas.replaceChildren();
        this.canvas.setAttribute('aria-label', 'Chart rendering failed.');
        this.options.onError?.(error);
      }
    });
  }
  paint(reason: PaintInvalidation = 'layout') {
    if (this.#disposed) return;
    if (reason === 'layout') this.#needsLayout = true;
    const { width, height } = this.canvas.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const font = canvasFont(this.canvas);
    if (this.#context) this.#context.font = font;
    const layout =
      this.#needsLayout ||
      !this.model ||
      width !== this.#width ||
      height !== this.#height ||
      font !== this.#font;
    const scene: ChartScene<Source> = layout
      ? this.options.layout(
          width,
          height,
          Object.assign(
            (text: string) => this.#context?.measureText(text).width ?? text.length * 7,
            { fontSize: parseFloat(font) }
          ),
          this.session.hidden
        )
      : this.model!;
    this.#width = width;
    this.#height = height;
    this.#font = font;
    this.#needsLayout = false;
    this.session.setModel(scene.navigation ?? scene);
    this.#painter.render(scene, {
      inspectionKey: this.session.active?.key ?? null,
      inspectionPinned: this.session.pinned,
      inspectionSeries: this.session.series,
      selectedKey: this.session.selected?.key ?? null,
      range: null
    });
    if (scene.interactive === false) this.canvas.removeAttribute('tabindex');
    else this.canvas.tabIndex = 0;
    this.announce();
    this.options.onRender?.(scene);
  }
  private keyboard(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey || this.model?.interactive === false) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const direction =
        event.key === 'Home' || event.key === 'End'
          ? event.key
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? 'previous'
            : 'next';
      const target = this.session.next(direction);
      if (target) this.options.onNavigate?.(target);
      this.session.inspect(target?.key ?? null, false, true);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const target = this.session.active ?? this.session.next('Home');
      if (target) this.options.onNavigate?.(target);
      this.session.inspect(target?.key ?? null, this.selectable, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.session.clearInspection();
    } else return;
    this.focus(this.session.active);
    this.announce();
    this.options.onInspect?.(this.session.active, null, this.session.pinned);
  }
  private announce() {
    this.canvas.setAttribute(
      'aria-label',
      this.session.active
        ? inspectionText(this.session.active)
        : (this.model?.ariaLabel ?? 'ScopeDB chart')
    );
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    cancelAnimationFrame(this.#frame);
    this.#events.abort();
    this.#resize.disconnect();
    this.session.reset();
    this.#painter.dispose();
    this.canvas.removeAttribute('tabindex');
    if (this.#context) this.#context.canvas.width = this.#context.canvas.height = 0;
    this.#context = null;
  }
}
