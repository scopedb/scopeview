import { readingState } from '../core/reading-state.js';
import { interactionFor } from '../core/interaction.js';
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
import { CanvasSurface } from '../renderers/canvas/surface.js';
import { canvasFont } from '../renderers/canvas/typography.js';
import type { SceneLayout } from './types.js';

interface LifecycleOptions<Source> {
  layout?: SceneLayout<Source>;
  onRender?(scene: ChartScene<Source>): void;
  onError?(error: unknown): void;
  invalidate?(reason: PaintInvalidation): void;
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
  #measure = new CanvasSurface('measure');
  #frame = 0;
  #revision = 0;
  // Cleared measurements leave layout pending, including while the host is hidden.
  #measurement: { width: number; height: number; font: string } | null = null;

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
        this.painter.invalidate();
        this.#invalidate();
      },
      { signal }
    );
  }
  protected abstract draw(scene: ChartScene<Source>): void;
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
    if (reason === 'layout') {
      this.#measurement = null;
      this.#revision++;
    }
    if (this.options.invalidate) this.options.invalidate(reason);
    else this.refresh(reason);
  }
  /** Layout invalidation wins when several requests share a frame. */
  refresh(reason: PaintInvalidation = 'layout') {
    if (this.signal.aborted) return;
    if (reason === 'layout') {
      this.#measurement = null;
      this.#revision++;
    }
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      const interaction = interactionFor(this.session);
      interaction.batch(() => {
        try {
          this.paint(this.options.layout, 'paint');
        } catch (error) {
          this.#measurement = null;
          this.painter.model = null;
          this.session.setModel(null);
          this.canvas.replaceChildren();
          this.canvas.setAttribute('aria-label', 'Chart rendering failed.');
          const revision = this.#revision;
          const version = readingState(this.session).modelVersion;
          interaction.effect(
            () => this.options.onError?.(error),
            {},
            0,
            () =>
              !this.signal.aborted &&
              revision === this.#revision &&
              version === readingState(this.session).modelVersion
          );
        }
      });
    });
  }
  /** Synchronous render for a host's coordinated state transaction. */
  paint(layout = this.options.layout, reason: PaintInvalidation = 'layout') {
    if (this.signal.aborted || !layout) return;
    const interaction = interactionFor(this.session);
    interaction.batch(() => {
      this.options.layout = layout;
      if (reason === 'layout') {
        this.#measurement = null;
        this.#revision++;
      }
      const revision = this.#revision;
      const modelVersion = readingState(this.session).modelVersion;
      const current = () =>
        !this.signal.aborted &&
        revision === this.#revision &&
        modelVersion === readingState(this.session).modelVersion;
      const { width, height } = this.canvas.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const font = canvasFont(this.canvas);
      let scene = this.painter.model;
      if (
        !scene ||
        width !== this.#measurement?.width ||
        height !== this.#measurement?.height ||
        font !== this.#measurement?.font
      ) {
        const context = this.#measure.context;
        context.font = font;
        const measure: MeasureText = (text) => context.measureText(text).width;
        measure.fontSize = parseFloat(font);
        try {
          scene = layout(width, height, measure, this.session.hidden);
        } catch (error) {
          if (!current()) return;
          throw error;
        }
        if (!current()) return;
        this.#measurement = { width, height, font };
      }
      this.session.setModel(scene.navigation ?? scene);
      this.draw(scene);
      const rendered = scene;
      interaction.effect(
        () => this.options.onRender?.(rendered),
        {},
        0,
        () => !this.signal.aborted && this.painter.model === rendered
      );
    });
  }
  anchor(target: ChartInteraction<Source>) {
    return this.painter.anchor(target);
  }
  protected announce() {
    const active = this.session.active;
    this.canvas.setAttribute(
      'aria-label',
      active ? inspectionText(active) : (this.painter.model?.ariaLabel ?? 'ScopeDB chart')
    );
  }
  dispose() {
    if (this.signal.aborted) return;
    this.#events.abort();
    cancelAnimationFrame(this.#frame);
    this.#resize.disconnect();
    this.release();
    this.painter.dispose();
    this.#measure.dispose();
  }
}
