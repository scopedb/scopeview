import type { InteractionChannel, Interaction } from './interaction.js';
import type { ChartInteraction } from './scene.js';

export type InspectionChannel = 'inspect' | 'select';

export interface InspectionReading<Source> {
  target: ChartInteraction<Source> | null;
  series?: string | null;
  pinned?: boolean;
}

export interface InspectionState<Source, Snapshot extends object = object> {
  snapshot: Snapshot | null;
  inspect: InspectionReading<Source>;
  select: InspectionReading<Source>;
}

interface ReportedReading<Source> {
  snapshot: object | null;
  target: ChartInteraction<Source> | null;
  series: string | null;
  pinned: boolean;
}
const empty: ReportedReading<never> = { snapshot: null, target: null, series: null, pinned: false };
const channels = ['inspect', 'select'] as const;

function reading<Source>(
  value: InspectionReading<Source>,
  snapshot: object | null,
  selected = false
): ReportedReading<Source> {
  return value.target
    ? {
        snapshot,
        target: value.target,
        series: value.series ?? null,
        pinned: selected || value.pinned === true
      }
    : empty;
}

function same<Source>(a: ReportedReading<Source>, b: ReportedReading<Source>) {
  return (
    a.snapshot === b.snapshot &&
    a.target?.key === b.target?.key &&
    a.series === b.series &&
    a.pinned === b.pinned
  );
}

/** DOM-free delivery protocol shared by headless callbacks and component events. */
export class InspectionNotifications<Source, Snapshot extends object = object> {
  #reports: Record<InspectionChannel, InteractionChannel<ReportedReading<Source>>>;
  #versions = { inspect: 0, select: 0 };
  #read: (() => InspectionState<Source, Snapshot>) | null;
  readonly #interaction: Interaction;

  constructor(read: () => InspectionState<Source, Snapshot>, interaction: Interaction) {
    this.#read = read;
    this.#interaction = interaction;
    this.#reports = {
      inspect: interaction.channel(empty, same),
      select: interaction.channel(empty, same)
    };
  }

  /** Cancel captured work without forgetting the state already delivered to the host. */
  invalidate(channel?: InspectionChannel) {
    for (const name of channel ? [channel] : channels) this.#versions[name]++;
  }

  capture() {
    const state = this.#read?.() ?? {
      snapshot: null,
      inspect: empty,
      select: empty
    };
    const values = {
      snapshot: state.snapshot,
      inspect: reading(state.inspect, state.snapshot),
      select: reading(state.select, state.snapshot, true)
    };
    const versions = { ...this.#versions };
    const current = (channel: InspectionChannel): boolean => {
      if (!this.#read || versions[channel] !== this.#versions[channel]) return false;
      const live = this.#read();
      return same(values[channel], reading(live[channel], live.snapshot, channel === 'select'));
    };
    return {
      state: values,
      current,
      emit: (
        channel: InspectionChannel,
        deliver: (value: (typeof values)[InspectionChannel], snapshot: Snapshot | null) => void,
        force = false
      ): boolean => {
        return this.#interaction.report(
          this.#reports[channel],
          values[channel],
          () => current(channel),
          (value) => {
            versions[channel] = ++this.#versions[channel];
            deliver(value, values.snapshot);
          },
          force
        );
      }
    };
  }

  /** Permanent headless disposal is silent and cancels every pending callback. */
  dispose() {
    this.#read = null;
    for (const channel of channels) this.#reports[channel].value = empty;
  }
}
