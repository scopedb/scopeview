import { object, boolean } from '../data/validation.js';
import {
  compileChart,
  type ChartDocument,
  type CompiledChart
} from '../families/metrics/document.js';
import type { ChartDisplayType } from '../families/metrics/spec.js';
import { compactFormat } from '../data/format.js';
import { prepareAggregateValues } from '../families/metrics/prepared.js';
import { legendReadings } from '../families/metrics/readings.js';
import type { ChartRenderer } from './plot-contract.js';
import type { ChartInteraction, Inspect, Position } from '../core/scene.js';
import { ChartSession } from '../core/session.js';
import {
  InspectionNotifications,
  type InspectionReading
} from '../core/inspection-notifications.js';
import type { ResultRow } from '../data/result.js';
import {
  metricInspectionContext,
  sourceRowIndices
} from '../families/metrics/inspection-context.js';
import { withInspectionContext, type MetricInspectionContext } from '../core/inspection-context.js';
import { inspectionText } from '../core/labels.js';
import type { RangeSelectionBinding } from '../core/range.js';
import {
  parseViewState,
  type MetricViewState,
  type DocumentUpdateOptions,
  type ViewStateChangeDetail
} from '../core/view-state.js';
import { parseLinkedHighlight, type LinkedHighlight } from '../core/link-group.js';
import { formatQuantity, type DataProvenance } from '../data/semantics.js';
import { SCOPE_CHART_STYLES } from '../theme/styles.js';
import {
  renderInspection,
  hideInspection,
  positionInspection,
  dockInspection
} from '../ui/inspection.js';
import { bindInspectionDismiss } from '../ui/inspection-floating.js';
import { node } from '../ui/dom.js';
import { inspectionDirection } from '../runtime/keyboard.js';
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
import { parseComponentOptions, type MetricComponentOptions } from './options.js';
import {
  metricControls,
  readControls,
  visibleControls,
  renderToolbar,
  ControlEvents,
  inspectionFocus,
  type ScopeChartAction
} from './controls.js';
import type { ScopeCommonEventDetails, ScopeEventListener, ScopeEventMap } from './events.js';

export interface ScopeInspectionDetail {
  /** Family discriminator shared with trace and profile inspection details. */
  kind: 'metric';
  key: string | null;
  pinned: boolean;
  series?: string | null;
  cursorTimeMs?: number | null;
  time?: { start: number; end?: number; partial?: boolean };
  rowIndices: number[];
  rows: (string | null)[][];
  provenance?: DataProvenance;
  context: MetricInspectionContext | null;
}
export interface ScopeChartReadyDetail {
  visualization: ChartDisplayType;
  rows: number;
}
export interface ScopeVisibilityChangeDetail {
  hidden: string[];
}
export interface ScopeChartEventDetails extends ScopeCommonEventDetails {
  'scope-ready': ScopeChartReadyDetail;
  'scope-inspect': ScopeInspectionDetail;
  'scope-select': ScopeInspectionDetail;
  'scope-visibility-change': ScopeVisibilityChangeDetail;
}
export type ScopeChartEventMap = ScopeEventMap<ScopeChartEventDetails>;

