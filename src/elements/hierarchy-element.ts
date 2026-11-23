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
import { ViewportSession, type ViewportState } from '../core/viewport.js';
import type { Entity, EntityDocument, Hierarchy } from '../families/hierarchy/model.js';
import {
  DEFAULT_ROW_HEIGHT,
  hierarchyPadding,
  hierarchyViewportHeight,
  layoutHierarchy,
  type HierarchyView
} from '../families/hierarchy/layout.js';
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
import { bindInspectionDismiss } from '../ui/inspection-floating.js';
import { node } from '../ui/dom.js';
import {
  upgradeProperties,
  observeDocumentScript,
  ElementTheme,
  watchColorScheme,
  type ScopeTheme
} from './lifecycle.js';
import {
  renderDataTable,
  setDataTableOpen,
  type DataTableElements,
  type DataTableModel
} from './data-table.js';
import { parseComponentOptions, type EntityComponentOptions } from './options.js';
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

/** Shared shell for entity families. Family compilers own semantics; runtime owns paint/input. */
export class HierarchyElement<
  Source extends Entity,
  Doc extends EntityDocument,
  Compiled extends CompiledEntity<Source, Doc>,
  Context extends HierarchyInspectionContext = HierarchyInspectionContext
> extends HTMLElement {
  static observedAttributes = ['loading', 'error', 'theme', 'style', 'class'];
  #compiled: Compiled | null = null;
  #renderedCompiled: Compiled | null = null;
  #ui: EntityComponentOptions = {};
  get #options() {
    return { ...this.#ui, interactive: this.#view?.interactive };
  }
  #view: HierarchyView<Source> | null = null;
  #viewport = new ViewportSession();
  #collapsed = new Set<string>();
  #runtime: ChartRuntime<Source> | null = null;
  #input: ViewportController | null = null;
  #events: AbortController | null = null;
  #mutation: MutationObserver | null = null;
  #root: ShadowRoot;
  #dom: {
    header: HTMLElement;
    title: HTMLElement;
    description: HTMLElement;
    viewport: HTMLElement;
    canvas: HTMLElement;
    decoration: HTMLElement;
    treeScroll: HTMLElement;
    treeScrollSizer: HTMLElement;
    status: HTMLElement;
    summary: HTMLElement;
    toolbarSlot: HTMLSlotElement;
    inspect: HTMLButtonElement;
    zoomIn: HTMLButtonElement;
    zoomOut: HTMLButtonElement;
    reset: HTMLButtonElement;
    collapse: HTMLButtonElement;
    data: HTMLButtonElement;
    tooltip: HTMLElement;
    raw: HTMLElement;
    pagination: HTMLElement;
    paginationLabel: HTMLElement;
    previous: HTMLButtonElement;
    next: HTMLButtonElement;
    live: HTMLElement;
  };
  #appearance = new ElementTheme(this);
  #error: string | null = null;
  #propertySet = false;
  #frame = 0;
  #page = 0;
  #notifications = new InspectionNotifications<Source, Compiled>(() => ({
    snapshot: this.#renderedCompiled,
    inspect: {
      target: this.#runtime?.session.active ?? null,
      pinned: this.#runtime?.session.pinned ?? false
    },
    select: { target: this.#runtime?.session.selected ?? null }
  }));
  #pendingPin: string | null | undefined;
  #pendingViewport: ViewportState | null = null;
  #stateReason: ViewStateChangeDetail['reason'] = 'reconcile';
  #lastState = '';
  #stateTransaction = false;
  #linkedHighlight: LinkedHighlight | null = null;
  #controlEvents = new ControlEvents();
  #lastStatusState = '';
  #lastStatusMessage: string | null = null;
  #lastSummary = '';
  #lastTreeHeight = '';
  #lastContentHeight = '';
  #lastRailTop = '';
  #lastRailBottom = '';
  constructor(
    readonly kind: Context['kind'],
    private compile: (input: unknown) => Compiled,
    private createView: (
      compiled: Compiled,
      collapsed: ReadonlySet<string>
    ) => HierarchyView<Source>,
    private inspectionContext: (
      compiled: Compiled,
      target: ChartInteraction<Source> | null
    ) => Context | null
  ) {
    super();
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
    const q = <T extends HTMLElement = HTMLElement>(selector: string) =>
      this.#root.querySelector<T>(selector)!;
    this.#dom = {
      header: q('header'),
      title: q('h2'),
      description: q('.description'),
      viewport: q('.viewport'),
      canvas: q('.canvas'),
      decoration: q('.decoration'),
      treeScroll: q('.tree-scroll'),
      treeScrollSizer: q('.tree-scroll>div'),
      status: q('.status'),
      summary: q('.summary'),
      toolbarSlot: q<HTMLSlotElement>('slot[name="toolbar"]'),
      inspect: q<HTMLButtonElement>('.inspect'),
      zoomIn: q<HTMLButtonElement>('.zoom-in'),
      zoomOut: q<HTMLButtonElement>('.zoom-out'),
      reset: q<HTMLButtonElement>('.reset'),
      collapse: q<HTMLButtonElement>('.collapse'),
      data: q<HTMLButtonElement>('.data'),
      tooltip: q('.tooltip'),
      raw: q('.raw'),
      pagination: q('.pagination'),
      paginationLabel: q('.pagination span'),
      previous: q<HTMLButtonElement>('.previous'),
      next: q<HTMLButtonElement>('.next'),
      live: q('.live')
    };
  }
  get #tableElements(): DataTableElements {
    return {
      raw: this.#dom.raw,
      toggle: this.#dom.data,
      pagination: this.#dom.pagination,
      pageLabel: this.#dom.paginationLabel,
      previous: this.#dom.previous,
      next: this.#dom.next
    };
  }
  get document(): Doc | null {
    return this.#compiled ? structuredClone(this.#compiled.document) : null;
  }
  set document(value: unknown) {
    this.updateDocument(value);
  }
  /** Patch host UI while keeping the viewport, collapsed nodes and selection. */
  configure(options: EntityComponentOptions) {
    this.#ui = { ...this.#ui, ...parseComponentOptions(options, 'hierarchy') };
    this.#schedule();
  }
  updateDocument(value: unknown, options: DocumentUpdateOptions = {}) {
    object(options, 'options', ['preserveViewState']);
    if (options.preserveViewState !== undefined)
      boolean(options.preserveViewState, 'options.preserveViewState');
    const previous = options.preserveViewState ? this.viewState : null;
    this.#stateTransaction = true;
    this.#propertySet = true;
    this.#input?.cancel();
    this.#clearInspection();
    this.#collapsed.clear();
    this.#viewport.reset();
    this.#pendingViewport = null;
    this.#linkedHighlight = null;
    if (this.#runtime) this.#runtime.linkedHighlight = null;
    this.#page = 0;
    try {
      this.#compiled = this.compile(value);
      this.#error = null;
    } catch (error) {
      this.#compiled = null;
      this.#error = error instanceof Error ? error.message : 'Invalid document.';
    }
    if (previous && this.#compiled) this.#applyState(previous);
    this.#stateReason = 'document';
    this.#rebuild();
    this.#stateTransaction = false;
    this.#schedule();
  }
  get viewState(): HierarchyViewState {
    return {
      version: 1,
      kind: this.kind,
      pinnedKey:
        this.#pendingPin !== undefined
          ? this.#pendingPin
          : this.#runtime?.session.pinned
            ? (this.#runtime.session.active?.key ?? null)
            : null,
      viewport: { ...(this.#pendingViewport ?? this.viewport) },
      collapsed: this.collapsed.sort()
    };
  }
  set viewState(value: HierarchyViewState) {
    const state = parseViewState(value);
    if (state.kind === 'metric' || state.kind !== this.kind)
      throw new TypeError(`Expected ${this.kind} view state.`);
    this.#notifications.invalidate();
    this.#input?.cancel();
    this.#applyState(state);
    this.#stateReason = 'restore';
    this.#rebuild();
    this.refresh();
  }
  #applyState(state: HierarchyViewState) {
    this.#collapsed = new Set(
      state.collapsed.filter((id) => this.#compiled?.hierarchy.children.get(id)?.length)
    );
    this.#pendingPin = state.pinnedKey;
    this.#pendingViewport = { ...state.viewport };
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
    const state = this.viewState,
      key = JSON.stringify(state);
    if (key === this.#lastState) return;
    this.#lastState = key;
    this.#emit('scope-view-state-change', { state, reason } satisfies ViewStateChangeDetail);
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
    this.#repaint();
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
    this.#input?.cancel();
    this.#viewport.set(value);
    this.#pendingViewport = null;
    this.#changedViewport();
  }
  get collapsed(): string[] {
    return [...this.#collapsed];
  }
  set collapsed(value: Iterable<string>) {
    const values = new Set(value);
    for (const id of values)
      if (!this.#compiled?.hierarchy.byId.has(id)) throw new RangeError(`Unknown node: ${id}`);
    this.#collapsed = values;
    this.#input?.cancel();
    this.#rebuild();
    this.refresh();
    this.#emit('scope-collapse-change', { collapsed: this.collapsed });
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
    this.#input?.cancel();
    const tree = this.#compiled?.hierarchy;
    if (!tree?.byId.has(id)) throw new RangeError(`Unknown node: ${id}`);
    let parent = tree.byId.get(id)?.parentId,
      expanded = false;
    while (parent && tree.byId.has(parent)) {
      expanded = this.#collapsed.delete(parent) || expanded;
      parent = tree.byId.get(parent)?.parentId;
    }
    if (expanded) {
      this.#rebuild();
      this.#emit('scope-collapse-change', { collapsed: this.collapsed });
    }
    this.#runtime?.paint();
    const target = this.#view?.byId.get(id)?.interaction;
    if (!target || !this.#runtime || !this.#view?.interactive) return;
    this.#reveal(target);
    this.#runtime.session.inspect(target.key, options.pin ?? false, true);
    this.#runtime.focus(this.#runtime.session.active);
    this.#showInspection(null, true);
    this.#dom.canvas.focus({ preventScroll: true });
  }
  resetViewport() {
    this.#input?.cancel();
    this.#viewport.reset();
    this.#pendingViewport = null;
    this.#changedViewport();
  }
  get controls() {
    return visibleControls(this.#root, hierarchyControls, this.#options);
  }
  performAction(action: ScopeChartAction): boolean {
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
      const id = this.#runtime?.session.active?.sources[0]?.id;
      if (id) this.toggleNode(id);
    } else if (action === 'toggle-data') {
      this.#page = setDataTableOpen(
        this.#tableElements,
        this.#dom.raw.hidden,
        this.#ui.dataTable !== false,
        this.#page,
        () => this.#tableModel()
      );
    }
    this.#notifyControls();
    return true;
  }
  #notifyControls() {
    this.#controlEvents.notify(this, this.controls);
  }
  refresh() {
    if (this.#runtime) this.#runtime.refresh();
    else this.#schedule();
  }
  #repaint() {
    if (!this.isConnected) return;
    if (this.#runtime && !this.loading && this.error === null && this.#error === null)
      this.#runtime.refresh('paint');
    else if (!this.dataset.state) this.#schedule();
  }
  #rebuild() {
    this.#view = this.#compiled ? this.createView(this.#compiled, this.#collapsed) : null;
  }
  #emit<K extends keyof HierarchyEventDetails<Source, Context>>(
    type: K,
    detail: HierarchyEventDetails<Source, Context>[K]
  ) {
    this.#notifyControls();
    this.#dispatch(type, detail);
  }
  #dispatch<K extends keyof HierarchyEventDetails<Source, Context>>(
    type: K,
    detail: HierarchyEventDetails<Source, Context>[K]
  ) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
  #changedViewport() {
    if (
      !this.#runtime?.session.pinned &&
      !this.#runtime?.session.keyboardInspection &&
      !this.#pendingPin
    )
      this.#clearInspection();
    this.#runtime?.refresh('viewport');
    this.#emit('scope-viewport-change', { ...this.viewport });
    this.#stateChanged();
  }
  #schedule() {
    if (!this.isConnected || this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#render();
    });
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
    watchColorScheme(() => this.#repaint(), signal);
    const controlButtons = {
      inspect: this.#dom.inspect,
      'zoom-in': this.#dom.zoomIn,
      'zoom-out': this.#dom.zoomOut,
      'reset-view': this.#dom.reset,
      'toggle-collapse': this.#dom.collapse,
      'toggle-data': this.#dom.data
    } as const;
    for (const [action, button] of Object.entries(controlButtons))
      button.addEventListener('click', () => this.performAction(action as ScopeChartAction), {
        signal
      });
    this.#dom.toolbarSlot.addEventListener('slotchange', () => this.#schedule(), { signal });
    this.#dom.previous.addEventListener(
      'click',
      () => {
        this.#page--;
        this.#table();
      },
      { signal }
    );
    this.#dom.next.addEventListener(
      'click',
      () => {
        this.#page++;
        this.#table();
      },
      { signal }
    );
    this.#dom.treeScroll.addEventListener(
      'scroll',
      () => {
        const scrollOffset = this.#dom.treeScroll.scrollTop;
        if (Math.abs(scrollOffset - this.viewport.scrollOffset) < 0.5) return;
        this.#viewport.set({ ...this.viewport, scrollOffset });
        this.#changedViewport();
      },
      { signal }
    );
    this.#root.addEventListener(
      'keydown',
      (event) => {
        if ((event as KeyboardEvent).key === 'Escape' && this.#runtime?.session.active) {
          event.preventDefault();
          this.#clearInspection();
          this.#dom.canvas.focus({ preventScroll: true });
        }
      },
      { signal }
    );
    bindInspectionDismiss(
      this,
      this.#dom.tooltip,
      () => Boolean(this.#runtime?.session.pinned || this.#runtime?.session.keyboardInspection),
      (outside, event) => {
        if (
          outside
            ? this.#ui.dismissOnOutside !== false
            : !event.composedPath().includes(this.#dom.treeScroll)
        )
          this.#clearInspection();
      },
      (event) => {
        if (!event.composedPath().includes(this.#dom.treeScroll)) this.#placeTooltip();
      },
      signal
    );
    this.#mutation = observeDocumentScript(
      this,
      () => !this.#propertySet,
      (value) => {
        this.document = value;
        this.#propertySet = false;
      },
      (message) => {
        this.updateDocument(undefined);
        this.#error = message;
        this.#propertySet = false;
      }
    );
    this.#schedule();
  }
  disconnectedCallback() {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#mutation?.disconnect();
    this.#mutation = null;
    this.#events?.abort();
    this.#events = null;
    this.#lastStatusState = '';
    this.#lastStatusMessage = null;
    this.#lastSummary = '';
    this.#lastTreeHeight = '';
    this.#lastContentHeight = '';
    this.#lastRailTop = '';
    this.#lastRailBottom = '';
    this.#clearInspection();
    this.#dispose();
  }
  attributeChangedCallback(name: string) {
    if (!this.isConnected) return;
    if (name === 'loading' || name === 'error') this.#schedule();
    else this.#repaint();
  }
  #dispose() {
    this.#runtime?.dispose();
    this.#runtime = null;
    this.#renderedCompiled = null;
    this.#input?.dispose();
    this.#input = null;
  }
  #status(state: string, message: string | null) {
    if (state !== this.#lastStatusState || message !== this.#lastStatusMessage) {
      this.#lastStatusState = state;
      this.#lastStatusMessage = message;
      this.dataset.state = state;
      this.#dom.status.hidden = message === null;
      this.#dom.status.textContent = message;
      this.#dom.status.className = `status ${state}`;
      this.#dom.viewport.setAttribute('aria-busy', String(state === 'loading'));
    }
    this.#notifyControls();
  }
  #render() {
    const compiled = this.#compiled,
      view = this.#view;
    const title = compiled?.document.title ?? '',
      description = compiled?.document.description ?? '';
    this.#dom.header.hidden = this.#ui.header === false || (!title && !description);
    this.#dom.title.textContent = title;
    this.#dom.description.textContent = description;
    this.#dom.description.hidden = !description;
    renderToolbar(this.#root, this.#options, hierarchyControls);
    const padding = hierarchyPadding(this.#ui.axes ?? 'full');
    const contentHeight = `${(view?.rowCount ?? 0) * (view?.rowHeight ?? DEFAULT_ROW_HEIGHT) + padding.top + padding.bottom}px`;
    if (contentHeight !== this.#lastContentHeight) {
      this.#lastContentHeight = contentHeight;
      this.#dom.viewport.style.setProperty('--scope-chart-content-height', contentHeight);
    }
    const message = this.error ?? this.#error;
    const blocked = this.loading || message !== null || !compiled || !view?.items.length;
    for (const button of [
      this.#dom.inspect,
      this.#dom.zoomIn,
      this.#dom.zoomOut,
      this.#dom.reset,
      this.#dom.collapse,
      this.#dom.data
    ])
      if (button.disabled !== blocked) button.disabled = blocked;
    this.#table();
    if (blocked) {
      const saved = this.loading && compiled && message === null ? this.viewState : null;
      if (saved) this.#stateTransaction = true;
      this.#clearInspection();
      this.#dispose();
      if (saved) this.#applyState(saved);
      this.#stateTransaction = false;
      this.#dom.treeScroll.hidden = true;
      this.#dom.summary.hidden = true;
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
      const canvas = this.#dom.canvas;
      this.#input = new ViewportController(canvas, this.#viewport, {
        rect: () => this.scene?.rect,
        enabled: () => this.#view?.interactive !== false,
        onChange: () => this.#changedViewport()
      });
      this.#runtime = new ChartRuntime<Source>(canvas, this.#dom.decoration, {
        layout: (width, height, measure) => {
          const current = this.#view!;
          this.#viewport.configure({
            contentHeight: current.rowCount * current.rowHeight,
            visibleHeight: hierarchyViewportHeight(height, this.#ui.axes ?? 'full')
          });
          if (this.#pendingViewport) {
            this.#viewport.set(this.#pendingViewport);
            this.#pendingViewport = null;
          }
          const scene = layoutHierarchy(
            current,
            width,
            height,
            measure,
            this.viewport,
            this.#ui.axes ?? 'full'
          );
          this.#renderedCompiled = this.#compiled;
          return scene;
        },
        onNavigate: (target) => this.#reveal(target),
        inputConsumed: () => this.#input?.consumed ?? false,
        onInspect: (_value, position) => this.#showInspection(position, true),
        onError: (error) => {
          this.#error = error instanceof Error ? error.message : 'Chart rendering failed.';
          this.#schedule();
        },
        onRender: () => this.#rendered()
      });
      this.#runtime.linkedHighlight = this.#linkedHighlight;
    } else this.#runtime.refresh();
  }
  #rendered() {
    const scene = this.scene,
      view = this.#view,
      compiled = this.#renderedCompiled;
    if (!scene || !view || !compiled) return;
    if (this.#pendingPin !== undefined) {
      this.#runtime!.session.restorePin(scene.interactive === false ? null : this.#pendingPin);
      this.#pendingPin = undefined;
      this.#runtime!.focus(this.#runtime!.session.active);
    }
    const rail = this.#dom.treeScroll;
    if (scene.rect) {
      const top = `${scene.rect.y}px`;
      const bottom = `${Math.max(0, scene.height - scene.rect.y - scene.rect.height)}px`;
      if (top !== this.#lastRailTop) {
        this.#lastRailTop = top;
        rail.style.top = top;
      }
      if (bottom !== this.#lastRailBottom) {
        this.#lastRailBottom = bottom;
        rail.style.bottom = bottom;
      }
    }
    const railHidden =
      scene.interactive === false || view.rowCount * view.rowHeight <= scene.rect!.height;
    if (rail.hidden !== railHidden) rail.hidden = railHidden;
    const treeHeight = `${view.rowCount * view.rowHeight}px`;
    if (treeHeight !== this.#lastTreeHeight) {
      this.#lastTreeHeight = treeHeight;
      this.#dom.treeScrollSizer.style.height = treeHeight;
    }
    if (Math.abs(rail.scrollTop - this.viewport.scrollOffset) > 0.5)
      rail.scrollTop = this.viewport.scrollOffset;
    const controlsDisabled = scene.interactive === false;
    for (const button of [this.#dom.inspect, this.#dom.zoomIn, this.#dom.zoomOut, this.#dom.reset])
      if (button.disabled !== controlsDisabled) button.disabled = controlsDisabled;
    const dataDisabled = this.#ui.dataTable === false;
    if (this.#dom.data.disabled !== dataDisabled) this.#dom.data.disabled = dataDisabled;
    const summaryHidden = this.#ui.summary === false;
    if (this.#dom.summary.hidden !== summaryHidden) this.#dom.summary.hidden = summaryHidden;
    const coverage =
      this.kind === 'trace'
        ? ((compiled.document as EntityDocument & { coverage?: string }).coverage ?? 'unknown')
        : null;
    const summaryText = `${compiled.hierarchy.sources.length.toLocaleString('en-US')} nodes${coverage ? ` · ${coverage} trace coverage` : ''}${view.issues.length ? ` · ${view.issues.length} relationship warning${view.issues.length === 1 ? '' : 's'}` : ''}`;
    if (summaryText !== this.#lastSummary) {
      this.#lastSummary = summaryText;
      this.#dom.summary.textContent = summaryText;
    }
    this.#status('ready', null);
    if (compiled !== this.#compiled || !this.isConnected) return;
    this.#showInspection(null, false, this.#stateReason);
    if (compiled !== this.#compiled || !this.isConnected) return;
    this.#stateChanged(this.#stateReason);
    this.#stateReason = 'reconcile';
    this.#emit('scope-ready', {
      visualization: this.kind,
      nodes: compiled.hierarchy.sources.length
    });
  }
  #reveal(target: ChartInteraction<Source>) {
    const item = this.#view?.byId.get(target.sources[0]?.id);
    if (!item) return;
    const before = this.viewport;
    this.#viewport.reveal(
      item.start,
      item.end,
      item.row * this.#view!.rowHeight,
      (item.row + 1) * this.#view!.rowHeight
    );
    const after = this.viewport;
    if (
      before.start !== after.start ||
      before.end !== after.end ||
      before.scrollOffset !== after.scrollOffset
    ) {
      this.#runtime?.paint(undefined, 'viewport');
      this.#emit('scope-viewport-change', { ...after });
      this.#stateChanged();
    }
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
  #clearInspection() {
    this.#notifications.invalidate();
    this.#pendingPin = undefined;
    this.#runtime?.session.clearInspection();
    this.#runtime?.focus(null);
    this.#showInspection(null, false);
  }
  #showInspection(
    position: Position | null,
    emit: boolean,
    reason: ViewStateChangeDetail['reason'] = 'interaction'
  ) {
    const batch = this.#notifications.capture();
    const { target: active, pinned } = batch.state.inspect;
    const tooltip = this.#dom.tooltip;
    this.#dom.inspect.toggleAttribute('data-active', pinned);
    const id = active?.sources[0]?.id,
      children = id && this.#compiled?.hierarchy.children.get(id);
    this.#dom.collapse.disabled = !children?.length || this.#view?.interactive === false;
    this.#dom.collapse.textContent = id && this.#collapsed.has(id) ? 'Expand' : 'Collapse';
    if (children?.length)
      this.#dom.collapse.setAttribute('aria-expanded', String(!this.#collapsed.has(id!)));
    else this.#dom.collapse.removeAttribute('aria-expanded');
    this.#notifyControls();
    if (batch.current('inspect')) {
      if (!active) {
        hideInspection(tooltip);
        this.#dom.live.textContent = '';
      } else if ((pinned ? this.#ui.inspector : this.#ui.tooltip) === false) {
        hideInspection(tooltip);
        this.#dom.live.textContent = inspectionText(active);
      } else {
        dockInspection(tooltip, pinned);
        renderInspection(tooltip, active, pinned, () => {
          this.#clearInspection();
          this.#dom.canvas.focus({ preventScroll: true });
        });
        this.#placeTooltip(position);
        const reading = inspectionText(active);
        if (this.#dom.live.textContent !== reading) this.#dom.live.textContent = reading;
      }
    }
    if (!this.#stateTransaction) {
      for (const channel of ['inspect', 'select'] as const)
        batch.emit(
          channel,
          (value, snapshot) => this.#dispatch(`scope-${channel}`, this.#detail(value, snapshot)),
          { force: channel === 'inspect' && emit, before: () => this.#notifyControls() }
        );
    }
    this.#stateChanged(reason);
  }
  #placeTooltip(position: Position | null = null) {
    const active = this.#runtime?.session.active;
    if (!active || this.#dom.tooltip.hidden) return;
    const tooltip = this.#dom.tooltip;
    // Persistent details belong to this component's flow, never guessed free viewport space.
    if (this.#runtime?.session.pinned) return;
    const bounds = this.#dom.canvas.getBoundingClientRect();
    const anchor = position ??
      this.#runtime?.anchor(active) ?? {
        x: bounds.width / 2,
        y: hierarchyPadding(this.#ui.axes ?? 'full').top
      };
    positionInspection(tooltip, { x: bounds.left + anchor.x, y: bounds.top + anchor.y });
  }
  #tableModel(): DataTableModel | null {
    if (!this.#compiled) return null;
    const sources = this.#compiled.hierarchy.sources;
    const fields = [
      'id',
      'parentId',
      'name',
      ...(this.kind === 'trace'
        ? ['startTimeNs', 'endTimeNs', 'service', 'status']
        : ['selfWeight', 'file', 'line']),
      'attributes'
    ];
    return {
      caption: `${sources.length} supplied nodes. Original integer strings; absent fields shown as —.`,
      headers: fields,
      total: sources.length,
      rows: (start, end) =>
        sources.slice(start, end).map((source) =>
          fields.map((field) => {
            const value = (source as unknown as Record<string, unknown>)[field];
            return {
              text:
                value === undefined
                  ? '—'
                  : value === null
                    ? 'null'
                    : typeof value === 'object'
                      ? JSON.stringify(value)
                      : String(value)
            };
          })
        )
    };
  }
  #table() {
    this.#page = renderDataTable(
      this.#tableElements,
      this.#ui.dataTable !== false,
      this.#page,
      () => this.#tableModel()
    );
  }
}
