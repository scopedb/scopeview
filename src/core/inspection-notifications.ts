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

interface Identity {
  snapshot: object | null;
  key: string | null;
  series: string | null;
  pinned: boolean;
}

const empty = (): Identity => ({ snapshot: null, key: null, series: null, pinned: false });
const channels = ['inspect', 'select'] as const;

function reading<Source>(value: InspectionReading<Source>, selected = false) {
  return {
    target: value.target,
    series: value.target ? (value.series ?? null) : null,
    pinned: !!value.target && (selected || value.pinned === true)
  };
}

function identity<Source>(snapshot: object | null, value: InspectionReading<Source>): Identity {
  return value.target
    ? {
        snapshot,
        key: value.target.key,
        series: value.series ?? null,
        pinned: value.pinned === true
      }
    : empty();
}

function same(a: Identity, b: Identity) {
  return (
    a.snapshot === b.snapshot && a.key === b.key && a.series === b.series && a.pinned === b.pinned
  );
}

/** DOM-free delivery protocol shared by headless callbacks and component events. */
export class InspectionNotifications<Source, Snapshot extends object = object> {
  #reported = { inspect: empty(), select: empty() };
  #versions = { inspect: 0, select: 0 };
  #closed = false;

  constructor(private readonly read: () => InspectionState<Source, Snapshot>) {}

  /** Cancel captured work without forgetting the state already delivered to the host. */
  invalidate(channel?: InspectionChannel) {
    for (const name of channel ? [channel] : channels) this.#versions[name]++;
  }

  capture() {
    const state: InspectionState<Source, Snapshot> = this.#closed
      ? { snapshot: null, inspect: { target: null }, select: { target: null } }
      : this.read();
    const values = {
      inspect: reading(state.inspect),
      select: reading(state.select, true)
    };
    const identities = {
      inspect: identity(state.snapshot, values.inspect),
      select: identity(state.snapshot, values.select)
    };
    const versions = { ...this.#versions };
    const reported = { ...this.#reported };
    const current = (channel?: InspectionChannel): boolean => {
      if (!channel) return channels.every((name) => current(name));
      if (
        this.#closed ||
        versions[channel] !== this.#versions[channel] ||
        reported[channel] !== this.#reported[channel]
      )
        return false;
      const live = this.read();
      return same(
        identities[channel],
        identity(live.snapshot, reading(live[channel], channel === 'select'))
      );
    };
    return {
      state: { snapshot: state.snapshot, ...values },
      current,
      emit: (
        channel: InspectionChannel,
        deliver: (value: (typeof values)[InspectionChannel], snapshot: Snapshot | null) => void,
        options: { force?: boolean; before?(): void } = {}
      ): boolean => {
        if (
          !current(channel) ||
          (!options.force && same(identities[channel], this.#reported[channel]))
        )
          return false;
        options.before?.();
        if (!current(channel)) return false;
        // Commit before user code; nested delivery can then clear or replace this report.
        const report = { ...identities[channel] };
        this.#reported[channel] = reported[channel] = report;
        deliver(values[channel], state.snapshot);
        return true;
      }
    };
  }

  /** Permanent headless disposal is silent and cancels every pending callback. */
  dispose() {
    this.#closed = true;
    this.invalidate();
    this.#reported = { inspect: empty(), select: empty() };
  }
}
