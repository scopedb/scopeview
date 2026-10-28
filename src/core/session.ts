import type { ResultRow } from '../data/result.js';
import type { ChartInteraction, RenderModel } from './scene.js';

export type InspectionNavigation = 'Home' | 'End' | 'next' | 'previous';

/** Ephemeral state shared by Web Components, framework hosts and chart families. */
export class ChartSession<Source = ResultRow> {
  #model: RenderModel<Source> | null = null;
  #active: ChartInteraction<Source> | null = null;
  #hovered: ChartInteraction<Source> | null = null;
  #selected: ChartInteraction<Source> | null = null;
  #series: string | null = null;
  #selectedSeries: string | null = null;
  #tooltipLocked = false;
  #keyboardInspection = false;
  #hidden = new Set<string>();
  #indices = new Map<string, number>();

  /** Freeze retains the original pin contract; compare separates hover and selection. */
  constructor(readonly inspectionMode: 'freeze' | 'compare' = 'freeze') {}

  get active(): ChartInteraction<Source> | null {
    return this.#active;
  }
  /** Pointer feedback remains independent of a pinned or locked reading. */
  get hovered(): ChartInteraction<Source> | null {
    return this.#hovered;
  }
  get pinned(): boolean {
    return this.#selected !== null && this.#active?.key === this.#selected.key;
  }
  get selected(): ChartInteraction<Source> | null {
    return this.#selected;
  }
  get series(): string | null {
    return this.#series;
  }
  get tooltipLocked(): boolean {
    return this.#tooltipLocked;
  }
  lockTooltip(locked: boolean) {
    this.#tooltipLocked = locked && this.#active !== null;
  }
  /** Keyboard reading survives passive pointer leave and focus-induced page scrolling. */
  get keyboardInspection(): boolean {
    return this.#keyboardInspection;
  }
  get hidden(): Set<string> {
    return new Set(this.#hidden);
  }
  /** Reconcile by stable identity when layout, size or visible marks change. */
  setModel(model: RenderModel<Source> | null) {
    if (model === this.#model) return;
    this.#model = model;
    this.#hovered = this.#hovered ? (model?.interactionByKey.get(this.#hovered.key) ?? null) : null;
    this.#indices = new Map(model?.interactions.map((value, index) => [value.key, index]) ?? []);
    this.#selected = this.#selected
      ? (model?.interactionByKey.get(this.#selected.key) ?? null)
      : null;
    const previousKey = this.#active?.key;
    this.#active = this.#active
      ? (model?.interactionByKey.get(this.#active.key) ?? this.#selected)
      : this.#selected;
    if (previousKey !== this.#active?.key) this.#series = this.#selectedSeries;
    if (this.#series && !this.#active?.tooltip.rows.some((row) => row.label === this.#series))
      this.#series = null;
    if (
      this.#selectedSeries &&
      !this.#selected?.tooltip.rows.some((row) => row.label === this.#selectedSeries)
    )
      this.#selectedSeries = null;
    if (!this.#active) {
      this.#tooltipLocked = false;
      this.#series = null;
      this.#keyboardInspection = false;
    }
  }
  /** Returns whether reading input was accepted. Pointer feedback updates even when a
   * pin or lock rejects a passive reading change. */
  inspect(
    key: string | null,
    pin = false,
    keyboard = false,
    series: string | null = null
  ): boolean {
    const value = key ? (this.#model?.interactionByKey.get(key) ?? null) : null;
    this.#hovered = pin || keyboard ? null : value;
    if (
      !pin &&
      !keyboard &&
      (this.#tooltipLocked || (this.inspectionMode === 'freeze' && this.#selected))
    )
      return false;
    if (this.#keyboardInspection && key === null && !pin && !keyboard) return false;
    if (pin && value?.key === this.#selected?.key) {
      this.clearInspection();
      return true;
    }
    if (pin || keyboard) {
      this.#selected = pin ? value : null;
      this.#selectedSeries = pin ? series : null;
      this.#tooltipLocked = false;
    }
    this.#active = value ?? this.#selected;
    this.#series = value ? series : this.#selectedSeries;
    this.#keyboardInspection = keyboard;
    return true;
  }
  clearInspection() {
    this.#active = null;
    this.#hovered = null;
    this.#selected = null;
    this.#series = null;
    this.#selectedSeries = null;
    this.#tooltipLocked = false;
    this.#keyboardInspection = false;
  }
  /** Choose the next canonical target; inspection also works without pointer input. */
  next(direction: InspectionNavigation): ChartInteraction<Source> | null {
    const values = this.#model?.interactions ?? [];
    if (!values.length) return null;
    const index = this.#active ? (this.#indices.get(this.#active.key) ?? -1) : -1;
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
  toggleSeries(name: string, names: readonly string[], isolate = false) {
    if (!names.includes(name)) return;
    if (isolate) this.#hidden = new Set(names.filter((value) => value !== name));
    else if (this.#hidden.has(name)) this.#hidden.delete(name);
    else this.#hidden.add(name);
  }
  showAll() {
    this.#hidden.clear();
  }
  /** Controlled visibility is copied; callers reconcile it against their current series. */
  setHidden(names: Iterable<string>) {
    this.#hidden = new Set(names);
  }
  /** Idempotent programmatic restore; unlike inspect(), restoring the same pin never toggles it. */
  restorePin(key: string | null) {
    this.clearInspection();
    const target = key === null ? null : this.#model?.interactionByKey.get(key);
    if (target) {
      this.#active = target;
      this.#selected = target;
    }
  }
  /** New documents and disconnection cannot retain stale targets or source objects. */
  reset() {
    this.clearInspection();
    this.#hidden.clear();
    this.#model = null;
    this.#indices.clear();
  }
}
