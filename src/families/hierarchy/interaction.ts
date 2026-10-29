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

/** Pure hierarchy commands own semantic state; presentation never writes it back. */
export class HierarchyInteraction<Source extends Entity, Document extends Compiled<Source>> {
  readonly viewport: ViewportSession;
  #compiled: Document | null = null;
  #view: HierarchyView<Source> | null = null;
  #collapsed = new Set<string>();
  #window: ViewportState = { start: 0, end: 1, scrollOffset: 0 };
  #restore: ViewportState | null = null;
  #focus: Focus | null = null;
  #height: number | null = null;
  #axes: AxisMode = 'full';
  #report: object | null = null;
  #active = false;

  constructor(
    private readonly session: ChartSession<Source>,
    private readonly createView: (
      document: Document,
      collapsed: ReadonlySet<string>
    ) => HierarchyView<Source>
  ) {
    this.viewport = new OwnedViewport(
      () => ({ ...this.#window }),
      (change) => {
        const viewport = this.#geometry(change);
        this.#window = viewport;
        this.#report = {};
        this.#focus = this.#restore = null;
      }
    );
  }
  get compiled() {
    return this.#compiled;
  }
  get view() {
    return this.#view;
  }
  get collapsed(): ReadonlySet<string> {
    return this.#collapsed;
  }
  get desiredViewport() {
    return { ...(this.#restore ?? this.#window) };
  }
  get report() {
    return this.#report;
  }
  get active() {
    return this.#active;
  }

  #geometry(change?: (viewport: ViewportSession) => void) {
    const viewport = new ViewportSession();
    viewport.configure({
      contentHeight: (this.#view?.rowCount ?? 0) * (this.#view?.rowHeight ?? 24),
      visibleHeight: this.#height === null ? 0 : hierarchyViewportHeight(this.#height, this.#axes)
    });
    viewport.set(this.#restore ?? this.#window);
    change?.(viewport);
    return { ...viewport.state };
  }
  #adopt() {
    if (this.#active) this.session.setModel(this.#view?.navigation ?? null);
  }
  replace(compiled: Document | null) {
    const collapsed = new Set<string>();
    const view = compiled ? this.createView(compiled, collapsed) : null;
    this.session.clearInspection();
    this.#compiled = compiled;
    this.#view = view;
    this.#collapsed = collapsed;
    this.#window = { start: 0, end: 1, scrollOffset: 0 };
    this.#restore = this.#focus = this.#report = null;
    this.#adopt();
  }
  collapse(collapsed: Iterable<string>) {
    const values = new Set(collapsed);
    for (const id of values)
      if (!this.#compiled?.hierarchy.byId.has(id)) throw new RangeError(`Unknown node: ${id}`);
    const view = this.#compiled ? this.createView(this.#compiled, values) : null;
    this.#collapsed = values;
    this.#view = view;
    this.#focus = null;
    this.#adopt();
  }
  restore(state: HierarchyViewState) {
    const collapsed = new Set(
      state.collapsed.filter((id) => this.#compiled?.hierarchy.children.get(id)?.length)
    );
    const view = this.#compiled ? this.createView(this.#compiled, collapsed) : null;
    this.#collapsed = collapsed;
    this.#view = view;
    this.#window = { ...state.viewport };
    this.#restore = { ...state.viewport };
    this.#focus = this.#report = null;
    this.#adopt();
    restoreReading(this.session, state.pinnedKey);
  }
  activate() {
    this.#active = true;
    this.#adopt();
  }
  deactivate() {
    this.#active = false;
    this.#focus = null;
    this.session.setModel(null);
  }
  focus(id: string, pin: boolean) {
    const compiled = this.#compiled;
    if (!compiled?.hierarchy.byId.has(id)) throw new RangeError(`Unknown node: ${id}`);
    if (!this.#active || compiled.document.options?.interactive === false) return false;
    const collapsed = new Set(this.#collapsed);
    let parent = compiled.hierarchy.byId.get(id)?.parentId;
    while (parent && compiled.hierarchy.byId.has(parent)) {
      collapsed.delete(parent);
      parent = compiled.hierarchy.byId.get(parent)?.parentId;
    }
    const view = this.createView(compiled, collapsed);
    this.#collapsed = collapsed;
    this.#view = view;
    this.#adopt();
    this.session.inspect(view.byId.get(id)!.interaction.key, pin, true);
    this.navigate(this.session.active);
    return true;
  }
  navigate(target: ChartInteraction<Source> | null) {
    const id = target?.sources[0]?.id;
    this.#focus =
      id && this.#view?.byId.has(id)
        ? { id, snapshot: this.#compiled!, intent: readingState(this.session).intent }
        : null;
    this.#restore = null;
    // A previous valid measurement positions hidden charts provisionally.
    this.#position(false);
  }
  measure(height: number, axes: AxisMode) {
    if (!Number.isFinite(height) || height <= 0) return;
    this.#height = height;
    this.#axes = axes;
    this.#position(true);
  }
  #position(measured: boolean) {
    if (this.#height === null) return;
    const focus = this.#focus,
      view = this.#view;
    const current =
      !!focus &&
      focus.snapshot === this.#compiled &&
      focus.intent === readingState(this.session).intent;
    const item = current ? view?.byId.get(focus.id) : null;
    const viewport = this.#geometry(
      item
        ? (viewport) =>
            viewport.reveal(
              item.start,
              item.end,
              item.row * view!.rowHeight,
              (item.row + 1) * view!.rowHeight
            )
        : undefined
    );
    if (
      item &&
      (viewport.start !== this.#window.start ||
        viewport.end !== this.#window.end ||
        viewport.scrollOffset !== this.#window.scrollOffset)
    )
      this.#report = {};
    this.#window = viewport;
    this.#restore = null;
    if (measured || !current) this.#focus = null;
  }
  dismiss() {
    this.#focus = null;
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
