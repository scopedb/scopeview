import { ownInspectionDismissal } from '../runtime/inspection-input.js';
import { captureScene, sceneSnapshot } from '../core/scene-snapshot.js';
import { object, boolean } from '../data/validation.js';
import type { ChartInteraction, ChartScene, Position } from '../core/scene.js';
import { inspectionText } from '../core/labels.js';
import {
  InspectionNotifications,
  type InspectionReading
} from '../core/inspection-notifications.js';
import {
  withInspectionContext,
  type HierarchyInspectionContext
} from '../core/inspection-context.js';
import type { ViewportState } from '../core/viewport.js';
import { ChartSession } from '../core/session.js';
import { readingState, restoredKey, shareReading, releaseReading } from '../core/reading-state.js';
import {
  channel,
  interactionFor,
  shareInteraction,
  readingPhase,
  viewportPhase,
  viewStatePhase,
  readyPhase
} from '../core/interaction.js';
import { HierarchyInteraction } from '../families/hierarchy/interaction.js';
import type { Entity, EntityDocument, Hierarchy } from '../families/hierarchy/model.js';
import {
  parseComponentOptions,
  type EntityComponentOptions
} from '../families/component-options.js';
import { layoutHierarchy, type HierarchyView } from '../families/hierarchy/layout.js';
import { SCOPE_CHART_STYLES } from '../theme/styles.js';
import { ChartRuntime } from '../runtime/chart-runtime.js';
import { ViewportController } from '../runtime/viewport-controller.js';
import {
  parseViewState,
  type HierarchyViewState,
  type DocumentUpdateOptions,
  type ViewStateChangeDetail
} from '../core/view-state.js';
import { parseLinkedHighlight, type LinkedHighlight } from '../core/link-group.js';
import {
  renderInspection,
  hideInspection,
  positionInspection,
  dockInspection
} from '../ui/inspection.js';
import { node } from '../ui/dom.js';
import {
  upgradeProperties,
  documentMutated,
  ElementTheme,
  watchColorScheme,
  type ScopeTheme
} from './lifecycle.js';
import {
  hierarchyControls,
  readControls,
  visibleControls,
  renderToolbar,
  ControlEvents,
  type ScopeChartAction
} from './controls.js';
import type { ScopeCommonEventDetails, ScopeEventListener, ScopeEventMap } from './events.js';

export interface HierarchyInspectionDetail<
  Source extends Entity = Entity,
  Context extends HierarchyInspectionContext = HierarchyInspectionContext
> {
  kind: Context['kind'];
  key: string | null;
  pinned: boolean;
  sources: Source[];
  context: Context | null;
}
export interface HierarchyReadyDetail {
  visualization: 'trace' | 'profile';
  nodes: number;
}
export interface HierarchyCollapseChangeDetail {
  collapsed: string[];
}
export interface HierarchyEventDetails<
  Source extends Entity = Entity,
  Context extends HierarchyInspectionContext = HierarchyInspectionContext
> extends ScopeCommonEventDetails {
  'scope-ready': HierarchyReadyDetail;
  'scope-inspect': HierarchyInspectionDetail<Source, Context>;
  'scope-select': HierarchyInspectionDetail<Source, Context>;
  'scope-viewport-change': ViewportState;
  'scope-collapse-change': HierarchyCollapseChangeDetail;
}
export type HierarchyEventMap<
  Source extends Entity = Entity,
  Context extends HierarchyInspectionContext = HierarchyInspectionContext
> = ScopeEventMap<HierarchyEventDetails<Source, Context>>;
interface CompiledEntity<Source extends Entity, Doc extends EntityDocument> {
  document: Doc;
  hierarchy: Hierarchy<Source>;
}

function sameViewport(a: Readonly<ViewportState>, b: Readonly<ViewportState>) {
  return a.start === b.start && a.end === b.end && a.scrollOffset === b.scrollOffset;
}

/** Shared shell for entity families. Family compilers own semantics; runtime owns paint/input. */
export class HierarchyElement<
  Source extends Entity,
  Doc extends EntityDocument,
  Compiled extends CompiledEntity<Source, Doc>,
  Context extends HierarchyInspectionContext = HierarchyInspectionContext
