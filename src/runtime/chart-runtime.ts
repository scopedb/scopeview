import { inspectKey, ownsInspectionDismissal } from './inspection-input.js';
import { interactionFor, claimInteraction, readingPhase } from '../core/interaction.js';
import { readingState, releaseReading } from '../core/reading-state.js';
import { ChartSession } from '../core/session.js';
import { RangeSelectionSession, type RangeSelectionBinding } from '../core/range.js';
import type { ChartInteraction, ChartScene, Inspect, Position } from '../core/scene.js';
import type { ScenePainter, PaintState, PaintInvalidation } from '../core/painter.js';
import { object, boolean, choice, fail } from '../data/validation.js';
import type { TimeWindow } from '../data/time.js';
import type { ResultRow } from '../data/result.js';
import { parseLinkedHighlight, type LinkedHighlight } from '../core/link-group.js';
import { RuntimeLifecycle } from './lifecycle.js';
import type { ReadingOptions, SceneLayout } from './types.js';

export interface RuntimeOptions<Source> extends Omit<ReadingOptions<Source>, 'layout'> {
  layout?: SceneLayout<Source>;
  /** An enclosing UI can own inspection controls and its repaint transaction. */
  inspection?: Inspect<Source>;
  invalidate?(reason: PaintInvalidation): void;
  keyboard?: boolean;
  inspectionMode?: 'freeze' | 'compare';
}

const callbackKeys = [
  'layout',
  'inspection',
  'invalidate',
  'onInspect',
  'onRender',
  'onError',
  'onNavigate',
  'inputConsumed'
] as const;

