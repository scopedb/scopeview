import type { ResultRow } from '../data/result.js';
import type { ChartInteraction, RenderModel } from './scene.js';
import { readingState, clearReading, editReading } from './reading-state.js';

export type InspectionNavigation = 'Home' | 'End' | 'next' | 'previous';

/** Pure reading reducers shared by the public facade and small headless views. */
export class ReadingSession<Source = ResultRow> {
  #target(key: string | null) {
    return key === null
      ? null
      : (readingState<Source>(this).model?.interactionByKey.get(key) ?? null);
  }
  get active(): ChartInteraction<Source> | null {
    return this.#target(readingState<Source>(this).active);
  }
  /** Pointer feedback remains independent of a pinned or locked reading. */
  get hovered(): ChartInteraction<Source> | null {
    return this.#target(readingState<Source>(this).hovered);
  }
  get pinned(): boolean {
    const state = readingState<Source>(this);
    return state.selected !== null && state.active === state.selected;
  }
  get selected(): ChartInteraction<Source> | null {
    return this.#target(readingState<Source>(this).selected);
  }
  get series(): string | null {
    return readingState<Source>(this).series;
  }
  get selectedSeries(): string | null {
    return readingState<Source>(this).selectedSeries;
  }
  /** Keyboard reading survives passive pointer leave and focus-induced page scrolling. */
  get keyboardInspection(): boolean {
    return readingState<Source>(this).keyboard;
  }
  get hidden(): Set<string> {
    return new Set<string>();
  }
  /** Reconcile by stable identity when layout, size or visible marks change. */
  setModel(model: RenderModel<Source> | null) {
    const state = editReading<Source>(this);
    if (model === state.model) return;
    state.model = model;
    state.modelVersion++;
    state.indices = new Map(model?.interactions.map((value, index) => [value.key, index]));
    const present = (key: string | null) =>
      key !== null && model?.interactionByKey.has(key) ? key : null;
    state.hovered = present(state.hovered);
    state.selected = present(state.selected);
    const previousKey = state.active;
    state.active = present(state.active) ?? state.selected;
    if (previousKey !== state.active) state.series = state.selectedSeries;
    if (state.series && !this.active?.tooltip.rows.some((row) => row.label === state.series))
      state.series = null;
    if (
      state.selectedSeries &&
      !this.selected?.tooltip.rows.some((row) => row.label === state.selectedSeries)
    )
      state.selectedSeries = null;
    if (!state.active) {
      state.intent = {};
      state.series = null;
      state.keyboard = false;
    }
  }
  /** Return whether reading input was accepted; passive hover remains independent. */
  inspect(
    key: string | null,
    pin = false,
    keyboard = false,
    series: string | null = null
  ): boolean {
    const state = editReading<Source>(this);
    const value = key && state.model?.interactionByKey.has(key) ? key : null;
    state.hovered = pin || keyboard ? null : value;
    if (state.keyboard && key === null && !pin && !keyboard) return false;
    if (pin && value === state.selected) clearReading(state);
    else {
      if (pin || keyboard) {
        state.selected = pin ? value : null;
        state.selectedSeries = pin ? series : null;
        state.intent = {};
      }
      if (state.active !== (value ?? state.selected)) state.intent = {};
      state.active = value ?? state.selected;
      state.series = value ? series : state.selectedSeries;
      state.keyboard = keyboard;
    }
    return true;
  }
  clearInspection() {
    clearReading(editReading<Source>(this));
  }
  /** Choose the next canonical target without relying on painted hit regions. */
  next(direction: InspectionNavigation): ChartInteraction<Source> | null {
    const state = readingState<Source>(this);
    const values = state.model?.interactions ?? [];
    if (!values.length) return null;
    const index = state.active === null ? -1 : (state.indices!.get(state.active) ?? -1);
    const forward = direction === 'next';
    const target =
      direction === 'Home'
        ? 0
        : direction === 'End'
          ? values.length - 1
          : index < 0
            ? forward
              ? 0
              : values.length - 1
            : (index + (forward ? 1 : -1) + values.length) % values.length;
    return values[target];
  }
  /** New documents and disconnection cannot retain stale targets or source objects. */
  reset() {
    const state = editReading<Source>(this);
    clearReading(state);
    state.model = null;
    state.modelVersion++;
    state.indices?.clear();
  }
}
