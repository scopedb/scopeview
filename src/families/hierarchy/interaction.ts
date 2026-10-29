import { readingState, restoreReading } from '../../core/reading-state.js';
import type { ChartSession } from '../../core/session.js';
import type { ChartInteraction, AxisMode } from '../../core/scene.js';
import { ViewportSession, type ViewportState, type ViewportBounds } from '../../core/viewport.js';
import type { HierarchyViewState } from '../../core/view-state.js';
import { hierarchyViewportHeight, type HierarchyView } from './layout.js';
import type { Entity, EntityDocument, Hierarchy } from './model.js';

interface Compiled<Source extends Entity> {
  document: EntityDocument;
  hierarchy: Hierarchy<Source>;
}
interface Focus {
  id: string;
  snapshot: object;
  intent: object;
}

interface State<Source extends Entity, Document> {
  compiled: Document | null;
  view: HierarchyView<Source> | null;
  collapsed: Set<string>;
  viewport: ViewportState;
  restore: ViewportState | null;
  focus: Focus | null;
  height: number | null;
  axes: AxisMode;
  report: object | null;
  active: boolean;
}

/** Family semantic state belongs to the same owner as its public session facade. */
export class HierarchyInteraction<Source extends Entity, Document extends Compiled<Source>> {
  readonly viewport: ViewportSession;
  #state: State<Source, Document>;
  constructor(
    private readonly session: ChartSession<Source>,
    private readonly createView: (
      document: Document,
      collapsed: ReadonlySet<string>
    ) => HierarchyView<Source>
  ) {
    this.#state = {
      compiled: null as Document | null,
      view: null as HierarchyView<Source> | null,
      collapsed: new Set<string>(),
      viewport: { start: 0, end: 1, scrollOffset: 0 } as ViewportState,
      restore: null as ViewportState | null,
      focus: null as Focus | null,
      height: null as number | null,
      axes: 'full' as AxisMode,
      report: null as object | null,
      active: false
    };
    this.viewport = new OwnedViewport(
      () => ({ ...this.#state.viewport }),
      (change) =>
        this.#reduce((state) => ({
          ...state,
          report: {},
          focus: null,
          restore: null,
          viewport: this.#geometry(state, change)
        }))
    );
  }
  #reduce(reduce: (state: State<Source, Document>) => State<Source, Document>) {
    this.#state = reduce(this.#state);
  }
  get compiled() {
    return this.#state.compiled;
  }
  get view() {
    return this.#state.view;
  }
  get collapsed(): ReadonlySet<string> {
    return this.#state.collapsed;
  }
  get desiredViewport() {
    const state = this.#state;
    return { ...(state.restore ?? state.viewport) };
  }
  get report() {
    return this.#state.report;
  }
  get active() {
    return this.#state.active;
  }
  #geometry(
    state: {
      view: HierarchyView<Source> | null;
      viewport: ViewportState;
      restore: ViewportState | null;
      height: number | null;
      axes: AxisMode;
    },
    change?: (viewport: ViewportSession) => void
  ) {
    const viewport = new ViewportSession();
    viewport.configure({
      contentHeight: (state.view?.rowCount ?? 0) * (state.view?.rowHeight ?? 24),
      visibleHeight: state.height === null ? 0 : hierarchyViewportHeight(state.height, state.axes)
    });
    viewport.set(state.restore ?? state.viewport);
    change?.(viewport);
    return { ...viewport.state };
  }
  #adopt() {
    if (this.active) this.session.setModel(this.view?.navigation ?? null);
  }
  replace(compiled: Document | null) {
    this.session.clearInspection();
    this.#reduce((state) => ({
      ...state,
      compiled,
      view: compiled ? this.createView(compiled, new Set()) : null,
      collapsed: new Set(),
      viewport: { start: 0, end: 1, scrollOffset: 0 },
      restore: null,
      focus: null,
      report: null
    }));
    this.#adopt();
  }
  collapse(collapsed: Iterable<string>) {
    const values = new Set(collapsed);
    for (const id of values)
      if (!this.compiled?.hierarchy.byId.has(id)) throw new RangeError(`Unknown node: ${id}`);
    this.#reduce((state) => ({
      ...state,
      collapsed: values,
      focus: null,
      view: state.compiled ? this.createView(state.compiled, values) : null
    }));
    this.#adopt();
  }
  restore(state: HierarchyViewState) {
    const collapsed = new Set(
      state.collapsed.filter((id) => this.compiled?.hierarchy.children.get(id)?.length)
    );
    this.#reduce((previous) => ({
      ...previous,
      collapsed,
      view: previous.compiled ? this.createView(previous.compiled, collapsed) : null,
      viewport: { ...state.viewport },
      restore: { ...state.viewport },
      focus: null,
      report: null
    }));
    this.#adopt();
    restoreReading(this.session, state.pinnedKey);
  }
  activate() {
    this.#reduce((state) => ({ ...state, active: true }));
    this.#adopt();
  }
  deactivate() {
    this.#reduce((state) => ({ ...state, active: false, focus: null }));
    this.session.setModel(null);
  }
  focus(id: string, pin: boolean) {
    const compiled = this.compiled;
    if (!compiled?.hierarchy.byId.has(id)) throw new RangeError(`Unknown node: ${id}`);
    if (!this.active || compiled.document.options?.interactive === false) return false;
    const collapsed = new Set(this.collapsed);
    let parent = compiled.hierarchy.byId.get(id)?.parentId;
    while (parent && compiled.hierarchy.byId.has(parent)) {
      collapsed.delete(parent);
      parent = compiled.hierarchy.byId.get(parent)?.parentId;
    }
    this.#reduce((state) => ({
      ...state,
      collapsed,
      view: this.createView(compiled, collapsed)
    }));
    this.#adopt();
    this.session.inspect(this.view!.byId.get(id)!.interaction.key, pin, true);
    this.navigate(this.session.active);
    return true;
  }
  navigate(target: ChartInteraction<Source> | null) {
    const id = target?.sources[0]?.id;
    const focus =
      id && this.view?.byId.has(id)
        ? {
            id,
            snapshot: this.compiled!,
            intent: readingState(this.session).intent
          }
        : null;
    this.#reduce((state) => ({ ...state, focus, restore: null }));
    // The previous valid measurement can position a hidden chart provisionally.
    this.#position(false);
  }
  measure(height: number, axes: AxisMode) {
    if (!Number.isFinite(height) || height <= 0) return;
    this.#reduce((state) => ({ ...state, height, axes }));
    this.#position(true);
  }
  #position(measured: boolean) {
    this.#reduce((state) => {
      const focus = state.focus;
      const current =
        !!focus &&
        focus.snapshot === state.compiled &&
        focus.intent === readingState(this.session).intent;
      const item = current ? state.view?.byId.get(focus.id) : null;
      if (state.height === null) return state;
      const viewport = this.#geometry(
        state,
        item
          ? (viewport) =>
              viewport.reveal(
                item.start,
                item.end,
                item.row * state.view!.rowHeight,
                (item.row + 1) * state.view!.rowHeight
              )
          : undefined
      );
      const changed =
        viewport.start !== state.viewport.start ||
        viewport.end !== state.viewport.end ||
        viewport.scrollOffset !== state.viewport.scrollOffset;
      return {
        ...state,
        viewport,
        report: item && changed ? {} : state.report,
        restore: null,
        focus: measured || !current ? null : focus
      };
    });
  }
  dismiss() {
    this.#reduce((state) => ({ ...state, focus: null }));
    this.session.clearInspection();
  }
}

/** Existing viewport controllers retain their API while all writes enter the owner. */
class OwnedViewport extends ViewportSession {
  constructor(
    private readonly read: () => ViewportState,
    private readonly change: (change: (viewport: ViewportSession) => void) => void
  ) {
    super();
  }
  override get state() {
    return this.read();
  }
  override configure(bounds: ViewportBounds) {
    this.change((viewport) => viewport.configure(bounds));
  }
  override set(value: ViewportState) {
    this.change((viewport) => viewport.set(value));
  }
  override zoom(factor: number, anchor = 0.5) {
    this.change((viewport) => viewport.zoom(factor, anchor));
  }
  override pan(fraction: number) {
    this.change((viewport) => viewport.pan(fraction));
  }
  override scroll(pixels: number) {
    this.change((viewport) => viewport.scroll(pixels));
  }
  override reveal(start: number, end: number, top: number, bottom: number) {
    this.change((viewport) => viewport.reveal(start, end, top, bottom));
  }
  override reset() {
    this.change((viewport) => viewport.reset());
  }
}
