import type { RenderModel } from './scene.js';
import type { ResultRow } from '../data/result.js';
import { ReadingSession } from './reading-session.js';
import { readingState, clearReading, editReading, restoredKey } from './reading-state.js';
export type { InspectionNavigation } from './reading-session.js';

/** Public session facade; controlled visibility and restoration stay optional for views. */
export class ChartSession<Source = ResultRow> extends ReadingSession<Source> {
  constructor(readonly inspectionMode: 'freeze' | 'compare' = 'freeze') {
    super();
  }
  get tooltipLocked() {
    const state = readingState(this);
    return state.lock === state.intent && state.active !== null;
  }
  override setModel(model: RenderModel<Source> | null) {
    const restored = restoredKey(this);
    super.setModel(model);
    if (restored !== undefined) {
      const state = editReading<Source>(this);
      const target = restored === null ? null : model?.interactionByKey.get(restored);
      clearReading(state);
      state.active = state.selected = target?.key ?? null;
    }
  }
  override inspect(
    key: string | null,
    pin = false,
    keyboard = false,
    series: string | null = null
  ): boolean {
    const state = editReading<Source>(this);
    if (
      !pin &&
      !keyboard &&
      (this.tooltipLocked || (this.inspectionMode === 'freeze' && state.selected))
    ) {
      state.hovered = key && state.model?.interactionByKey.has(key) ? key : null;
      return false;
    }
    return super.inspect(key, pin, keyboard, series);
  }
  override get hidden(): Set<string> {
    return new Set(readingState<Source>(this).hidden);
  }
  override reset() {
    super.reset();
    editReading<Source>(this).hidden?.clear();
  }
  lockTooltip(locked: boolean) {
    const state = editReading<Source>(this);
    state.lock = locked && state.active !== null ? state.intent : undefined;
  }
  toggleSeries(name: string, names: readonly string[], isolate = false) {
    if (!names.includes(name)) return;
    const state = editReading<Source>(this);
    state.hidden = new Set(isolate ? names.filter((value) => value !== name) : state.hidden);
    if (!isolate) {
      if (state.hidden.has(name)) state.hidden.delete(name);
      else state.hidden.add(name);
    }
  }
  showAll() {
    this.setHidden([]);
  }
  /** Controlled visibility is copied; callers reconcile it against their current series. */
  setHidden(names: Iterable<string>) {
    editReading<Source>(this).hidden = new Set(names);
  }
  /** Idempotent programmatic restore; unlike inspect(), restoring the same pin never toggles it. */
  restorePin(key: string | null) {
    const state = editReading<Source>(this);
    const target = key === null ? null : state.model?.interactionByKey.get(key);
    clearReading(state);
    state.active = state.selected = target?.key ?? null;
  }
}
