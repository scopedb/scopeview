import type { PaintInvalidation } from '../core/painter.js';
import type {
  ChartInteraction,
  ChartScene,
  Inspect,
  MeasureText,
  RenderModel
} from '../core/scene.js';
import { inspectionText } from '../core/labels.js';
import { CanvasRenderer } from '../renderers/canvas/renderer.js';
import { canvasFont } from '../renderers/canvas/typography.js';
import type { RefreshReason, SceneLayout } from './types.js';

interface LifecycleOptions<Source> {
  layout?: SceneLayout<Source>;
  onRender?(scene: ChartScene<Source>): void;
  onError?(error: unknown): void;
  invalidate?(reason: PaintInvalidation): void;
}

const TEXT_WIDTH_CACHE_LIMIT = 2048;
let measureContext: CanvasRenderingContext2D | null = null;
let measureDocument: Document | undefined;
function scratchMeasureContext(): CanvasRenderingContext2D {
  if (
    !measureContext ||
    measureDocument !== document ||
    (measureContext.canvas.ownerDocument != null &&
      measureContext.canvas.ownerDocument !== document)
  ) {
    measureDocument = document;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    measureContext = canvas.getContext('2d');
    if (!measureContext) throw new Error('Canvas 2D is unavailable.');
  }
  return measureContext;
}

/** Browser resources and layout invalidation, independent of reading and interaction state. */
export abstract class RuntimeLifecycle<Source> {
  protected abstract readonly session: {
    readonly hidden: ReadonlySet<string>;
    readonly active: ChartInteraction<Source> | null;
    setModel(model: RenderModel<Source> | null): void;
  };
  protected readonly painter: CanvasRenderer<Source>;
  #events = new AbortController();
  protected readonly signal = this.#events.signal;
  #resize: ResizeObserver;
  #frame = 0;
  #viewport = false;
  #paintDirty = true;
  // Cleared measurements leave layout pending, including while the host is hidden.
  #measurement: { width: number; height: number } | null = null;
  #font = '';
  #widths = new Map<string, number>();
  #aria: string | null = null;

  constructor(
    protected canvas: HTMLElement,
    decoration: HTMLElement,
    inspect: Inspect<Source>,
    protected options: LifecycleOptions<Source>
  ) {
    this.painter = new CanvasRenderer(canvas, decoration, inspect);
    const signal = this.signal;
    this.#resize = new ResizeObserver(() => {
      const { width, height } = canvas.getBoundingClientRect();
      // A hidden host retains its previous dimensions and pending layout work.
      if (width !== this.#measurement?.width || height !== this.#measurement?.height)
        this.#invalidate();
    });
    this.#resize.observe(canvas);
    canvas.addEventListener('keydown', (event) => this.keyboard(event), { signal });
    window.addEventListener('resize', () => this.#invalidate(), { signal });
    this.#watchDensity();
    document.fonts?.addEventListener(
      'loadingdone',
      () => {
        this.#widths.clear();
        this.painter.invalidate();
        this.#invalidate();
      },
      { signal }
    );
  }
  protected abstract draw(scene: ChartScene<Source>, keepColors: boolean, font?: string): void;
  protected abstract release(): void;
  protected abstract keyboard(event: KeyboardEvent): void;

  #watchDensity() {
    window.matchMedia(`(resolution:${devicePixelRatio}dppx)`).addEventListener(
      'change',
      () => {
        this.#watchDensity();
        this.#invalidate('paint');
      },
      { once: true, signal: this.signal }
    );
  }
  #invalidate(reason: PaintInvalidation = 'layout') {
    if (reason === 'layout') this.#measurement = null;
    this.#paintDirty = true;
    if (this.options.invalidate) this.options.invalidate(reason);
    else this.refresh(reason);
  }
  /** Layout > viewport > paint when several refresh requests share a frame. */
  refresh(reason: RefreshReason = 'layout') {
    if (this.signal.aborted) return;
    if (reason === 'layout') {
      this.#measurement = null;
      this.#paintDirty = true;
    } else if (reason === 'viewport') {
      this.#viewport = true;
    } else {
      this.#paintDirty = true;
    }
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      const viewport = this.#viewport;
      this.#viewport = false;
      try {
        this.paint(
          this.options.layout,
          this.#measurement ? (viewport ? 'viewport' : 'paint') : 'layout'
        );
      } catch (error) {
        this.#measurement = null;
        this.#paintDirty = true;
        this.#aria = null;
        this.painter.model = null;
        this.session.setModel(null);
        this.canvas.replaceChildren();
        this.canvas.setAttribute('aria-label', 'Chart rendering failed.');
        this.options.onError?.(error);
      }
    });
  }
  /** Synchronous render for a host's coordinated state transaction. */
  paint(layout = this.options.layout, reason: RefreshReason = 'layout') {
    if (this.signal.aborted || !layout) return;
    this.options.layout = layout;
    if (reason === 'layout') this.#measurement = null;
    if (reason !== 'viewport') this.#paintDirty = true;
    const { width, height } = this.canvas.getBoundingClientRect();
    if (width <= 0 || height <= 0) {
      if (reason === 'viewport') this.#measurement = null;
      return;
    }
    const font = canvasFont(this.canvas),
      fontChanged = font !== this.#font;
    let scene = this.painter.model;
    if (
      !scene ||
      reason === 'viewport' ||
      width !== this.#measurement?.width ||
      height !== this.#measurement?.height ||
      fontChanged
    ) {
      if (fontChanged) {
        this.#widths.clear();
        this.#font = font;
      }
      const widths = this.#widths,
        ctx = scratchMeasureContext();
      const measure: MeasureText = (text) => {
        let measured = widths.get(text);
        if (measured !== undefined) {
          widths.delete(text);
          widths.set(text, measured);
          return measured;
        }
        if (ctx.font !== font) ctx.font = font;
        measured = ctx.measureText(text).width;
        if (widths.size >= TEXT_WIDTH_CACHE_LIMIT) widths.delete(widths.keys().next().value!);
        widths.set(text, measured);
        return measured;
      };
      measure.fontSize = parseFloat(font);
      scene = layout(width, height, measure, this.session.hidden);
      this.#measurement = { width, height };
    }
    const keepColors = reason === 'viewport' && !this.#paintDirty;
    this.#paintDirty = false;
    try {
      this.session.setModel(scene.navigation ?? scene);
      this.draw(scene, keepColors, font);
    } catch (error) {
      this.#paintDirty = true;
      throw error;
    }
    this.options.onRender?.(scene);
  }
  anchor(target: ChartInteraction<Source>) {
    return this.painter.anchor(target);
  }
  protected resetAria() {
    this.#aria = null;
  }
  protected announce() {
    const active = this.session.active;
    const label = active
      ? inspectionText(active)
      : (this.painter.model?.ariaLabel ?? 'ScopeDB chart');
    if (label !== this.#aria) {
      this.#aria = label;
      this.canvas.setAttribute('aria-label', label);
    }
  }
  dispose() {
    if (this.signal.aborted) return;
    this.#events.abort();
    cancelAnimationFrame(this.#frame);
    this.#resize.disconnect();
    this.#widths.clear();
    this.release();
    this.painter.dispose();
  }
}
