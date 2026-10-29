import { captureScene, sceneSnapshot } from '../core/scene-snapshot.js';
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
import {
  channel,
  interactionFor,
  readingPhase,
  viewStatePhase,
  readyPhase
} from '../core/interaction.js';
import {
  restoredKey,
  restoreReading,
  shareReading,
  releaseReading
} from '../core/reading-state.js';
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
import { node } from '../ui/dom.js';
import {
  upgradeProperties,
  documentMutated,
  ElementTheme,
  watchColorScheme,
  type ScopeTheme
} from './lifecycle.js';
import {
  parseComponentOptions,
  type MetricComponentOptions
} from '../families/component-options.js';
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
  get #renderedCompiled() {
    return sceneSnapshot(this.#plot?.model) as CompiledChart | null;
  }
  #ui: MetricComponentOptions = {};
  get #options() {
    return {
      ...this.#ui,
      interactive:
        this.#compiled?.document.options?.interactive ??
        this.#compiled?.document.options?.presentation !== 'sparkline'
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
  #notifications = new InspectionNotifications<ResultRow, CompiledChart>(
    () => ({
      snapshot: this.#renderedCompiled,
      inspect: {
        target: this.#session.active,
        series: this.#session.series,
        pinned: this.#session.pinned
      },
      select: { target: this.#session.selected, series: this.#session.selectedSeries }
    }),
    interactionFor(this.#session)
  );
  #visibilityReports = channel<string[]>([], (a, b) => JSON.stringify(a) === JSON.stringify(b));
  #readingEffect = {};
  #stateReason: ViewStateChangeDetail['reason'] = 'reconcile';
  #stateReports = channel<ViewStateChangeDetail | null>(
    null,
    (a, b) => JSON.stringify(a?.state) === JSON.stringify(b?.state),
    viewStatePhase
  );
  #linkedHighlight: LinkedHighlight | null = null;
  #stateTransaction = false;
  #cursorTimeMs: number | null = null;
  #readingNeighbors: string[] = [];
  #selectedNeighbors: string[] = [];
  #root: ShadowRoot;
  #appearance = new ElementTheme(this);
  #controlEvents = new ControlEvents(interactionFor(this.#session));
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
  }
  #el<T extends HTMLElement = HTMLElement>(selector: string) {
    return this.#root.querySelector<T>(selector)!;
  }
  get document(): ChartDocument | null {
    return this.#compiled ? structuredClone(this.#compiled.document) : null;
  }
  set document(value: unknown) {
    this.updateDocument(value);
  }
  /** Patch host UI without resetting the document or interaction state. */
  configure(options: MetricComponentOptions) {
    interactionFor(this.#session).batch(() => {
      this.#ui = { ...this.#ui, ...parseComponentOptions(options, 'metric') };
      this.#buildLegend();
      this.#table();
      this.refresh();
    });
  }
  /** Replace data explicitly; preservation requires compatible family-owned identities. */
  updateDocument(value: unknown, options: DocumentUpdateOptions = {}) {
    interactionFor(this.#session).batch(() => {
      object(options, 'options', ['preserveViewState']);
      if (options.preserveViewState !== undefined)
        boolean(options.preserveViewState, 'options.preserveViewState');
      const previous = options.preserveViewState ? this.viewState : null;
      this.#stateTransaction = true;
      this.#propertySet = true;
      this.#clearInspection();
      this.#session.reset();
      this.#linkedHighlight = null;
      this.#rangeSelection = null;
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
      const revision = this.#revision,
        plot = this.#plot;
      if (plot)
        interactionFor(this.#session).effect(
          () => {
            plot.linkedHighlight = null;
            if (revision === this.#revision && plot === this.#plot)
              plot.rangeSelection = this.#rangeSelection;
          },
          plot,
          0,
          () => revision === this.#revision && plot === this.#plot
        );
    });
  }
  get viewState(): MetricViewState {
    return {
      version: 1,
      kind: 'metric',
      pinnedKey:
        restoredKey(this.#session) !== undefined
          ? restoredKey(this.#session)!
          : (this.#session.selected?.key ?? null),
      hiddenSeries: [...this.#session.hidden].sort()
    };
  }
  set viewState(value: MetricViewState) {
    interactionFor(this.#session).batch(() => {
      const state = parseViewState(value);
      if (state.kind !== 'metric') throw new TypeError('A metric chart needs metric view state.');
      this.#notifications.invalidate();
      this.#applyState(state);
      this.#stateReason = 'restore';
      this.#legendState();
      this.refresh();
    });
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
    restoreReading(this.#session, state.pinnedKey);
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
    const state = this.viewState;
    const snapshot = this.#compiled;
    const key = JSON.stringify(state);
    this.#notifyControls();
    interactionFor(this.#session).report(
      this.#stateReports,
      { state, reason },
      () => snapshot === this.#compiled && key === JSON.stringify(this.viewState),
      (detail) => {
        this.#dispatch('scope-view-state-change', detail!);
      }
    );
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
      if (!this.#session.active) this.#step('Home');
      inspectionFocus(this.#root).focus({ preventScroll: true });
    } else if (action === 'toggle-data') {
      const raw = this.#el('.raw');
      raw.hidden = !raw.hidden;
      this.#el('.data').setAttribute('aria-expanded', String(!raw.hidden));
      this.#el('.data').textContent = raw.hidden ? 'View data' : 'Hide data';
      this.#table();
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
    watchColorScheme(() => this.refresh(), signal);
    for (const [action, selector] of Object.entries(metricControls))
      this.#el(selector).addEventListener(
        'click',
        () => this.performAction(action as ScopeChartAction),
        { signal }
      );
    this.#el('slot[name="toolbar"]').addEventListener('slotchange', () => this.refresh(), {
      signal
    });
    this.#el('.viewport').addEventListener(
      'keydown',
      (event) => this.#keyboard(event as KeyboardEvent),
      { signal }
    );
    this.#el('.inspect').addEventListener(
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
    this.#el('.previous').addEventListener(
      'click',
      () => {
        this.#page--;
        this.#table();
      },
      { signal }
    );
    this.#el('.next').addEventListener(
      'click',
      () => {
        this.#page++;
        this.#table();
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
        if (event.composedPath().includes(this.#el('.tooltip'))) return;
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
    this.refresh();
  }
  disconnectedCallback() {
    interactionFor(this.#session).batch(() => {
      this.#revision++;
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      this.#mutation?.disconnect();
      this.#events?.abort();
      this.#clearInspection();
      this.#dispose();
    });
  }
  attributeChangedCallback() {
    this.refresh();
  }
  /** Repaint after inherited design tokens or font availability changes. */
  refresh() {
    this.#revision++;
    if (!this.isConnected || this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      interactionFor(this.#session).batch(() => {
        void this.#render(this.#revision);
      });
    });
  }
  #readJSON() {
    const script = this.querySelector<HTMLScriptElement>(
      ':scope > script[type="application/json"]'
    );
    if (!script) return;
    try {
      this.document = JSON.parse(script.textContent ?? '');
    } catch {
      this.document = undefined;
      this.#error = 'Invalid JSON. Check the chart document syntax.';
    }
    this.#propertySet = false;
  }
  #emit<K extends keyof ScopeChartEventDetails>(name: K, detail: ScopeChartEventDetails[K]) {
    const snapshot = this.#compiled;
    const scene = this.#plot?.model;
    this.#notifyControls();
    if (name === 'scope-visibility-change') {
      const value = (detail as { hidden: string[] }).hidden;
      interactionFor(this.#session).report(
        this.#visibilityReports,
        value,
        () =>
          snapshot === this.#compiled &&
          JSON.stringify(value) === JSON.stringify([...this.#session.hidden]),
        (hidden) => this.#dispatch('scope-visibility-change', { hidden: [...hidden] })
      );
      return;
    }
    interactionFor(this.#session).effect(
      () => {
        if (
          snapshot === this.#compiled &&
          (name !== 'scope-ready' ||
            (snapshot &&
              this.isConnected &&
              !this.loading &&
              !this.error &&
              !this.#error &&
              scene === this.#plot?.model &&
              (snapshot.config.mapping.kind === 'aggregate' || sceneSnapshot(scene) === snapshot)))
        )
          this.#dispatch(name, detail);
      },
      {},
      name === 'scope-ready' ? readyPhase : readingPhase
    );
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
        channel === 'inspect' && force
      );
  }
  #status(state: string, message: string | null) {
    this.setAttribute('data-state', state);
    this.#el('.viewport').setAttribute('aria-busy', String(state === 'loading'));
    const status = this.#el('.status');
    status.hidden = message === null;
    status.className = `status ${state}`;
    status.textContent = message;
    status.setAttribute('role', state === 'error' ? 'alert' : 'status');
    this.#notifyControls();
  }
  #dispose() {
    const plot = this.#plot;
    this.#plot = null;
    if (plot && 'session' in plot && plot.session && typeof plot.session === 'object')
      releaseReading(plot.session);
    this.#session.setModel(null);
    interactionFor(this.#session).effect(() => plot?.dispose());
  }
  /** Load the browser renderer only when a plotted chart is needed. */
  protected async renderer() {
    const { Plot } = await import('./plot.js');
    return (canvas: HTMLElement, decoration: HTMLElement, inspect: Inspect): ChartRenderer =>
      new Plot(canvas, decoration, inspect, () => this.refresh());
  }
  async #render(revision: number) {
    const compiled = this.#compiled;
    const miniature = compiled?.document.options?.presentation === 'sparkline';
    const interactive = compiled?.document.options?.interactive ?? !miniature;
    renderToolbar(this.#root, this.#options, metricControls, !interactive);
    this.#el('.root').setAttribute('aria-hidden', String(!interactive));
    this.#el('.viewport').tabIndex =
      interactive && inspectionFocus(this.#root) === this.#el('.viewport') && !this.#rangeSelection
        ? 0
        : -1;
    this.#el('.canvas').style.pointerEvents = interactive ? '' : 'none';
    const title = compiled?.document.title ?? '',
      description = compiled?.document.description ?? '';
    this.#el('header').hidden = miniature || this.#ui.header === false || (!title && !description);
    this.#el('h2').textContent = title;
    this.#el('h2').hidden = !title;
    this.#el('.description').textContent = description;
    this.#el('.description').hidden = !description;
    this.#el<HTMLButtonElement>('.data').disabled = !compiled || this.#ui.dataTable === false;
    this.#el('.metrics').hidden = true;
    const error = this.getAttribute('error') ?? this.#error;
    const knownTimeFrame =
      compiled?.axisModel?.kind === 'time-series' && !!compiled.axisModel.window;
    if (error || this.loading || !compiled || (!compiled.series.length && !knownTimeFrame)) {
      const saved = this.loading && compiled && !error ? this.viewState : null;
      if (saved) this.#stateTransaction = true;
      this.#el<HTMLButtonElement>('.inspect').disabled = true;
      this.#clearInspection();
      this.#dispose();
      if (saved) this.#applyState(saved);
      this.#stateTransaction = false;

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
    if (compiled.config.mapping.kind !== 'aggregate' && !this.#plot) {
      try {
        this.#status('loading', 'Loading chart…');
        const create = await this.renderer();
        if (revision !== this.#revision || !this.isConnected) return;
        let adopted = false;
        const plot = create(
          this.#el('.canvas'),
          this.#el('.decoration'),
          (value, position, pin, series, neighbors) => {
            if (adopted && this.#plot === plot)
              this.#inspect(value, position, pin, false, series, neighbors);
          }
        );
        if (revision !== this.#revision || !this.isConnected) {
          plot.dispose();
          return;
        }
        if ('session' in plot && plot.session && typeof plot.session === 'object')
          shareReading(plot.session, this.#session);
        this.#plot = plot;
        adopted = true;
      } catch (error) {
        if (revision === this.#revision && this.isConnected)
          interactionFor(this.#session).batch(() => this.#renderError(error));
        return;
      }
    }
    interactionFor(this.#session).batch(() => {
      try {
        if (compiled.config.mapping.kind === 'aggregate') {
          this.#el<HTMLButtonElement>('.inspect').disabled = true;
          this.#clearInspection(this.#stateReason);
          this.#dispose();
          const metrics = this.#el('.metrics');
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
          const plot = this.#plot;
          if (!plot) return;
          const previousScene = plot.model;
          plot.update(compiled, this.#session.hidden, this.#ui.axes ?? 'full');
          if (compiled !== this.#compiled || revision !== this.#revision || !this.isConnected)
            return;
          if (plot.model && (plot.model !== previousScene || !sceneSnapshot(plot.model)))
            captureScene(plot.model, compiled);
          plot.linkedHighlight = this.#linkedHighlight;
          if (compiled !== this.#compiled || revision !== this.#revision || !this.isConnected)
            return;
          plot.rangeSelection = this.#rangeSelection;
          const model = plot.model;
          if (compiled !== this.#compiled || revision !== this.#revision || !this.isConnected)
            return;
          this.#session.setModel(model);
          this.#el('.viewport').setAttribute(
            'aria-label',
            title || plot.model?.ariaLabel || 'ScopeDB chart'
          );
          this.#el<HTMLButtonElement>('.inspect').disabled =
            !interactive || !plot.model?.interactions.length;
        }
        const batch = this.#notifications.capture();
        this.#status('ready', null);
        if (this.#plot) this.#showInspection(null, false, true, batch);
        this.#reportInspection(batch);
        if (compiled !== this.#compiled || !this.isConnected) return;
        this.#stateChanged(this.#stateReason);
        this.#stateReason = 'reconcile';
        this.#emit('scope-ready', {
          visualization: compiled.config.displayType,
          rows: compiled.dataset.rows.length
        });
      } catch (error) {
        if (compiled === this.#compiled && revision === this.#revision && this.isConnected)
          this.#renderError(error);
      }
    });
  }
  #renderError(error: unknown) {
    this.#el<HTMLButtonElement>('.inspect').disabled = true;
    this.#clearInspection();
    this.#dispose();
    const message = error instanceof Error ? error.message : 'Chart rendering failed.';
    this.#status('error', message);
    this.#emit('scope-error', { message });
  }
  #buildLegend() {
    const legend = this.#el('.legend');
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
      compiled.document.options?.presentation === 'sparkline' ||
      compiled.document.options?.interactive === false ||
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
    this.#el<HTMLButtonElement>('.restore').disabled = true;
  }
  #visibility() {
    this.#legendState();
    this.#clearInspection();
    this.refresh();
    this.#emit('scope-visibility-change', { hidden: [...this.#session.hidden] });
    this.#stateChanged();
  }
  #legendState() {
    const buttons = this.#root.querySelectorAll('.legend button');
    const hidden = this.#session.hidden;
    this.#compiled?.series.forEach((series, i) => {
      buttons[i]?.setAttribute('aria-pressed', String(!hidden.has(series.name)));
    });
    this.#el<HTMLButtonElement>('.restore').disabled =
      !this.#session.hidden.size || this.#compiled?.document.options?.interactive === false;
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
    interactionFor(this.#session).batch(() => {
      this.#notifications.invalidate();
      this.#cursorTimeMs = null;
      this.#readingNeighbors = [];
      this.#selectedNeighbors = [];
      this.#session.clearInspection();
      const batch = this.#notifications.capture();
      this.#showInspection(null, false, false, batch);
      this.#reportInspection(batch);
      this.#stateChanged(reason);
    });
  }
  #inspect(
    value: ChartInteraction | null,
    position: Position | null,
    pin: boolean,
    keyboard = false,
    series: string | null = null,
    neighbors?: readonly ChartInteraction[]
  ) {
    interactionFor(this.#session).batch(() => {
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
      this.#showInspection(
        position,
        keyboard,
        position !== null || previousKey !== value.key,
        batch
      );
      this.#reportInspection(batch, true);
      this.#stateChanged();
    });
  }
  #showInspection(
    position: Position | null,
    keyboard = false,
    place = true,
    batch = this.#notifications.capture()
  ) {
    interactionFor(this.#session).effect(
      () => this.#presentInspection(batch, position, keyboard, place),
      this.#readingEffect,
      0,
      () => batch.current('inspect')
    );
  }
  #presentInspection(
    batch: ReturnType<InspectionNotifications<ResultRow, CompiledChart>['capture']>,
    position: Position | null,
    keyboard: boolean,
    place: boolean
  ) {
    const { target: value, pinned, series } = batch.state.inspect;
    this.#plot?.focus(value, pinned, series, this.#session.selected?.key ?? null);
    if (!batch.current('inspect')) return;
    this.#el('.inspect').toggleAttribute('data-active', this.#session.selected !== null);
    const tooltip = this.#el('.tooltip');
    if (!value) {
      hideInspection(tooltip);
      if (batch.current('inspect')) this.#el('.live').textContent = '';
      return;
    }
    if (this.#ui.tooltip === false) {
      hideInspection(tooltip);
      if (keyboard && batch.current('inspect'))
        this.#el('.live').textContent = inspectionText(value);
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
    if (!batch.current('inspect')) return;
    renderInspection(
      tooltip,
      value,
      pinned,
      () => {
        this.#clearInspection();
        inspectionFocus(this.#root).focus();
      },
      {
        series,
        locked: this.#session.tooltipLocked,
        onLock: () => {
          this.tooltipLocked = !this.tooltipLocked;
        },
        neighbors,
        onChoose: (key) => this.#chooseObservation(key, neighbors)
      }
    );
    if (!batch.current('inspect')) return;
    if (place || keyboard) this.#placeTooltip(position, batch);
    if (keyboard && batch.current('inspect')) this.#el('.live').textContent = inspectionText(value);
  }
  #chooseObservation(key: string, neighbors: readonly ChartInteraction[]) {
    if (key === this.#session.selected?.key) return;
    const target = this.#plot?.model?.interactionByKey.get(key);
    if (!target) return;
    this.#inspect(target, null, true, false, null, neighbors);
    [...this.#el('.tooltip').querySelectorAll<HTMLButtonElement>('.tooltip-observation')]
      .find((button) => button.dataset.key === key)
      ?.focus({ preventScroll: true });
  }
  #placeTooltip(position: Position | null = null, batch = this.#notifications.capture()) {
    const value = batch.state.inspect.target;
    if (!value || this.#el('.tooltip').hidden) return;
    const tooltip = this.#el('.tooltip');
    if (tooltip.classList.contains('docked')) return;
    const anchor = position ?? this.#plot?.anchor(value) ?? { x: 0, y: 0 };
    if (!batch.current('inspect')) return;
    const canvas = this.#el('.canvas').getBoundingClientRect();
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
  #step(key: string) {
    const direction =
      key === 'Home' || key === 'End'
        ? key
        : key === 'ArrowRight' || key === 'ArrowDown'
          ? 'next'
          : 'previous';
    const value = this.#session.next(direction);
    if (value) this.#inspect(value, null, false, true);
  }
  #keyboard(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey || this.#plot?.model?.interactive === false)
      return;
    if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      this.#step(event.key);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (this.#session.active) this.#inspect(this.#session.active, null, true, true);
      else this.#step('Home');
    }
  }
  #table() {
    const raw = this.#el('.raw'),
      data = this.#compiled?.document.data;
    if (this.#ui.dataTable === false) {
      raw.hidden = true;
      this.#el('.data').setAttribute('aria-expanded', 'false');
      this.#el('.data').textContent = 'View data';
    }
    this.#el('.pagination').hidden = raw.hidden || !data || data.rows.length <= 50;
    raw.replaceChildren();
    if (raw.hidden || !data) return;
    const table = node('table'),
      head = node('thead'),
      tr = node('tr');
    const pages = Math.max(1, Math.ceil(data.rows.length / 50));
    this.#page = Math.min(Math.max(this.#page, 0), pages - 1);
    table.append(
      node(
        'caption',
        '',
        `${data.rows.length} ${this.#compiled?.document.semantics?.provenance?.kind === 'bins' ? 'derived bins' : 'returned rows'}. Raw values; NULL is shown explicitly.`
      )
    );
    data.fields.forEach((field) => {
      const th = node('th', '', field.name);
      th.scope = 'col';
      tr.append(th);
    });
    head.append(tr);
    table.append(head);
    const body = node('tbody');
    for (const values of data.rows.slice(this.#page * 50, (this.#page + 1) * 50)) {
      const row = node('tr');
      for (const value of values) {
        const cell = node('td', '', value ?? 'NULL');
        if (value === null) cell.setAttribute('aria-label', 'SQL NULL');
        else if (value === '') cell.setAttribute('aria-label', 'Empty string');
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body);
    raw.append(table);
    this.#el('.pagination span').textContent = `Page ${this.#page + 1} of ${pages}`;
    this.#el<HTMLButtonElement>('.previous').disabled = this.#page === 0;
    this.#el<HTMLButtonElement>('.next').disabled = this.#page >= pages - 1;
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