/** Shared browser lifecycle and input arbitration for the element and custom hosts. */
export class ChartRuntime<Source = ResultRow>
  extends RuntimeLifecycle<Source>
  implements ScenePainter<Source>
{
  readonly session: ChartSession<Source>;
  readonly range = new RangeSelectionSession();
  protected declare readonly options: RuntimeOptions<Source>;
  #focused: ChartInteraction<Source> | null = null;
  #focusedPinned = false;
  #focusedSeries: string | null = null;
  #selectedKey: string | null = null;
  #hoverKey: string | null = null;
  #linkedHighlight: LinkedHighlight | null = null;
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
  #originalAttributes: readonly (readonly [string, string | null])[];
  #originalTouchAction: string;

  constructor(canvas: HTMLElement, decoration: HTMLElement, options: RuntimeOptions<Source> = {}) {
    object(options, 'options', ['inspectionMode', 'keyboard', ...callbackKeys]);
    if (options.keyboard !== undefined) boolean(options.keyboard, 'options.keyboard');
    if (options.inspectionMode !== undefined)
      choice(options.inspectionMode, ['freeze', 'compare'], 'options.inspectionMode');
    for (const key of callbackKeys)
      if (options[key] !== undefined && typeof options[key] !== 'function')
        fail(`options.${key}`, 'Expected a callback.');
    super(
      canvas,
      decoration,
      (target, position, pin, series, neighbors) => {
        if (this.#gesture?.consumed || this.options.inputConsumed?.()) return;
        interactionFor(this.session).batch(() =>
          this.#inspect(target, position, pin, series, neighbors)
        );
      },
      { ...options }
    );
    this.session = new ChartSession<Source>(options.inspectionMode);
    claimInteraction(this.session, canvas);
    this.#originalTouchAction = canvas.style.touchAction;
    this.#originalAttributes = ['tabindex', 'role', 'aria-label', 'aria-hidden'].map(
      (name) => [name, canvas.getAttribute(name)] as const
    );
    this.#handles.className = 'range-handles';
    Object.assign(this.#handles.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    canvas.append(this.#handles);
    const signal = this.signal;
    canvas.addEventListener('pointerdown', (event) => this.#begin(event), {
      capture: true,
      signal
    });
    canvas.addEventListener('pointermove', (event) => this.#move(event), { capture: true, signal });
    canvas.addEventListener('pointerup', (event) => this.#finish(event), { capture: true, signal });
    canvas.addEventListener('pointercancel', () => this.#cancel(), { signal });
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
          this.#cancel();
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
    if (options.keyboard !== false) {
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'group');
    }
    if (options.layout) this.refresh();
  }
  #inspect(
    target: ChartInteraction<Source> | null,
    position: Position | null,
    pin: boolean,
    series: string | null = null,
    neighbors?: readonly ChartInteraction<Source>[]
  ) {
    const options = this.options;
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
    return this.painter.model;
  }
  set model(value: ChartScene<Source> | null) {
    this.painter.model = value;
  }
  get diagnostics() {
    return this.painter.diagnostics;
  }
  render(scene: ChartScene<Source>, state?: PaintState) {
    const external = this.options.inspection;
    this.painter.render(
      scene,
      state ?? {
        inspectionKey: (external ? this.#focused : this.session.active)?.key ?? null,
        inspectionPinned: external ? this.#focusedPinned : this.session.pinned,
        hoverKey: external ? this.#hoverKey : this.#pointerHoverKey(),
        inspectionSeries: external ? this.#focusedSeries : this.session.series,
        selectedKey: external ? this.#selectedKey : this.session.selected?.key,
        linkedInspectionKey: this.#linkedHighlight?.inspectionKey,
        linkedCursor: this.#linkedHighlight?.cursor,
        range: this.range.displayed
      }
    );
  }
  #pointerHoverKey() {
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
    hoverKey: string | null = this.#pointerHoverKey()
  ) {
    this.#focused = target;
    this.#focusedPinned = target !== null && pinned;
    this.#focusedSeries = series;
    this.#selectedKey = selectedKey;
    this.#hoverKey = hoverKey;
    this.painter.focus(target, this.#focusedPinned, series, selectedKey, hoverKey);
  }
  set linkedHighlight(value: LinkedHighlight | null) {
    this.#linkedHighlight = parseLinkedHighlight(value);
    if (this.model) this.render(this.model);
  }
  get linkedHighlight() {
    return this.#linkedHighlight && { ...this.#linkedHighlight };
  }
  selection(range: TimeWindow | null) {
    this.painter.selection(range);
  }
  setLayout(layout: SceneLayout<Source>) {
    this.options.layout = layout;
    this.refresh();
  }
  protected draw(scene: ChartScene<Source>) {
    this.render(scene);
    if (this.#handles.parentNode !== this.canvas) this.canvas.append(this.#handles);
    if (!this.options.inspection) this.focus(this.session.active);
    if (this.options.keyboard !== false) {
      if (scene.interactive === false) this.canvas.removeAttribute('tabindex');
      else this.canvas.tabIndex = 0;
      this.announce();
    }
    this.#configureRange();
  }
  set rangeSelection(binding: RangeSelectionBinding | null) {
    if (this.#binding?.snapshot !== binding?.snapshot || binding?.enabled === false) this.#cancel();
    const previous = this.#binding;
    this.#binding = binding;
    try {
      this.#configureRange();
    } catch (error) {
      this.#binding = previous;
      this.#configureRange();
      throw error;
    }
  }
  get rangeSelection() {
    return this.#binding;
  }
  #configureRange() {
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
    if (!this.range.enabled && this.#gesture) this.#cancel();
    this.canvas.style.touchAction = this.range.enabled ? 'pan-y' : this.#originalTouchAction;
    if (this.options.keyboard === false) {
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
    this.#paintRange();
  }
  #coordinates(event: PointerEvent): Position {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * (this.model?.width ?? rect.width)) / rect.width,
      y: ((event.clientY - rect.top) * (this.model?.height ?? rect.height)) / rect.height
    };
  }
  #instant(x: number) {
    const rect = this.model!.rect!,
      window = this.model!.time!.domain;
    return Math.round(
      window.start +
        Math.max(0, Math.min(1, (x - rect.x) / rect.width)) * (window.end - window.start)
    );
  }
  #begin(event: PointerEvent) {
    this.#suppressClick = false;
    if (
      !this.range.enabled ||
      !this.#binding ||
      !this.model?.rect ||
      event.button !== 0 ||
      !event.isPrimary
    )
      return;
    const { x, y } = this.#coordinates(event),
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
        endpoint && displayed
          ? displayed[endpoint === 'start' ? 'end' : 'start']
          : this.#instant(x),
      consumed: false,
      snapshot: this.#binding.snapshot,
      endpoint
    };
  }
  #move(event: PointerEvent) {
    const gesture = this.#gesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    const p = this.#coordinates(event),
      dx = p.x - gesture.x,
      dy = p.y - gesture.y;
    if (!gesture.consumed) {
      if (event.pointerType === 'touch' && Math.abs(dy) > Math.max(4, Math.abs(dx))) {
        this.#cancel();
        return;
      }
      if (Math.abs(dx) < 4) return;
      // Range gestures stop transient hover without changing a persistent selection.
      this.#inspect(null, null, false);
      gesture.consumed = true;
      this.canvas.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.range.update(gesture.anchor, this.#instant(p.x));
    this.#binding?.onPreview?.(this.range.preview);
    this.#paintRange();
  }
  #finish(event: PointerEvent) {
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
    this.#paintRange();
  }
  #cancel() {
    const gesture = this.#gesture;
    this.#gesture = null;
    if (gesture?.consumed) this.#suppressClick = true;
    if (gesture && this.canvas.hasPointerCapture(gesture.id))
      this.canvas.releasePointerCapture(gesture.id);
    this.range.cancel();
    this.#binding?.onPreview?.(null);
    this.#paintRange();
  }
  #paintRange() {
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
  protected keyboard(event: KeyboardEvent) {
    interactionFor(this.session).batch(() => this.#keyboard(event));
  }
  #keyboard(event: KeyboardEvent) {
    if (event.key === 'Escape' && ownsInspectionDismissal(this.canvas)) return;
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      this.model?.interactive === false
    )
      return;
    const range = this.range;
    const endpoint = (event.target as HTMLElement).dataset?.endpoint as 'start' | 'end' | undefined;
    const adjusting = range.enabled && (event.shiftKey || endpoint || range.preview);
    if (adjusting && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      this.#endpoint = endpoint ?? this.#endpoint;
      range.adjust(
        this.#endpoint,
        event.key === 'Home' || event.key === 'End'
          ? event.key
          : event.key === 'ArrowRight'
            ? 1
            : -1
      );
      this.#binding?.onPreview?.(range.preview);
      this.#paintRange();
      return;
    }
    if (range.enabled && event.key === 'Escape' && (range.preview || range.value)) {
      event.preventDefault();
      event.stopPropagation();
      if (range.preview) this.#cancel();
      else this.#binding?.onDismiss?.(this.#binding.snapshot);
      return;
    }
    if (range.preview && event.key === 'Enter' && this.#binding) {
      event.preventDefault();
      event.stopPropagation();
      const value = range.commit(this.#binding.snapshot);
      this.#binding.onPreview?.(null);
      if (value) this.#binding.onCommit(value, this.#binding.snapshot);
      this.#paintRange();
      return;
    }
    if (this.options.keyboard === false) return;
    const target = inspectKey(event, this.session, true);
    if (target === undefined) return;
    if (target) {
      const intent = readingState(this.session).intent;
      interactionFor(this.session).effect(() => {
        if (!this.signal.aborted && intent === readingState(this.session).intent)
          this.options.onNavigate?.(target);
      });
    }
    interactionFor(this.session).effect(
      () => {
        if (this.signal.aborted) return;
        this.focus(this.session.active);
        this.announce();
        this.options.onInspect?.(this.session.active, null, this.session.pinned);
      },
      {},
      readingPhase
    );
  }
  protected release() {
    releaseReading(this.session);
    this.#cancel();
    this.#binding = null;
    this.range.reset();
    this.session.reset();
    this.#handles.remove();
    this.canvas.style.touchAction = this.#originalTouchAction;
    for (const [name, value] of this.#originalAttributes) {
      if (value === null) this.canvas.removeAttribute(name);
      else this.canvas.setAttribute(name, value);
    }
    this.#focused = null;
  }
}
