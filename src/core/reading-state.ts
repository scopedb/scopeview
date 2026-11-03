import { interactionFor, shareInteraction, detachInteraction } from './interaction.js';
import type { RenderModel } from './scene.js';

export interface ReadingState<Source> {
  model: RenderModel<Source> | null;
  modelVersion: number;
  indices?: Map<string, number>;
  active: string | null;
  hovered: string | null;
  selected: string | null;
  series: string | null;
  selectedSeries: string | null;
  lock?: object;
  keyboard: boolean;
  hidden?: Set<string>;
  restore?: { key: string | null; intent: object };
  intent: object;
}

export function readingState<Source>(owner: object): Readonly<ReadingState<Source>> {
  const interaction = interactionFor(owner);
  interaction.reading ??= {
    model: null,
    modelVersion: 0,
    active: null,
    hovered: null,
    selected: null,
    series: null,
    selectedSeries: null,
    keyboard: false,
    intent: {}
  };
  return interaction.reading as Readonly<ReadingState<Source>>;
}

/** Mutable access is restricted to synchronous reducers; runtime effects read snapshots. */
export const editReading = readingState as <Source>(owner: object) => ReadingState<Source>;

export function clearReading<Source>(state: ReadingState<Source>): void {
  state.active = state.hovered = state.selected = null;
  state.series = state.selectedSeries = null;
  state.keyboard = false;
  state.intent = {};
}

export function restoredKey(owner: object): string | null | undefined {
  const state = readingState(owner);
  return state.restore?.intent === state.intent ? state.restore.key : undefined;
}

/** Controlled restoration is a semantic intent, including before the first model exists. */
export function restoreReading(owner: object, key: string | null) {
  const state = editReading(owner);
  clearReading(state);
  const target = key === null ? null : state.model?.interactionByKey.get(key);
  state.restore = { key, intent: state.intent };
  state.active = state.selected = target?.key ?? null;
}

const borrowed = new WeakSet<object>();

/** A newly constructed runtime uses its host's existing state, not a second session. */
export function shareReading(owner: object, source: object) {
  shareInteraction(owner, interactionFor(source));
  borrowed.add(owner);
}

/** Retained runtime facades must not write into a host's next lifecycle. */
export function releaseReading(owner: object) {
  if (borrowed.delete(owner)) detachInteraction(owner);
}