> extends HTMLElement {
  static observedAttributes = ['loading', 'error', 'theme', 'style', 'class'];
  #session = new ChartSession<Source>();
  #interaction: HierarchyInteraction<Source, Compiled>;
  #kernel = interactionFor(this.#session);
  get #compiled() {
    return this.#interaction.compiled;
  }
  get #renderedCompiled() {
    return sceneSnapshot(this.scene) as Compiled | null;
  }
  #ui: EntityComponentOptions = {};
  get #options() {
    return { ...this.#ui, interactive: this.#compiled?.document.options?.interactive };
  }
  get #view() {
    return this.#interaction.view;
  }
  get #viewport() {
    return this.#interaction.viewport;
  }
  get #collapsed() {
    return this.#interaction.collapsed;
  }
  #runtime: ChartRuntime<Source> | null = null;
  #input: ViewportController | null = null;
  #events: AbortController | null = null;
  #mutation: MutationObserver | null = null;
  #root: ShadowRoot;
  #appearance = new ElementTheme(this);
  #error: string | null = null;
  #propertySet = false;
  #frame = 0;
  #page = 0;
  #notifications = new InspectionNotifications<Source, Compiled>(() => {
    const snapshot = this.#renderedCompiled;
    const frame = this.scene;
    const project = (target: ChartInteraction<Source> | null) =>
      target && snapshot !== this.#compiled
        ? ((frame?.navigation ?? frame)?.interactionByKey.get(target.key) ?? null)
        : target;
    return {
      snapshot,
      inspect: { target: project(this.#session.active), pinned: this.#session.pinned },
      select: { target: project(this.#session.selected) }
    };
  }, this.#kernel);
  #viewportReports = channel({ start: 0, end: 1, scrollOffset: 0 }, sameViewport, viewportPhase);
  #stateReports = channel<ViewStateChangeDetail | null>(
    null,
    (a, b) => JSON.stringify(a?.state) === JSON.stringify(b?.state),
    viewStatePhase
  );
  #collapseReports = channel<string[]>([], (a, b) => JSON.stringify(a) === JSON.stringify(b));
  #readingEffect = {};
  #stateReason: ViewStateChangeDetail['reason'] = 'reconcile';
  #stateTransaction = false;
  #linkedHighlight: LinkedHighlight | null = null;
  #controlEvents = new ControlEvents(interactionFor(this.#session));
  constructor(
    readonly kind: Context['kind'],
    private compile: (input: unknown) => Compiled,
    createView: (compiled: Compiled, collapsed: ReadonlySet<string>) => HierarchyView<Source>,
    private inspectionContext: (
      compiled: Compiled,
      target: ChartInteraction<Source> | null
    ) => Context | null
  ) {
    super();
    this.#interaction = new HierarchyInteraction(this.#session, createView);
    this.#root = this.attachShadow({ mode: 'open' });
    const css = node('style');
    css.textContent =
      SCOPE_CHART_STYLES +
      `
      .viewport{height:var(--scope-chart-height,clamp(176px,var(--scope-chart-content-height,360px),360px))}
      .tree-scroll{position:absolute;right:0;top:24px;bottom:40px;width:12px;overflow-y:auto;z-index:2;scrollbar-width:thin}
      .tree-scroll>div{width:1px;pointer-events:none}
    `;
    const shell = node('section', 'root');
    shell.innerHTML = `<header hidden><h2></h2><p class="description" hidden></p></header>
      <div class="viewport" role="region" aria-label="ScopeDB ${kind === 'trace' ? 'trace timeline' : 'flame graph'}" aria-describedby="help">
        <div class="canvas" aria-describedby="help"></div><div class="decoration" aria-hidden="true"></div>
        <div class="tree-scroll" hidden tabindex="0" role="region" aria-label="Scroll chart rows"><div></div></div>
        <div class="status" role="status">Provide a ${kind} document.</div>
      </div><p class="summary" hidden></p>
      <slot name="toolbar"><div class="toolbar"><button class="inspect" type="button" aria-describedby="help" disabled>Inspect chart</button>
        <div class="toolbar-group" role="group" aria-label="Chart viewport">
          <button class="zoom-in icon-button" type="button" aria-label="Zoom in" title="Zoom in (+)" disabled>+</button><button class="zoom-out icon-button" type="button" aria-label="Zoom out" title="Zoom out (−)" disabled>−</button>
          <button class="reset" type="button" title="Reset view (0)" disabled>Reset view</button>
        </div><button class="collapse" type="button" disabled>Collapse</button>
        <button class="data" type="button" aria-expanded="false" aria-controls="raw" disabled>View data</button><span class="attribution">ScopeDB</span></div></slot>
      <div class="tooltip" role="tooltip" hidden></div>
      <div class="raw" id="raw" hidden></div><div class="pagination" hidden><button type="button" class="previous">Previous</button><span></span><button type="button" class="next">Next</button></div>
      <p class="sr-only" id="help">Arrows inspect, Home/End jump, Enter/Space pins, Escape dismisses. +/− zoom, Shift+Left/Right pan, Page Up/Down scroll, 0 resets. Drag pans; Ctrl/Command+wheel zooms. View data shows original values.</p>
      <span class="sr-only live" role="status" aria-live="polite" aria-atomic="true"></span>`;
    this.#root.append(css, shell);
  }
  #el<T extends HTMLElement = HTMLElement>(selector: string) {
    return this.#root.querySelector<T>(selector)!;
  }
  get document(): Doc | null {
    return this.#compiled ? structuredClone(this.#compiled.document) : null;
  }
  set document(value: unknown) {
    this.updateDocument(value);
  }
  /** Patch host UI while keeping the viewport, collapsed nodes and selection. */
  configure(options: EntityComponentOptions) {
    this.#kernel.batch(() => {
      this.#ui = { ...this.#ui, ...parseComponentOptions(options, 'hierarchy') };
      this.#schedule();
    });
  }
  updateDocument(value: unknown, options: DocumentUpdateOptions = {}) {
    this.#kernel.batch(() => {
      object(options, 'options', ['preserveViewState']);
      if (options.preserveViewState !== undefined)
        boolean(options.preserveViewState, 'options.preserveViewState');
      const previous = options.preserveViewState ? this.viewState : null;
      this.#stateTransaction = true;
      this.#propertySet = true;
      this.#kernel.effect(() => this.#input?.cancel());
      this.#clearInspection();
      this.#linkedHighlight = null;
      if (this.#runtime) this.#runtime.linkedHighlight = null;
      this.#page = 0;
      try {
        this.#interaction.replace(this.compile(value));
        this.#error = null;
      } catch (error) {
        this.#interaction.replace(null);
        this.#error = error instanceof Error ? error.message : 'Invalid document.';
      }
      if (previous && this.#compiled) this.#applyState(previous);
      this.#stateReason = 'document';
      this.#stateTransaction = false;
      this.#schedule();
    });
  }
  get viewState(): HierarchyViewState {
    return {
      version: 1,
      kind: this.kind,
      pinnedKey: restoredKey(this.#session) ?? this.#session.selected?.key ?? null,
      viewport: this.#interaction.desiredViewport,
      collapsed: this.collapsed.sort()
    };
  }
  set viewState(value: HierarchyViewState) {
    this.#kernel.batch(() => {
      const state = parseViewState(value);
      if (state.kind === 'metric' || state.kind !== this.kind)
        throw new TypeError(`Expected ${this.kind} view state.`);
      this.#notifications.invalidate();
      this.#kernel.effect(() => this.#input?.cancel());
      this.#applyState(state);
      this.#stateReason = 'restore';
      this.refresh();
    });
  }
  #applyState(state: HierarchyViewState) {
    this.#interaction.restore(state);
  }
  get linkedHighlight() {
    return this.#linkedHighlight && { ...this.#linkedHighlight };
  }
  set linkedHighlight(value: LinkedHighlight | null) {
    this.#linkedHighlight = parseLinkedHighlight(value);
    if (this.#runtime) this.#runtime.linkedHighlight = this.#linkedHighlight;
  }
  #stateChanged(reason: ViewStateChangeDetail['reason'] = 'interaction') {
    if (this.#stateTransaction) return;
    const state = this.viewState;
    const snapshot = this.#compiled;
    const key = JSON.stringify(state);
    this.#kernel.report(
      this.#stateReports,
      { state, reason },
      () => snapshot === this.#compiled && key === JSON.stringify(this.viewState),
      (detail) => {
        this.#dispatch('scope-view-state-change', detail!);
      }
    );
  }
  get loading() {
    return this.hasAttribute('loading');
  }
  set loading(value: boolean) {
    this.toggleAttribute('loading', value);
  }
  get error() {
    return this.getAttribute('error');
  }
  set error(value: string | null) {
    if (value === null) this.removeAttribute('error');
    else this.setAttribute('error', value);
  }
  /** Host appearance; mode is reflected to the `theme` attribute. */
  get theme(): ScopeTheme {
    return this.#appearance.value;
  }
  set theme(value: ScopeTheme) {
    this.#appearance.value = value;
  }
  addEventListener<K extends keyof HierarchyEventMap<Source, Context>>(
    type: K,
    listener: ScopeEventListener<this, HierarchyEventMap<Source, Context>[K]>,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) {
    super.addEventListener(type, listener, options);
  }
  removeEventListener<K extends keyof HierarchyEventMap<Source, Context>>(
    type: K,
    listener: ScopeEventListener<this, HierarchyEventMap<Source, Context>[K]>,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ) {
    super.removeEventListener(type, listener, options);
  }
  get viewport(): Readonly<ViewportState> {
    return this.#viewport.state;
  }
  set viewport(value: ViewportState) {
    this.#kernel.batch(() => {
      this.#kernel.effect(() => this.#input?.cancel());
      this.#viewport.set(value);
      this.#changedViewport();
    });
  }
  get collapsed(): string[] {
    return [...this.#collapsed];
  }
  set collapsed(value: Iterable<string>) {
    this.#kernel.batch(() => {
      this.#interaction.collapse(value);
      this.#kernel.effect(() => this.#input?.cancel());
      this.refresh();
      this.#emit('scope-collapse-change', { collapsed: this.collapsed });
    });
  }
  /** Current immutable scene; painted interactions are culled, navigation retains the visible tree. */
  get scene(): ChartScene<Source> | null {
    return this.#runtime?.model ?? null;
  }
  get diagnostics() {
    return this.#runtime?.diagnostics ?? null;
  }
  toggleNode(id: string) {
    if (!this.#compiled?.hierarchy.byId.has(id)) throw new RangeError(`Unknown node: ${id}`);
    const values = new Set(this.#collapsed);
    if (values.has(id)) values.delete(id);
    else values.add(id);
    this.collapsed = values;
  }
  focusNode(id: string, options: { pin?: boolean } = {}) {
    object(options, 'options', ['pin']);
    if (options.pin !== undefined) boolean(options.pin, 'options.pin');
    this.#kernel.batch(() => {
      this.#kernel.effect(() => this.#input?.cancel());
      const collapsed = this.collapsed.join('\0');
      if (!this.#interaction.focus(id, options.pin ?? false)) return;
      const intent = readingState(this.#session).intent;
      if (collapsed !== this.collapsed.join('\0'))
        this.#emit('scope-collapse-change', { collapsed: this.collapsed });
      this.#kernel.effect(() => {
        if (intent !== readingState(this.#session).intent || !this.#runtime) return;
        this.#runtime.paint();
        if (intent !== readingState(this.#session).intent || !this.#runtime) return;
        this.#showInspection(null, true);
        this.#el('.canvas').focus({ preventScroll: true });
        this.#publishViewport();
      });
    });
  }
  resetViewport() {
    this.#kernel.batch(() => {
      this.#kernel.effect(() => this.#input?.cancel());
      this.#viewport.reset();
      this.#changedViewport();
    });
  }
  get controls() {
    return visibleControls(this.#root, hierarchyControls, this.#options);
  }
  performAction(action: ScopeChartAction): boolean {
    return this.#kernel.batch(() => {
      if (
        !readControls(this.#root, hierarchyControls, this.#options).some(
          (control) => control.action === action && !control.disabled
        )
      )
        return false;
      if (action === 'inspect') {
        const id = this.#view?.items[0]?.id;
        if (id) this.focusNode(id);
      } else if (action === 'zoom-in' || action === 'zoom-out') {
        this.#viewport.zoom(action === 'zoom-in' ? 2 : 0.5);
        this.#changedViewport();
      } else if (action === 'reset-view') this.resetViewport();
      else if (action === 'toggle-collapse') {
        const id = this.#session.active?.sources[0]?.id;
        if (id) this.toggleNode(id);
      } else if (action === 'toggle-data') {
        const raw = this.#el('.raw');
        raw.hidden = !raw.hidden;
        this.#el('.data').setAttribute('aria-expanded', String(!raw.hidden));
        this.#el('.data').textContent = raw.hidden ? 'View data' : 'Hide data';
        this.#table();
      }
      this.#notifyControls();
      return true;
    });
  }
  #notifyControls() {
    this.#controlEvents.notify(this, this.controls);
  }
  refresh() {
    if (this.#runtime) this.#runtime.refresh();
    else this.#schedule();
  }
  #emit<K extends keyof HierarchyEventDetails<Source, Context>>(
    type: K,
    detail: HierarchyEventDetails<Source, Context>[K]
  ) {
    const snapshot = this.#compiled;
    const scene = this.scene;
    this.#notifyControls();
    if (type === 'scope-collapse-change') {
      const value = (detail as HierarchyCollapseChangeDetail).collapsed;
      this.#kernel.report(
        this.#collapseReports,
        value,
        () =>
          snapshot === this.#compiled && JSON.stringify(value) === JSON.stringify(this.collapsed),
        (collapsed) => this.#dispatch('scope-collapse-change', { collapsed: [...collapsed] })
      );
      return;
    }
    this.#kernel.effect(
      () => {
        if (
          snapshot === this.#compiled &&
          (type !== 'scope-ready' ||
            (this.isConnected &&
              !this.loading &&
              !this.error &&
              !this.#error &&
              scene === this.scene))
        )
          this.#dispatch(type, detail);
      },
      {},
      type === 'scope-ready' ? readyPhase : readingPhase
    );
  }
  #dispatch<K extends keyof HierarchyEventDetails<Source, Context>>(
    type: K,
    detail: HierarchyEventDetails<Source, Context>[K]
  ) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
  #changedViewport() {
    this.#kernel.batch(() => {
      if (!this.#session.pinned && !this.#session.keyboardInspection && !restoredKey(this.#session))
        this.#clearInspection();
      this.#runtime?.refresh();
      this.#publishViewport();
      this.#stateChanged();
    });
  }
  #publishViewport() {
    const snapshot = this.#compiled;
    const report = this.#interaction.report;
    if (!report) return;
    const value = { ...this.viewport };
    this.#notifyControls();
    this.#kernel.report(
      this.#viewportReports,
      value,
      () =>
        snapshot === this.#compiled &&
        report === this.#interaction.report &&
        sameViewport(value, this.viewport),
      (viewport) => this.#dispatch('scope-viewport-change', { ...viewport })
    );
  }
  #schedule() {
    if (!this.isConnected || this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#render();
    });
  }
  #readJSON() {
    const json = this.querySelector('script[type="application/json"]');
    if (!json) return;
    try {
      this.document = JSON.parse(json.textContent ?? '');
    } catch {
      this.#interaction.replace(null);
      this.#error = 'Invalid chart JSON.';
      this.#schedule();
    }
    this.#propertySet = false;
  }
  connectedCallback() {
    upgradeProperties(this, [
      'document',
      'loading',
      'error',
      'theme',
      'viewport',
      'collapsed',
      'viewState',
      'linkedHighlight'
    ]);
    this.#events = new AbortController();
    const signal = this.#events.signal;
    watchColorScheme(() => this.refresh(), signal);
    const bind = (selector: string, callback: () => void) =>
      this.#el(selector).addEventListener('click', callback, { signal });
    for (const [action, selector] of Object.entries(hierarchyControls))
      bind(selector, () => this.performAction(action as ScopeChartAction));
    this.#el('slot[name="toolbar"]').addEventListener('slotchange', () => this.#schedule(), {
      signal
    });
    bind('.previous', () => {
      this.#page--;
      this.#table();
    });
    bind('.next', () => {
      this.#page++;
      this.#table();
    });
    this.#el('.tree-scroll').addEventListener(
      'scroll',
      () => {
        const scrollOffset = this.#el('.tree-scroll').scrollTop;
        if (Math.abs(scrollOffset - this.viewport.scrollOffset) < 0.5) return;
        this.#viewport.set({ ...this.viewport, scrollOffset });
        this.#changedViewport();
      },
      { signal }
    );
    const canvas = this.#el('.canvas');
    ownInspectionDismissal(canvas, signal);
    canvas.addEventListener(
      'keydown',
      (event) => {
        if (
          event.defaultPrevented ||
          event.key !== 'Escape' ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          this.scene?.interactive === false
        )
          return;
        event.preventDefault();
        this.#kernel.batch(() => this.#clearInspection('interaction', true));
      },
      { signal }
    );
    this.#root.addEventListener(
      'keydown',
      (event) => {
        if (
          (event as KeyboardEvent).key !== 'Escape' ||
          event.composedPath().includes(canvas) ||
          (!this.#session.active && restoredKey(this.#session) === undefined)
        )
          return;
        event.preventDefault();
        this.#clearInspection();
        canvas.focus({ preventScroll: true });
      },
      { signal }
    );
    const outside = (event: Event) => {
      if (this.#ui.dismissOnOutside !== false && !event.composedPath().includes(this))
        this.#clearInspection();
    };
    document.addEventListener('pointerdown', outside, { signal });
    document.addEventListener('focusin', outside, { signal });
    window.addEventListener(
      'scroll',
      (event) => {
        if (
          event.composedPath().includes(this.#el('.tooltip')) ||
          event.composedPath().includes(this.#el('.tree-scroll'))
        )
          return;
        if (this.#session.pinned || this.#session.keyboardInspection) this.#placeTooltip();
        else this.#clearInspection();
      },
      { capture: true, signal }
    );
    this.#mutation = new MutationObserver((records) => {
      if (!this.#propertySet && documentMutated(records)) this.#readJSON();
    });
    this.#mutation.observe(this, { childList: true, subtree: true, characterData: true });
    if (!this.#propertySet) this.#readJSON();
    this.#schedule();
  }
  disconnectedCallback() {
    this.#kernel.batch(() => {
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      this.#mutation?.disconnect();
      this.#mutation = null;
      this.#events?.abort();
      this.#events = null;
      this.#clearInspection();
      this.#dispose();
    });
  }
  attributeChangedCallback(name: string) {
    if (!this.isConnected) return;
    if (name === 'loading' || name === 'error') this.#schedule();
    else this.refresh();
  }
  #dispose() {
    const runtime = this.#runtime,
      input = this.#input;
    this.#runtime = null;
    this.#input = null;
    if (runtime) releaseReading(runtime.session);
    this.#interaction.deactivate();
    this.#kernel.effect(() => {
      runtime?.dispose();
      input?.dispose();
    });
  }
  #status(state: string, message: string | null) {
    this.dataset.state = state;
    this.#el('.status').hidden = message === null;
    this.#el('.status').textContent = message;
    this.#el('.status').className = `status ${state}`;
    this.#el('.viewport').setAttribute('aria-busy', String(state === 'loading'));
    this.#notifyControls();
  }
  #render() {
    this.#kernel.batch(() => {
      const compiled = this.#compiled,
        view = this.#view;
      const title = compiled?.document.title ?? '',
        description = compiled?.document.description ?? '';
      this.#el('header').hidden = this.#ui.header === false || (!title && !description);
      this.#el('h2').textContent = title;
      this.#el('.description').textContent = description;
      this.#el('.description').hidden = !description;
      renderToolbar(this.#root, this.#options, hierarchyControls);
      this.#el('.viewport').style.setProperty(
        '--scope-chart-content-height',
        `${(view?.rowCount ?? 0) * (view?.rowHeight ?? 24) + 64}px`
      );
      const message = this.error ?? this.#error;
      const blocked = this.loading || message !== null || !compiled || !view?.items.length;
      for (const button of this.#root.querySelectorAll<HTMLButtonElement>('.toolbar button'))
        button.disabled = blocked;
      this.#table();
      if (blocked) {
        const saved = this.loading && compiled && message === null ? this.viewState : null;
        if (saved) this.#stateTransaction = true;
        this.#clearInspection();
        this.#dispose();
        if (saved) this.#applyState(saved);
        this.#stateTransaction = false;
        this.#el('.tree-scroll').hidden = true;
        this.#el('.summary').hidden = true;
        const state =
          message !== null ? 'error' : this.loading ? 'loading' : compiled ? 'empty' : 'idle';
        this.#status(
          state,
          message !== null
            ? message
            : this.loading
              ? 'Loading chart…'
              : compiled
                ? 'No nodes returned.'
                : `Provide a ${this.kind} document.`
        );
        this.#stateChanged(this.#stateReason);
        if (message !== null) this.#emit('scope-error', { message });
        return;
      }
      if (!this.#runtime) {
        const canvas = this.#el('.canvas');
        shareInteraction(canvas, this.#kernel);
        this.#input = new ViewportController(canvas, this.#viewport, {
          rect: () => this.scene?.rect,
          enabled: () => this.#view?.document.options?.interactive !== false,
          onChange: () => this.#changedViewport()
        });
        const runtime = new ChartRuntime<Source>(canvas, this.#el('.decoration'), {
          layout: (width, height, measure) => {
            const current = this.#view!;
            if (this.#runtime === runtime)
              this.#interaction.measure(height, this.#ui.axes ?? 'full');
            const scene = layoutHierarchy(
              current,
              width,
              height,
              measure,
              this.viewport,
              this.#ui.axes ?? 'full'
            );
            return captureScene(scene, this.#compiled!);
          },
          onNavigate: (target) => {
            if (this.#runtime !== runtime) return;
            const before = this.viewport;
            this.#interaction.navigate(target);
            if (!sameViewport(before, this.viewport))
              this.#kernel.effect(() => {
                this.#runtime?.paint();
                this.#publishViewport();
              });
          },
          inputConsumed: () => this.#input?.consumed ?? false,
          onInspect: (_value, position) => {
            if (this.#runtime === runtime) this.#showInspection(position, true);
          },
          onError: (error) => {
            if (this.#runtime !== runtime) return;
            this.#error = error instanceof Error ? error.message : 'Chart rendering failed.';
            this.#schedule();
          },
          onRender: () => {
            if (this.#runtime === runtime) this.#rendered();
          }
        });
        this.#runtime = runtime;
        shareReading(runtime.session, this.#session);
        this.#interaction.activate();
        this.#runtime.linkedHighlight = this.#linkedHighlight;
      } else this.#runtime.refresh();
    });
  }
  #rendered() {
    const scene = this.scene,
      view = this.#view,
      compiled = this.#renderedCompiled;
    if (!scene || !view || !compiled) return;
    const rail = this.#el('.tree-scroll');
    rail.hidden =
      scene.interactive === false || view.rowCount * view.rowHeight <= scene.rect!.height;
    this.#el('.tree-scroll>div').style.height = `${view.rowCount * view.rowHeight}px`;
    if (Math.abs(rail.scrollTop - this.viewport.scrollOffset) > 0.5)
      rail.scrollTop = this.viewport.scrollOffset;
    for (const selector of ['.inspect', '.zoom-in', '.zoom-out', '.reset'])
      this.#el<HTMLButtonElement>(selector).disabled = scene.interactive === false;
    this.#el<HTMLButtonElement>('.data').disabled = this.#ui.dataTable === false;
    const summary = this.#el('.summary');
    summary.hidden = this.#ui.summary === false;
    const coverage =
      this.kind === 'trace'
        ? ((compiled.document as EntityDocument & { coverage?: string }).coverage ?? 'unknown')
        : null;
    summary.textContent = `${compiled.hierarchy.sources.length.toLocaleString('en-US')} nodes${coverage ? ` · ${coverage} trace coverage` : ''}${view.issues.length ? ` · ${view.issues.length} relationship warning${view.issues.length === 1 ? '' : 's'}` : ''}`;
    this.#status('ready', null);
    if (compiled !== this.#compiled || !this.isConnected) return;
    this.#showInspection(null, false, this.#stateReason);
    if (compiled !== this.#compiled || !this.isConnected) return;
    this.#publishViewport();
    if (compiled !== this.#compiled || !this.isConnected) return;
    this.#stateChanged(this.#stateReason);
    this.#stateReason = 'reconcile';
    this.#emit('scope-ready', {
      visualization: this.kind,
      nodes: compiled.hierarchy.sources.length
    });
  }
  #detail(
    reading: InspectionReading<Source>,
    compiled: Compiled | null
  ): HierarchyInspectionDetail<Source, Context> {
    const { target: active, pinned = false } = reading,
      project = this.inspectionContext;
    return withInspectionContext(
      {
        kind: this.kind,
        key: active?.key ?? null,
        pinned,
        sources: structuredClone([...(active?.sources ?? [])])
      },
      () => (compiled ? project(compiled, active) : null)
    );
  }
  #clearInspection(reason: ViewStateChangeDetail['reason'] = 'interaction', input = false) {
    this.#kernel.batch(() => {
      this.#notifications.invalidate();
      this.#interaction.dismiss();
      this.#showInspection(null, input, reason);
    });
  }
  #showInspection(
    position: Position | null,
    emit: boolean,
    reason: ViewStateChangeDetail['reason'] = 'interaction'
  ) {
    const batch = this.#notifications.capture();
    const silent = this.#stateTransaction;
    this.#kernel.effect(
      () => this.#presentInspection(batch, position),
      this.#readingEffect,
      0,
      () => batch.current('inspect')
    );
    if (!silent && (!this.#session.active || batch.state.inspect.target)) {
      for (const channel of ['inspect', 'select'] as const)
        batch.emit(
          channel,
          (value, snapshot) => this.#dispatch(`scope-${channel}`, this.#detail(value, snapshot)),
          channel === 'inspect' && emit
        );
    }
    this.#stateChanged(reason);
  }
  #presentInspection(
    batch: ReturnType<InspectionNotifications<Source, Compiled>['capture']>,
    position: Position | null
  ) {
    this.#runtime?.focus(this.#session.active);
    const { target: active, pinned } = batch.state.inspect;
    const tooltip = this.#el('.tooltip');
    this.#el('.inspect').toggleAttribute('data-active', pinned);
    const id = active?.sources[0]?.id,
      children = id && this.#compiled?.hierarchy.children.get(id);
    this.#el<HTMLButtonElement>('.collapse').disabled =
      !children?.length || this.#view?.document.options?.interactive === false;
    this.#el('.collapse').textContent = id && this.#collapsed.has(id) ? 'Expand' : 'Collapse';
    if (children?.length)
      this.#el('.collapse').setAttribute('aria-expanded', String(!this.#collapsed.has(id!)));
    else this.#el('.collapse').removeAttribute('aria-expanded');
    this.#notifyControls();
    if (batch.current('inspect')) {
      if (!active) {
        hideInspection(tooltip);
        this.#el('.live').textContent = '';
      } else if ((pinned ? this.#ui.inspector : this.#ui.tooltip) === false) {
        hideInspection(tooltip);
        this.#el('.live').textContent = inspectionText(active);
      } else {
        dockInspection(tooltip, pinned);
        renderInspection(tooltip, active, pinned, () => {
          this.#clearInspection();
          this.#el('.canvas').focus({ preventScroll: true });
        });
        this.#placeTooltip(position);
        const reading = inspectionText(active);
        if (this.#el('.live').textContent !== reading) this.#el('.live').textContent = reading;
      }
    }
  }
  #placeTooltip(position: Position | null = null) {
    const active = this.#session.active;
    if (!active || this.#el('.tooltip').hidden) return;
    const tooltip = this.#el('.tooltip');
    // Persistent details belong to this component's flow, never guessed free viewport space.
    if (this.#session.pinned) return;
    const bounds = this.#el('.canvas').getBoundingClientRect();
    const anchor = position ?? this.#runtime?.anchor(active) ?? { x: bounds.width / 2, y: 24 };
    positionInspection(tooltip, { x: bounds.left + anchor.x, y: bounds.top + anchor.y });
  }
  #table() {
    const raw = this.#el('.raw'),
      sources = this.#compiled?.hierarchy.sources ?? [];
    if (this.#ui.dataTable === false) {
      raw.hidden = true;
      this.#el('.data').setAttribute('aria-expanded', 'false');
      this.#el('.data').textContent = 'View data';
    }
    const pages = Math.max(1, Math.ceil(sources.length / 50));
    this.#page = Math.max(0, Math.min(this.#page, pages - 1));
    this.#el('.pagination').hidden = raw.hidden || sources.length <= 50;
    raw.replaceChildren();
    if (raw.hidden || !this.#compiled) return;
    const fields = [
      'id',
      'parentId',
      'name',
      ...(this.kind === 'trace'
        ? ['startTimeNs', 'endTimeNs', 'service', 'status']
        : ['selfWeight', 'file', 'line']),
      'attributes'
    ];
    const table = node('table'),
      head = node('thead'),
      tr = node('tr');
    table.append(
      node(
        'caption',
        '',
        `${sources.length} supplied nodes. Original integer strings; absent fields shown as —.`
      )
    );
    for (const field of fields) {
      const th = node('th', '', field);
      th.scope = 'col';
      tr.append(th);
    }
    head.append(tr);
    table.append(head);
    const body = node('tbody');
    for (const source of sources.slice(this.#page * 50, (this.#page + 1) * 50)) {
      const tr = node('tr');
      for (const field of fields) {
        const value = (source as unknown as Record<string, unknown>)[field];
        tr.append(
          node(
            'td',
            '',
            value === undefined
              ? '—'
              : value === null
                ? 'null'
                : typeof value === 'object'
                  ? JSON.stringify(value)
                  : String(value)
          )
        );
      }
      body.append(tr);
    }
    table.append(body);
    raw.append(table);
    this.#el('.pagination span').textContent = `Page ${this.#page + 1} of ${pages}`;
    this.#el<HTMLButtonElement>('.previous').disabled = this.#page === 0;
    this.#el<HTMLButtonElement>('.next').disabled = this.#page === pages - 1;
  }
}