/** Browser-only entry point. Import the package root for SSR/data compilation. */
export class ScopeChartElement extends HTMLElement {
  static observedAttributes = ['loading', 'error', 'theme', 'style', 'class'];
  #compiled: CompiledChart | null = null;
  #renderedCompiled: CompiledChart | null = null;
  #ui: MetricComponentOptions = {};
  get #options() {
    return {
      ...this.#ui,
      interactive: this.#compiled?.interactive
    };
  }
  #error: string | null = null;
  #session = new ChartSession('compare');
  #plot: ChartRenderer | null = null;
  #frame = 0;
  #revision = 0;
  #rangeSelection: RangeSelectionBinding | null = null;
  #mutation: MutationObserver | null = null;
  #events: AbortController | null = null;
  #page = 0;
  #propertySet = false;
  #pendingPin: string | null | undefined;
  #notifications = new InspectionNotifications<ResultRow, CompiledChart>(() => ({
    snapshot: this.#renderedCompiled,
    inspect: {
      target: this.#session.active,
      series: this.#session.series,
      pinned: this.#session.pinned
    },
    select: { target: this.#session.selected, series: this.#session.selectedSeries }
  }));
  #stateReason: ViewStateChangeDetail['reason'] = 'reconcile';
  #lastState = '';
  #linkedHighlight: LinkedHighlight | null = null;
  #stateTransaction = false;
  #cursorTimeMs: number | null = null;
  #readingNeighbors: string[] = [];
  #selectedNeighbors: string[] = [];
  #updating = false;
  #root: ShadowRoot;
  #dom: {
    root: HTMLElement;
    header: HTMLElement;
    title: HTMLElement;
    description: HTMLElement;
    viewport: HTMLElement;
    canvas: HTMLElement;
    decoration: HTMLElement;
    metrics: HTMLElement;
    status: HTMLElement;
    legend: HTMLElement;
    toolbarSlot: HTMLSlotElement;
    inspect: HTMLButtonElement;
    data: HTMLButtonElement;
    restore: HTMLButtonElement;
    tooltip: HTMLElement;
    raw: HTMLElement;
    pagination: HTMLElement;
    paginationLabel: HTMLElement;
    previous: HTMLButtonElement;
    next: HTMLButtonElement;
    live: HTMLElement;
  };
  #appearance = new ElementTheme(this);
  #controlEvents = new ControlEvents();
  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    const css = node('style');
    css.textContent = SCOPE_CHART_STYLES;
    this.#root.append(css);
    const shell = node('section', 'root');
    shell.innerHTML = `<header hidden><h2></h2><p class="description" hidden></p></header>
      <div class="viewport" role="region" aria-label="ScopeDB chart" aria-describedby="help">
        <div class="canvas" aria-hidden="true"></div><div class="decoration" aria-hidden="true"></div>
        <div class="metrics" hidden></div><div class="status" role="status">Provide a chart document.</div>
      </div>
      <div class="legend" aria-label="Chart series"></div>
      <slot name="toolbar"><div class="toolbar"><button class="inspect" type="button" aria-describedby="help" disabled>Inspect chart</button><button class="data" type="button" aria-expanded="false" aria-controls="raw" disabled>View data</button><button class="restore" type="button" disabled>Show all</button><span class="attribution">ScopeDB</span></div></slot>
      <div class="tooltip" role="tooltip" hidden></div>
      <div class="raw" id="raw" hidden></div><div class="pagination" hidden><button type="button" class="previous">Previous</button><span></span><button type="button" class="next">Next</button></div>
      <p class="sr-only" id="help">Arrows inspect, Home/End jump, Enter/Space select, Escape dismisses. Hover to compare; Lock fixes the reading. Shift-click a legend item to isolate it. View data shows original values.</p>
      <span class="sr-only live" role="status" aria-live="polite" aria-atomic="true"></span>`;
    this.#root.append(shell);
    const q = <T extends HTMLElement = HTMLElement>(selector: string) =>
      this.#root.querySelector<T>(selector)!;
    this.#dom = {
      root: shell,
      header: q('header'),
      title: q('h2'),
      description: q('.description'),
      viewport: q('.viewport'),
      canvas: q('.canvas'),
      decoration: q('.decoration'),
      metrics: q('.metrics'),
      status: q('.status'),
      legend: q('.legend'),
      toolbarSlot: q<HTMLSlotElement>('slot[name="toolbar"]'),
      inspect: q<HTMLButtonElement>('.inspect'),
      data: q<HTMLButtonElement>('.data'),
      restore: q<HTMLButtonElement>('.restore'),
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
  get document(): ChartDocument | null {
    return this.#compiled ? structuredClone(this.#compiled.document) : null;
  }
  set document(value: unknown) {
    this.updateDocument(value);
  }
  /** Patch host UI without resetting the document or interaction state. */
  configure(options: MetricComponentOptions) {
    this.#ui = { ...this.#ui, ...parseComponentOptions(options, 'metric') };
    this.#buildLegend();
    this.#table();
    this.refresh();
  }
  /** Replace data explicitly; preservation requires compatible family-owned identities. */
  updateDocument(value: unknown, options: DocumentUpdateOptions = {}) {
    object(options, 'options', ['preserveViewState']);
    if (options.preserveViewState !== undefined)
      boolean(options.preserveViewState, 'options.preserveViewState');
    const previous = options.preserveViewState ? this.viewState : null;
    this.#stateTransaction = true;
    this.#propertySet = true;
    this.#clearInspection();
    this.#session.reset();
    this.#linkedHighlight = null;
    if (this.#plot) this.#plot.linkedHighlight = null;
    this.rangeSelection = null;
    this.#page = 0;
    try {
      this.#compiled = value === null ? null : compileChart(value);
      this.#error = null;
    } catch (error) {
      this.#compiled = null;
      this.#error = error instanceof Error ? error.message : 'Invalid chart document.';
    }
    if (previous && this.#compiled) this.#applyState(previous);
    this.#stateReason = 'document';
    this.#buildLegend();
    this.#legendState();
    this.#table();
    this.#stateTransaction = false;
    this.refresh();
  }
  get viewState(): MetricViewState {
    return {
      version: 1,
      kind: 'metric',
      pinnedKey:
        this.#pendingPin !== undefined ? this.#pendingPin : (this.#session.selected?.key ?? null),
      hiddenSeries: [...this.#session.hidden].sort()
    };
  }
  set viewState(value: MetricViewState) {
    const state = parseViewState(value);
    if (state.kind !== 'metric') throw new TypeError('A metric chart needs metric view state.');
    this.#notifications.invalidate();
    this.#applyState(state);
    this.#stateReason = 'restore';
    this.#legendState();
    this.refresh();
  }
  /** Explicit reading lock, independent of persistent selection and portable view state. */
  get tooltipLocked(): boolean {
    return this.#session.tooltipLocked;
  }
  set tooltipLocked(value: boolean) {
    this.#session.lockTooltip(value);
    this.#showInspection(null, false, false);
  }
  #applyState(state: MetricViewState) {
    const names = new Set(this.#compiled?.series.map((series) => series.name));
    this.#session.setHidden(state.hiddenSeries.filter((name) => names.has(name)));
    this.#pendingPin = state.pinnedKey;
  }
  get linkedHighlight() {
    return this.#linkedHighlight && { ...this.#linkedHighlight };
  }
  set linkedHighlight(value: LinkedHighlight | null) {
    this.#linkedHighlight = parseLinkedHighlight(value);
    if (this.#plot) this.#plot.linkedHighlight = this.#linkedHighlight;
  }
  #stateChanged(reason: ViewStateChangeDetail['reason'] = 'interaction') {
    if (this.#stateTransaction) return;
    const state = this.viewState,
      key = JSON.stringify(state);
    if (key === this.#lastState) return;
    this.#lastState = key;
    this.#emit('scope-view-state-change', { state, reason } satisfies ViewStateChangeDetail);
  }
  /** Ephemeral trusted binding; never serialized into a chart document. */
  set rangeSelection(binding: RangeSelectionBinding | null) {
    if (this.#plot) this.#plot.rangeSelection = binding;
    this.#rangeSelection = binding;
  }
  get rangeSelection() {
    return this.#rangeSelection;
  }
  get loading() {
    return this.hasAttribute('loading');
  }
  set loading(value: boolean) {
    this.toggleAttribute('loading', value);
  }
  /** Host-supplied error message, reflected to the `error` attribute. Set null to clear it. */
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
  addEventListener<K extends keyof ScopeChartEventMap>(
    type: K,
    listener: ScopeEventListener<ScopeChartElement, ScopeChartEventMap[K]>,
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
  removeEventListener<K extends keyof ScopeChartEventMap>(
    type: K,
    listener: ScopeEventListener<ScopeChartElement, ScopeChartEventMap[K]>,
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
  get controls() {
    return visibleControls(this.#root, metricControls, this.#options);
  }
  /** Return false for unavailable actions. Host toolbars use the same operations as built-in controls. */
  performAction(action: ScopeChartAction): boolean {
    if (
      !readControls(this.#root, metricControls, this.#options).some(
        (control) => control.action === action && !control.disabled
      )
    )
      return false;
    if (action === 'inspect') {
      if (!this.#session.active) {
        const value = this.#session.next('Home');
        if (value) this.#inspect(value, null, false, true);
      }
      inspectionFocus(this.#root).focus({ preventScroll: true });
    } else if (action === 'toggle-data') {
      this.#page = setDataTableOpen(
        this.#tableElements,
        this.#dom.raw.hidden,
        this.#ui.dataTable !== false,
        this.#page,
        () => this.#tableModel()
      );
    } else if (action === 'show-all') {
      this.#session.showAll();
      this.#visibility();
    }
    this.#notifyControls();
    return true;
  }
  #notifyControls() {
    this.#controlEvents.notify(this, this.controls);
  }
  connectedCallback() {
    upgradeProperties(this, [
      'document',
      'loading',
      'error',
      'theme',
      'viewState',
      'linkedHighlight',
      'tooltipLocked'
    ]);
    this.#events?.abort();
    this.#events = new AbortController();
    const signal = this.#events.signal;
    watchColorScheme(() => this.#repaint(), signal);
    const controlButtons = {
      inspect: this.#dom.inspect,
      'toggle-data': this.#dom.data,
      'show-all': this.#dom.restore
    } as const;
    for (const [action, button] of Object.entries(controlButtons))
      button.addEventListener('click', () => this.performAction(action as ScopeChartAction), {
        signal
      });
    this.#dom.toolbarSlot.addEventListener('slotchange', () => this.refresh(), { signal });
    this.#dom.viewport.addEventListener(
      'keydown',
      (event) => this.#keyboard(event as KeyboardEvent),
      { signal }
    );
    this.#dom.inspect.addEventListener(
      'keydown',
      (event) => this.#keyboard(event as KeyboardEvent),
      { signal }
    );
    this.#root.addEventListener(
      'keydown',
      (event) => {
        if ((event as KeyboardEvent).key === 'Escape' && this.#session.active) {
          event.preventDefault();
          this.#clearInspection();
          inspectionFocus(this.#root).focus();
        }
      },
      { signal }
    );
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
    bindInspectionDismiss(
      this,
      this.#dom.tooltip,
      () => this.#session.pinned || this.#session.keyboardInspection,
      (outside) => {
        if (!outside || this.#ui.dismissOnOutside !== false) this.#clearInspection();
      },
      () => this.#placeTooltip(),
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
        this.document = undefined;
        this.#error = message;
        this.#propertySet = false;
      }
    );
    this.refresh();
  }
  disconnectedCallback() {
    this.#revision++;
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#mutation?.disconnect();
    this.#events?.abort();
    this.#clearInspection();
    this.#dispose();
  }
  attributeChangedCallback(name: string) {
    if (!this.isConnected) return;
    if (name === 'loading' || name === 'error') this.refresh();
    else this.#repaint();
  }
  #repaint() {
    if (!this.isConnected) return;
    if (this.#plot?.model && !this.loading && !(this.getAttribute('error') ?? this.#error)) {
      if (this.#plot.refresh) this.#plot.refresh('paint');
      else this.refresh();
    } else if (!this.hasAttribute('data-state')) this.refresh();
  }
  /** Repaint after inherited design tokens or font availability changes. */
  refresh() {
    this.#revision++;
    if (!this.isConnected || this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      void this.#render(this.#revision);
    });
  }
  #emit<K extends keyof ScopeChartEventDetails>(name: K, detail: ScopeChartEventDetails[K]) {
    this.#notifyControls();
    this.#dispatch(name, detail);
  }
  #dispatch<K extends keyof ScopeChartEventDetails>(name: K, detail: ScopeChartEventDetails[K]) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  #reportInspection(
    batch: ReturnType<InspectionNotifications<ResultRow, CompiledChart>['capture']>,
    force = false
  ) {
    if (this.#stateTransaction) return;
    const cursorTimeMs = this.#cursorTimeMs;
    for (const channel of ['inspect', 'select'] as const)
      batch.emit(
        channel,
        (value, snapshot) =>
          this.#dispatch(`scope-${channel}`, this.#inspectionDetail(value, snapshot, cursorTimeMs)),
        { force: channel === 'inspect' && force, before: () => this.#notifyControls() }
      );
  }
  #status(state: string, message: string | null) {
    this.setAttribute('data-state', state);
    this.#dom.viewport.setAttribute('aria-busy', String(state === 'loading'));
    const status = this.#dom.status;
    status.hidden = message === null;
    status.className = `status ${state}`;
    status.textContent = message;
    status.setAttribute('role', state === 'error' ? 'alert' : 'status');
    this.#notifyControls();
  }
  #dispose() {
    this.#plot?.dispose();
    this.#plot = null;
    this.#renderedCompiled = null;
    this.#session.setModel(null);
  }
  /** Load the browser renderer only when a plotted chart is needed. */
  protected async renderer() {
    const { Plot } = await import('./plot.js');
    return (
      canvas: HTMLElement,
      decoration: HTMLElement,
      inspect: Inspect,
      session?: ChartSession,
      onRender?: () => void
    ): ChartRenderer =>
      new Plot(canvas, decoration, inspect, () => this.refresh(), session, onRender);
  }
  async #render(revision: number) {
    const compiled = this.#compiled;
    const miniature = compiled?.document.options?.presentation === 'sparkline';
    const interactive = compiled?.interactive ?? !miniature;
    renderToolbar(this.#root, this.#options, metricControls, !interactive);
    this.#dom.root.setAttribute('aria-hidden', String(!interactive));
    this.#dom.viewport.tabIndex =
      interactive && inspectionFocus(this.#root) === this.#dom.viewport && !this.#rangeSelection
        ? 0
        : -1;
    this.#dom.canvas.style.pointerEvents = interactive ? '' : 'none';
    const title = compiled?.document.title ?? '',
      description = compiled?.document.description ?? '';
    this.#dom.header.hidden = miniature || this.#ui.header === false || (!title && !description);
    this.#dom.title.textContent = title;
    this.#dom.title.hidden = !title;
    this.#dom.description.textContent = description;
    this.#dom.description.hidden = !description;
    this.#dom.data.disabled = !compiled || this.#ui.dataTable === false;
    this.#dom.metrics.hidden = true;
    const error = this.getAttribute('error') ?? this.#error;
    const knownTimeFrame =
      compiled?.axisModel?.kind === 'time-series' && !!compiled.axisModel.window;
    if (error || this.loading || !compiled || (!compiled.series.length && !knownTimeFrame)) {
      const saved = this.loading && compiled && !error ? this.viewState : null;
      if (saved) this.#stateTransaction = true;
      this.#dom.inspect.disabled = true;
      this.#clearInspection();
      this.#dispose();
      if (saved) this.#applyState(saved);
      this.#stateTransaction = false;
      if (!compiled || error) this.#pendingPin = undefined;
      this.#stateChanged(this.#stateReason);
      if (error) {
        this.#status('error', error);
        this.#emit('scope-error', { message: error });
      } else if (this.loading) this.#status('loading', 'Loading chart…');
      else
        this.#status(
          'empty',
          compiled
            ? 'No plottable data. View data to inspect the returned values.'
            : 'Provide a chart document.'
        );
      return;
    }
    try {
      if (compiled.config.mapping.kind === 'aggregate') {
        this.#dom.inspect.disabled = true;
        this.#clearInspection(this.#stateReason);
        this.#dispose();
        const metrics = this.#dom.metrics;
        metrics.replaceChildren();
        metrics.hidden = false;
        for (const value of prepareAggregateValues(compiled.dataset, compiled.config.mapping)) {
          const metric = node('div', 'metric');
          const column = compiled.dataset.columns.find((c) => c.id === value.id)!;
          const display = compiled.displays.get(value.id);
          const raw = compiled.document.data.rows[0][column.columnIndex];
          const compact =
              value.value === null || display
                ? formatQuantity(raw, display)
                : compactFormat(value.value),
            exact = formatQuantity(raw, display);
          metric.append(
            node('div', 'metric-label', value.label),
            node('div', 'metric-value', compact)
          );
          if (compact !== exact) metric.append(node('div', 'metric-exact', exact));
          metrics.append(metric);
        }
      } else {
        if (!this.#plot) {
          this.#status('loading', 'Loading chart…');
          const create = await this.renderer();
          if (revision !== this.#revision || !this.isConnected) return;
          this.#plot = create(
            this.#dom.canvas,
            this.#dom.decoration,
            (value, position, pin, series, neighbors) =>
              this.#inspect(value, position, pin, false, series, neighbors),
            this.#session,
            () => {
              if (!this.#updating && this.#session.active) this.#placeTooltip();
            }
          );
        }
        this.#plot.linkedHighlight = this.#linkedHighlight;
        this.#updating = true;
        try {
          this.#plot.update(compiled, this.#session.hidden, this.#ui.axes ?? 'full');
        } finally {
          this.#updating = false;
        }
        this.#renderedCompiled = compiled;
        this.#plot.rangeSelection = this.#rangeSelection;
        this.#session.setModel(this.#plot.model);
        if (this.#pendingPin !== undefined) {
          this.#session.restorePin(interactive ? this.#pendingPin : null);
          this.#pendingPin = undefined;
        }
        if (this.#session.active) {
          this.#showInspection(null);
        } else {
          this.#plot.focus(null);
          hideInspection(this.#dom.tooltip);
          this.#dom.inspect.removeAttribute('data-active');
        }
        this.#dom.viewport.setAttribute(
          'aria-label',
          title || this.#plot.model?.ariaLabel || 'ScopeDB chart'
        );
        this.#dom.inspect.disabled = !interactive || !this.#plot.model?.interactions.length;
      }
      const batch = this.#notifications.capture();
      this.#status('ready', null);
      this.#reportInspection(batch);
      if (compiled !== this.#compiled || !this.isConnected) return;
      this.#stateChanged(this.#stateReason);
      this.#stateReason = 'reconcile';
      this.#emit('scope-ready', {
        visualization: compiled.config.displayType,
        rows: compiled.dataset.rows.length
      });
    } catch (error) {
      this.#dom.inspect.disabled = true;
      this.#clearInspection();
      this.#dispose();
      const message = error instanceof Error ? error.message : 'Chart rendering failed.';
      this.#status('error', message);
      this.#emit('scope-error', { message });
    }
  }
  #buildLegend() {
    const legend = this.#dom.legend;
    legend.replaceChildren();
    const compiled = this.#compiled;
    const option = this.#ui.legend;
    const columns = typeof option === 'object' ? option.columns : [];
    legend.toggleAttribute('data-columns', columns.length > 0);
    legend.style.setProperty('--legend-columns', String(columns.length));
    legend.setAttribute(
      'aria-label',
      columns.length ? 'Series summaries of returned observations' : 'Series'
    );
    legend.hidden =
      !compiled ||
      this.#ui.legend === false ||
      this.#options.interactive === false ||
      compiled.series.length < (columns.length ? 1 : 2) ||
      compiled.config.mapping.kind === 'aggregate';
    const readings = compiled ? legendReadings(compiled, columns) : new Map<string, string[]>();
    if (columns.length) {
      const header = node('div', 'legend-head');
      header.append(node('span', '', 'Series'));
      for (const column of columns)
        header.append(node('span', '', column[0].toUpperCase() + column.slice(1)));
      legend.append(header);
    }
    for (const series of compiled?.series ?? []) {
      const button = node('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', 'true');
      button.setAttribute(
        'aria-label',
        [
          series.name,
          ...columns.map((column, i) => `${column}: ${readings.get(series.name)?.[i] ?? '—'}`)
        ].join(', ')
      );
      button.style.setProperty(
        '--series-color',
        compiled?.config.displayType === 'line' ? (series.lineColor ?? series.color) : series.color
      );
      const name = node('span', 'legend-series');
      name.append(node('span', 'swatch'), node('span', 'name', series.name));
      button.append(name);
      for (const value of readings.get(series.name) ?? [])
        button.append(node('span', 'legend-value', value));
      button.addEventListener('click', (event) => {
        this.#session.toggleSeries(
          series.name,
          compiled!.series.map((value) => value.name),
          event.shiftKey
        );
        this.#visibility();
      });
      legend.append(button);
    }
    this.#dom.restore.disabled = true;
  }
  #visibility() {
    this.#legendState();
    this.#clearInspection();
    this.refresh();
    this.#emit('scope-visibility-change', { hidden: [...this.#session.hidden] });
    this.#stateChanged();
  }
  #legendState() {
    const buttons = this.#dom.legend.querySelectorAll('button');
    const hidden = this.#session.hidden;
    this.#compiled?.series.forEach((series, i) => {
      buttons[i]?.setAttribute('aria-pressed', String(!hidden.has(series.name)));
    });
    this.#dom.restore.disabled = !this.#session.hidden.size || this.#options.interactive === false;
    this.#notifyControls();
  }
  #inspectionDetail(
    reading: InspectionReading<ResultRow>,
    compiled: CompiledChart | null,
    cursorTimeMs: number | null
  ): ScopeInspectionDetail {
    const { target: value, series = null, pinned = false } = reading;
    const sources = value?.sources ?? [];
    const time = value ? this.#plot?.model?.interactionByKey.get(value.key)?.time : undefined;
    return withInspectionContext(
      {
        kind: 'metric',
        key: value?.key ?? null,
        pinned,
        series: value ? series : null,
        cursorTimeMs,
        ...(time ? { time: { ...time } } : {}),
        rows: sources.map((row) => [...row]),
        rowIndices: sourceRowIndices(compiled, sources),
        ...(compiled?.document.semantics?.provenance
          ? { provenance: structuredClone(compiled.document.semantics.provenance) }
          : {})
      },
      () => (compiled ? metricInspectionContext(compiled, value, series) : null)
    );
  }
  #clearInspection(reason: ViewStateChangeDetail['reason'] = 'interaction') {
    this.#notifications.invalidate();
    this.#pendingPin = undefined;
    this.#cursorTimeMs = null;
    this.#readingNeighbors = [];
    this.#selectedNeighbors = [];
    this.#session.clearInspection();
    const batch = this.#notifications.capture();
    this.#plot?.focus(null);
    this.#dom.inspect.removeAttribute('data-active');
    hideInspection(this.#dom.tooltip);
    this.#dom.live.textContent = '';
    this.#reportInspection(batch);
    this.#stateChanged(reason);
  }
  #inspect(
    value: ChartInteraction | null,
    position: Position | null,
    pin: boolean,
    keyboard = false,
    series: string | null = null,
    neighbors?: readonly ChartInteraction[]
  ) {
    const previousKey = this.#session.active?.key;
    if (!this.#session.inspect(value?.key ?? null, pin, keyboard, series)) return;
    this.#readingNeighbors = keyboard ? [] : (neighbors?.map((target) => target.key) ?? []);
    if (pin || keyboard)
      this.#selectedNeighbors = this.#session.selected ? this.#readingNeighbors : [];
    this.#cursorTimeMs = value
      ? (this.#plot?.model?.interactionByKey.get(value.key)?.time?.start ?? null)
      : null;
    if (!value) position = null;
    value = this.#session.active;
    if (!value) {
      this.#clearInspection();
      return;
    }
    const batch = this.#notifications.capture();
    if (pin)
      inspectionFocus(this.#root).focus({
        preventScroll: true
      });
    if (batch.current('inspect'))
      this.#showInspection(position, keyboard, position !== null || previousKey !== value.key);
    this.#reportInspection(batch, true);
    this.#stateChanged();
  }
  #showInspection(position: Position | null, keyboard = false, place = true) {
    const value = this.#session.active;
    if (!value) return;
    this.#plot?.focus(
      value,
      this.#session.pinned,
      this.#session.series,
      this.#session.selected?.key ?? null
    );
    this.#dom.inspect.toggleAttribute('data-active', this.#session.selected !== null);
    const tooltip = this.#dom.tooltip;
    if (this.#ui.tooltip === false) {
      hideInspection(tooltip);
      if (keyboard) this.#dom.live.textContent = inspectionText(value);
      return;
    }
    const neighbors = (
      this.#session.pinned || this.#session.tooltipLocked
        ? this.#selectedNeighbors
        : this.#readingNeighbors
    ).flatMap((key) => {
      const target = this.#plot?.model?.interactionByKey.get(key);
      return target ? [target] : [];
    });
    dockInspection(tooltip, this.#session.pinned && neighbors.length > 1);
    renderInspection(
      tooltip,
      value,
      this.#session.pinned,
      () => {
        this.#clearInspection();
        inspectionFocus(this.#root).focus();
      },
      {
        series: this.#session.series,
        locked: this.#session.tooltipLocked,
        onLock: () => {
          this.tooltipLocked = !this.tooltipLocked;
        },
        neighbors,
        onChoose: (key) => this.#chooseObservation(key, neighbors)
      }
    );
    if (place || keyboard) this.#placeTooltip(position);
    if (keyboard) this.#dom.live.textContent = inspectionText(value);
  }
  #chooseObservation(key: string, neighbors: readonly ChartInteraction[]) {
    if (key === this.#session.selected?.key) return;
    const target = this.#plot?.model?.interactionByKey.get(key);
    if (!target) return;
    this.#inspect(target, null, true, false, null, neighbors);
    [...this.#dom.tooltip.querySelectorAll<HTMLButtonElement>('.tooltip-observation')]
      .find((button) => button.dataset.key === key)
      ?.focus({ preventScroll: true });
  }
  #placeTooltip(position: Position | null = null) {
    if (!this.#session.active || this.#dom.tooltip.hidden) return;
    const tooltip = this.#dom.tooltip;
    if (tooltip.classList.contains('docked')) return;
    const anchor = position ?? this.#plot?.anchor(this.#session.active!) ?? { x: 0, y: 0 };
    const canvas = this.#dom.canvas.getBoundingClientRect();
    const rect = this.#plot?.model?.rect;
    positionInspection(
      tooltip,
      { x: canvas.left + anchor.x, y: canvas.top + anchor.y },
      rect && (this.#session.pinned || this.#session.tooltipLocked)
        ? {
            x: canvas.left + rect.x,
            y: canvas.top + rect.y,
            width: rect.width,
            height: rect.height
          }
        : undefined
    );
  }
  #keyboard(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey || this.#plot?.model?.interactive === false)
      return;
    const direction = inspectionDirection(event.key);
    const target = direction
      ? this.#session.next(direction)
      : event.key === 'Enter' || event.key === ' '
        ? (this.#session.active ?? this.#session.next('Home'))
        : undefined;
    if (target === undefined) return;
    event.preventDefault();
    if (target) this.#inspect(target, null, !direction && this.#session.active !== null, true);
  }
  #tableModel(): DataTableModel | null {
    const data = this.#compiled?.document.data;
    if (!data) return null;
    return {
      caption: `${data.rows.length} ${this.#compiled?.document.semantics?.provenance?.kind === 'bins' ? 'derived bins' : 'returned rows'}. Raw values; NULL is shown explicitly.`,
      headers: data.fields.map((field) => field.name),
      total: data.rows.length,
      rows: (start, end) =>
        data.rows
          .slice(start, end)
          .map((values) =>
            values.map((value) =>
              value === null
                ? { text: 'NULL', ariaLabel: 'SQL NULL' }
                : value === ''
                  ? { text: '', ariaLabel: 'Empty string' }
                  : { text: value }
            )
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

export function defineScopeChart() {
  if (!customElements.get('scope-chart')) customElements.define('scope-chart', ScopeChartElement);
}
declare global {
  interface HTMLElementTagNameMap {
    'scope-chart': ScopeChartElement;
  }
}
