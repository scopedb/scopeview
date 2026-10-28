import { ChartSession } from '../core/session.js';
import { inspectionText } from '../core/labels.js';
import { RangeSelectionSession, type RangeSelectionBinding } from '../core/range.js';
import type { ChartInteraction, ChartScene, Inspect, Position } from '../core/scene.js';
import type { ScenePainter, PaintState, PaintInvalidation } from '../core/painter.js';
import { object, boolean, choice, fail } from '../data/validation.js';
import type { TimeWindow } from '../data/time.js';
import type { ResultRow } from '../data/result.js';
import { parseLinkedHighlight, type LinkedHighlight } from '../core/link-group.js';
import { CanvasRenderer } from '../renderers/canvas/renderer.js';
import { canvasFont } from '../renderers/canvas/typography.js';
import type { ReadingOptions, SceneLayout } from './types.js';

export interface RuntimeOptions<Source> extends Omit<ReadingOptions<Source>, 'layout'> {
  layout?: SceneLayout<Source>;
  /** An enclosing UI can own inspection controls and its repaint transaction. */
  inspection?: Inspect<Source>;
  invalidate?(reason: PaintInvalidation): void;
  keyboard?: boolean;
  inspectionMode?: 'freeze' | 'compare';
}

/** Shared browser lifecycle and input arbitration for the element and custom hosts. */
export class ChartRuntime<Source = ResultRow> implements ScenePainter<Source> {
  readonly session: ChartSession<Source>;
  readonly range = new RangeSelectionSession();
  #options: RuntimeOptions<Source>;
  #painter: CanvasRenderer<Source>;
  #needsLayout = true;
  #font = '';
  #focused: ChartInteraction<Source> | null = null;
  #focusedPinned = false;
  #focusedSeries: string | null = null;
  #selectedKey: string | null = null;
  #hoverKey: string | null = null;
  #linkedHighlight: LinkedHighlight | null = null;
  #layout?: SceneLayout<Source>;
  #events = new AbortController();
  #resize: ResizeObserver;
  #context = document.createElement('canvas').getContext('2d');
  #frame = 0;
  #disposed = false;
  #width = 0;
  #height = 0;
  #binding: RangeSelectionBinding | null = null;
  #handles = document.createElement('div');
  #gesture: {
    id: number;
    x: number;
    y: number;
    anchor: number;
    consumed: boolean;
    snapshot: object;
    endpoint?: 'start' | 'end';
  } | null = null;
  #suppressClick = false;
  #endpoint: 'start' | 'end' = 'end';
  #originalAttributes: Map<string, string | null>;
  #originalTouchAction: string;

  constructor(
    protected canvas: HTMLElement,
    decoration: HTMLElement,
    options: RuntimeOptions<Source> = {}
  ) {
    object(options, 'options', [
      'layout',
      'inspection',
      'invalidate',
      'keyboard',
      'inspectionMode',
      'onInspect',
      'onRender',
      'onError',
      'onNavigate',
      'inputConsumed'
    ]);
    if (options.keyboard !== undefined) boolean(options.keyboard, 'options.keyboard');
    if (options.inspectionMode !== undefined)
      choice(options.inspectionMode, ['freeze', 'compare'], 'options.inspectionMode');
    for (const key of [
      'layout',
      'inspection',
      'invalidate',
      'onInspect',
      'onRender',
      'onError',
      'onNavigate',
      'inputConsumed'
    ] as const)
      if (options[key] !== undefined && typeof options[key] !== 'function')
        fail(`options.${key}`, 'Expected a callback.');
    this.#options = { ...options };
    this.session = new ChartSession<Source>(options.inspectionMode);
    this.#painter = new CanvasRenderer(
      canvas,
      decoration,
      (target, position, pin, series, neighbors) => {
        if (this.#gesture?.consumed || this.#options.inputConsumed?.()) return;
        this.inspect(target, position, pin, series, neighbors);
      }
    );
    this.#layout = options.layout;
    this.#originalTouchAction = canvas.style.touchAction;
    this.#originalAttributes = new Map(
      ['tabindex', 'role', 'aria-label', 'aria-hidden'].map((name) => [
        name,
        canvas.getAttribute(name)
      ])
    );
    this.#handles.className = 'range-handles';
    Object.assign(this.#handles.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    canvas.append(this.#handles);
    const signal = this.#events.signal;
    this.#resize = new ResizeObserver(() => {
      const { width, height } = canvas.getBoundingClientRect();
      // A hidden host keeps its previous dimensions; showing it at the same size still
      // needs the layout/reading transaction skipped while its frame was zero-sized.
      if (width !== this.#width || height !== this.#height || this.#needsLayout) this.invalidate();
    });
    this.#resize.observe(canvas);
    window.addEventListener('resize', () => this.invalidate(), { signal });
    this.watchDensity();
    document.fonts?.addEventListener(
      'loadingdone',
      () => {
        this.#painter.invalidate();
        this.invalidate();
      },
      { signal }
    );
    canvas.addEventListener('pointerdown', (event) => this.begin(event), { capture: true, signal });
    canvas.addEventListener('pointermove', (event) => this.move(event), { capture: true, signal });
    canvas.addEventListener('pointerup', (event) => this.finish(event), { capture: true, signal });
    canvas.addEventListener('pointercancel', () => this.cancel(), { signal });
    canvas.addEventListener(
      'lostpointercapture',
      (event) => {
        // Touch initially captures the painted target. Its release bubbles when
        // the runtime takes capture; that transfer must not cancel the active drag.
        if (
          this.#gesture?.id === event.pointerId &&
          event.target === canvas &&
          !canvas.hasPointerCapture(event.pointerId)
        )
          this.cancel();
      },
      { signal }
    );
    canvas.addEventListener(
      'click',
      (event) => {
        if (this.#suppressClick) {
          this.#suppressClick = false;
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      { capture: true, signal }
    );
    canvas.addEventListener('keydown', (event) => this.keyboard(event), { signal });
    if (options.keyboard !== false) {
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'group');
    }
    if (options.layout) this.refresh();
  }
  private inspect(
    target: ChartInteraction<Source> | null,
    position: Position | null,
    pin: boolean,
    series: string | null = null,
    neighbors?: readonly ChartInteraction<Source>[]
  ) {
    const options = this.#options;
    if (options.inspection) options.inspection(target, position, pin, series, neighbors);
    else {
      const readingAccepted = this.session.inspect(target?.key ?? null, pin, false, series);
      this.focus(this.session.active);
      if (!readingAccepted) return;
      this.announce();
      options.onInspect?.(
        this.session.active,
        position,
        this.session.pinned,
        this.session.series,
        neighbors
      );
    }
  }
  get model() {
    return this.#painter.model;
  }
  set model(value: ChartScene<Source> | null) {
    this.#painter.model = value;
  }
  get diagnostics() {
    return this.#painter.diagnostics;
  }
  render(scene: ChartScene<Source>, state?: PaintState) {
    this.#painter.render(
      scene,
      state ?? {
        inspectionKey:
          (this.#options.inspection ? this.#focused : this.session.active)?.key ?? null,
        inspectionPinned: this.#options.inspection ? this.#focusedPinned : this.session.pinned,
        hoverKey: this.#options.inspection ? this.#hoverKey : this.pointerHoverKey(),
        inspectionSeries: this.#options.inspection ? this.#focusedSeries : this.session.series,
        selectedKey: this.#options.inspection ? this.#selectedKey : this.session.selected?.key,
        linkedInspectionKey: this.#linkedHighlight?.inspectionKey,
        linkedCursor: this.#linkedHighlight?.cursor,
        range: this.range.displayed
      }
    );
  }
  anchor(target: ChartInteraction<Source>) {
    return this.#painter.anchor(target);
  }
  private pointerHoverKey() {
    return this.session.inspectionMode === 'freeze' && this.session.pinned
      ? (this.session.hovered?.key ?? null)
      : null;
  }
  focus(
    target: ChartInteraction<Source> | null,
    pinned = this.session.pinned,
    series = this.session.series,
    selectedKey: string | null = this.session.selected?.key ??
      (pinned ? (target?.key ?? null) : null),
    hoverKey: string | null = this.pointerHoverKey()
  ) {
    this.#focused = target;
    this.#focusedPinned = target !== null && pinned;
    this.#focusedSeries = series;
    this.#selectedKey = selectedKey;
    this.#hoverKey = hoverKey;
    this.#painter.focus(target, this.#focusedPinned, series, selectedKey, hoverKey);
  }
  set linkedHighlight(value: LinkedHighlight | null) {
    this.#linkedHighlight = parseLinkedHighlight(value);
    if (this.model) this.render(this.model);
  }
  get linkedHighlight() {
    return this.#linkedHighlight && { ...this.#linkedHighlight };
  }
  selection(range: TimeWindow | null) {
    this.#painter.selection(range);
  }
  private watchDensity() {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener(
      'change',
      () => {
        if (this.#disposed) return;
        this.watchDensity();
        this.invalidate('paint');
      },
      { once: true, signal: this.#events.signal }
    );
  }
  setLayout(layout: SceneLayout<Source>) {
    this.#layout = layout;
    this.refresh();
  }
  private invalidate(reason: PaintInvalidation = 'layout') {
    if (reason === 'layout') this.#needsLayout = true;
    if (this.#options.invalidate) this.#options.invalidate(reason);
    else this.refresh(reason);
  }
  /** Layout invalidation wins when several requests share a frame. */
  refresh(reason: PaintInvalidation = 'layout') {
    if (this.#disposed) return;
    if (reason === 'layout') this.#needsLayout = true;
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      try {
        this.paint(this.#layout, 'paint');
      } catch (error) {
        this.#needsLayout = true;
        this.model = null;
        this.session.setModel(null);
        this.canvas.replaceChildren();
        this.canvas.setAttribute('aria-label', 'Chart rendering failed.');
        this.#options.onError?.(error);
      }
    });
  }
  /** Synchronous render for a host's coordinated state transaction. */
  paint(layout = this.#layout, reason: PaintInvalidation = 'layout') {
    if (this.#disposed || !layout) return;
    this.#layout = layout;
    const { width, height } = this.canvas.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const font = canvasFont(this.canvas);
    const needsLayout =
      reason === 'layout' ||
      this.#needsLayout ||
      !this.model ||
      width !== this.#width ||
      height !== this.#height ||
      font !== this.#font;
    if (this.#context) this.#context.font = font;
    const scene = needsLayout
      ? layout(
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
    this.render(scene);
    if (this.#handles.parentNode !== this.canvas) this.canvas.append(this.#handles);
    if (!this.#options.inspection) this.focus(this.session.active);
    if (this.#options.keyboard !== false) {
      if (scene.interactive === false) this.canvas.removeAttribute('tabindex');
      else this.canvas.tabIndex = 0;
      this.announce();
    }
    this.configureRange();
    this.#options.onRender?.(scene);
  }
  set rangeSelection(binding: RangeSelectionBinding | null) {
    if (this.#binding?.snapshot !== binding?.snapshot || binding?.enabled === false) this.cancel();
    const previous = this.#binding;
    this.#binding = binding;
    try {
      this.configureRange();
    } catch (error) {
      this.#binding = previous;
      this.configureRange();
      throw error;
    }
  }
  get rangeSelection() {
    return this.#binding;
  }
  private configureRange() {
    const time = this.model?.time,
      binding = this.#binding;
    const available = !!binding && !!time?.window && !!time.intervalMs;
    this.range.configure(
      available
        ? {
            snapshot: binding.snapshot,
            window: time.window!,
            intervalMs: time.intervalMs!,
            enabled: binding.enabled !== false && this.model?.interactive !== false
          }
        : null,
      available ? binding.value : null
    );
    if (!this.range.enabled && this.#gesture) this.cancel();
    this.canvas.style.touchAction = this.range.enabled ? 'pan-y' : this.#originalTouchAction;
    if (this.#options.keyboard === false) {
      if (this.range.enabled) {
        this.canvas.tabIndex = 0;
        this.canvas.removeAttribute('aria-hidden');
        this.canvas.setAttribute('role', 'group');
        this.canvas.setAttribute(
          'aria-label',
          'Select time range. Drag across the plot or use Shift and arrow keys, Enter to commit, Escape to cancel.'
        );
      } else {
        for (const [name, value] of this.#originalAttributes) {
          if (value === null) this.canvas.removeAttribute(name);
          else this.canvas.setAttribute(name, value);
        }
      }
    }
    this.paintRange();
  }
  private coordinates(event: PointerEvent): Position {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * (this.model?.width ?? rect.width)) / rect.width,
      y: ((event.clientY - rect.top) * (this.model?.height ?? rect.height)) / rect.height
    };
  }
  private instant(x: number) {
    const rect = this.model!.rect!,
      window = this.model!.time!.domain;
    return Math.round(
      window.start +
        Math.max(0, Math.min(1, (x - rect.x) / rect.width)) * (window.end - window.start)
    );
  }
  private begin(event: PointerEvent) {
    this.#suppressClick = false;
    if (
      !this.range.enabled ||
      !this.#binding ||
      !this.model?.rect ||
      event.button !== 0 ||
      !event.isPrimary
    )
      return;
    const { x, y } = this.coordinates(event),
      r = this.model.rect;
    const endpoint = (event.target as HTMLElement).dataset?.endpoint as 'start' | 'end' | undefined;
    if (!endpoint && (x < r.x || x > r.x + r.width || y < r.y || y > r.y + r.height)) return;
    this.range.cancel();
    const displayed = this.range.displayed;
    this.#gesture = {
      id: event.pointerId,
      x,
      y,
      anchor:
        endpoint && displayed ? displayed[endpoint === 'start' ? 'end' : 'start'] : this.instant(x),
      consumed: false,
      snapshot: this.#binding.snapshot,
      endpoint
    };
  }
  private move(event: PointerEvent) {
    const gesture = this.#gesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    const p = this.coordinates(event),
      dx = p.x - gesture.x,
      dy = p.y - gesture.y;
    if (!gesture.consumed) {
      if (event.pointerType === 'touch' && Math.abs(dy) > Math.max(4, Math.abs(dx))) {
        this.cancel();
        return;
      }
      if (Math.abs(dx) < 4) return;
      // Range gestures stop transient hover without changing a persistent selection.
      this.inspect(null, null, false);
      gesture.consumed = true;
      this.canvas.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.range.update(gesture.anchor, this.instant(p.x));
    this.#binding?.onPreview?.(this.range.preview);
    this.paintRange();
  }
  private finish(event: PointerEvent) {
    const gesture = this.#gesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    this.#gesture = null;
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
    if (!gesture.consumed) return;
    this.#suppressClick = true;
    event.preventDefault();
    event.stopImmediatePropagation();
    const value = this.range.commit(gesture.snapshot);
    this.#binding?.onPreview?.(null);
    if (value && this.#binding?.snapshot === gesture.snapshot)
      this.#binding.onCommit(value, gesture.snapshot);
    this.paintRange();
  }
  private cancel() {
    const gesture = this.#gesture;
    this.#gesture = null;
    if (gesture?.consumed) this.#suppressClick = true;
    if (gesture && this.canvas.hasPointerCapture(gesture.id))
      this.canvas.releasePointerCapture(gesture.id);
    this.range.cancel();
    this.#binding?.onPreview?.(null);
    this.paintRange();
  }
  private paintRange() {
    this.selection(this.range.displayed);
    // Keep focused handles across repaints so keyboard refinement can continue.
    if (!this.range.enabled || !this.range.displayed || !this.model?.rect) {
      this.#handles.replaceChildren();
      return;
    }
    const r = this.model.rect,
      domain = this.model.time!.domain,
      range = this.range.displayed;
    for (const endpoint of ['start', 'end'] as const) {
      let button = this.#handles.querySelector<HTMLButtonElement>(`[data-endpoint=${endpoint}]`);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.endpoint = endpoint;
        button.textContent = '⋮';
        this.#handles.append(button);
      }
      button.setAttribute(
        'aria-label',
        `Range ${endpoint}: ${new Date(range[endpoint]).toISOString()}. Arrow keys adjust, Enter commits, Escape cancels.`
      );
      Object.assign(button.style, {
        position: 'absolute',
        pointerEvents: 'auto',
        left: `${r.x + ((range[endpoint] - domain.start) / (domain.end - domain.start)) * r.width - 6}px`,
        top: `${r.y + r.height / 2 - 12}px`,
        width: '12px',
        height: '24px',
        border: '1px solid var(--color-text-brand)',
        borderRadius: '3px',
        background: 'var(--color-surface)',
        color: 'var(--color-text-brand)',
        padding: '0',
        cursor: 'ew-resize',
        font: 'inherit'
      });
    }
  }
  private keyboard(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey || this.model?.interactive === false) return;
    const endpoint = (event.target as HTMLElement).dataset?.endpoint as 'start' | 'end' | undefined;
    const adjusting = this.range.enabled && (event.shiftKey || endpoint || this.range.preview);
    if (adjusting && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      this.#endpoint = endpoint ?? this.#endpoint;
      this.range.adjust(
        this.#endpoint,
        event.key === 'Home' || event.key === 'End'
          ? event.key
          : event.key === 'ArrowRight'
            ? 1
            : -1
      );
      this.#binding?.onPreview?.(this.range.preview);
      this.paintRange();
      return;
    }
    if (this.range.enabled && event.key === 'Escape' && (this.range.preview || this.range.value)) {
      event.preventDefault();
      event.stopPropagation();
      if (this.range.preview) this.cancel();
      else this.#binding?.onDismiss?.(this.#binding.snapshot);
      return;
    }
    if (this.range.preview && event.key === 'Enter' && this.#binding) {
      event.preventDefault();
      event.stopPropagation();
      const value = this.range.commit(this.#binding.snapshot);
      this.#binding.onPreview?.(null);
      if (value) this.#binding.onCommit(value, this.#binding.snapshot);
      this.paintRange();
      return;
    }
    if (this.#options.keyboard === false) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const key =
        event.key === 'Home' || event.key === 'End'
          ? event.key
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? 'previous'
            : 'next';
      const target = this.session.next(key);
      if (target) this.#options.onNavigate?.(target);
      this.session.inspect(target?.key ?? null, false, true);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const target = this.session.active ?? this.session.next('Home');
      if (target) this.#options.onNavigate?.(target);
      this.session.inspect(target?.key ?? null, true, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.session.clearInspection();
    } else return;
    this.focus(this.session.active);
    this.announce();
    this.#options.onInspect?.(this.session.active, null, this.session.pinned);
  }
  private announce() {
    const active = this.session.active;
    this.canvas.setAttribute(
      'aria-label',
      active ? inspectionText(active) : (this.model?.ariaLabel ?? 'ScopeDB chart')
    );
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    cancelAnimationFrame(this.#frame);
    this.#events.abort();
    this.#resize.disconnect();
    this.cancel();
    this.#binding = null;
    this.range.reset();
    this.session.reset();
    this.#handles.remove();
    this.canvas.style.touchAction = this.#originalTouchAction;
    for (const [name, value] of this.#originalAttributes) {
      if (value === null) this.canvas.removeAttribute(name);
      else this.canvas.setAttribute(name, value);
    }
    this.#painter.dispose();
    if (this.#context) this.#context.canvas.width = this.#context.canvas.height = 0;
    this.#context = null;
    this.#focused = null;
  }
}
