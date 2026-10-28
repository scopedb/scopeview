import { ChartValidationError, object, text } from '../data/validation.js';

export interface LinkedTimeWindow {
  startTimeNs: string;
  endTimeNs: string;
}
export interface LinkedSelection {
  /** The host defines the identity domain and its mapping into each chart. */
  namespace: string;
  id: string;
}
export interface ChartLinkState {
  cursorTimeNs: string | null;
  window: LinkedTimeWindow | null;
  selection: LinkedSelection | null;
}
export interface ChartLinkUpdate {
  origin: string | null;
  changed: 'cursor' | 'window' | 'selection' | 'restore';
  state: ChartLinkState;
}
export interface ChartLinkMember {
  cursor(timeNs: string | null): void;
  window(value: LinkedTimeWindow | null): void;
  select(value: LinkedSelection | null): void;
  disconnect(): void;
}
/** A host maps semantic links into local geometry; this never pins or opens an inspector. */
export interface LinkedHighlight {
  inspectionKey: string | null;
  /** Fraction of the current plot width, not of an entity's weight or absolute time. */
  cursor: number | null;
}
export function parseLinkedHighlight(value: LinkedHighlight | null): LinkedHighlight | null {
  if (value === null) return null;
  object(value, 'linkedHighlight', ['inspectionKey', 'cursor']);
  if (
    (value.inspectionKey !== null && typeof value.inspectionKey !== 'string') ||
    (value.cursor !== null &&
      (!Number.isFinite(value.cursor) || value.cursor < 0 || value.cursor > 1))
  )
    throw new RangeError('Linked highlight needs a key and a cursor fraction within [0, 1].');
  return { inspectionKey: value.inspectionKey, cursor: value.cursor };
}
function ns(value: unknown): string {
  if (typeof value !== 'string' || !/^-?\d{1,40}$/.test(value))
    throw new ChartValidationError('link.timeNs', 'Expected 1–40 digit integer text.');
  return BigInt(value).toString();
}
function validate(value: ChartLinkState): ChartLinkState {
  object(value, 'link', ['cursorTimeNs', 'window', 'selection']);
  const cursorTimeNs = value.cursorTimeNs === null ? null : ns(value.cursorTimeNs);
  let window: LinkedTimeWindow | null = null;
  if (value.window !== null) {
    object(value.window, 'link.window', ['startTimeNs', 'endTimeNs']);
    window = { startTimeNs: ns(value.window.startTimeNs), endTimeNs: ns(value.window.endTimeNs) };
    if (BigInt(window.startTimeNs) >= BigInt(window.endTimeNs))
      throw new ChartValidationError('link.window', 'Expected startTimeNs < endTimeNs.');
  }
  if (value.selection !== null)
    object(value.selection, 'link.selection', ['namespace', 'id'], 'a selection or null');
  const selection =
    value.selection === null
      ? null
      : {
          namespace: text(value.selection.namespace, 'link.selection', true),
          id: text(value.selection.id, 'link.selection', true)
        };
  return { cursorTimeNs, window, selection };
}
function copy(state: ChartLinkState): ChartLinkState {
  return {
    ...state,
    window: state.window && { ...state.window },
    selection: state.selection && { ...state.selection }
  };
}

/** DOM-free coordination. Adapters project peer state without committing local inspection. */
export class ChartLinkGroup {
  #state: ChartLinkState = { cursorTimeNs: null, window: null, selection: null };
  #members = new Map<string, (update: ChartLinkUpdate) => void>();
  #cursorOwner: string | null = null;
  #queue: ChartLinkUpdate[] = [];
  #delivering = false;
  get state(): ChartLinkState {
    return copy(this.#state);
  }
  /** An explicit host restore notifies all members. No source data is retained. */
  set state(value: ChartLinkState) {
    this.#publish(null, 'restore', validate(value));
  }
  connect(id: string, receive: (update: ChartLinkUpdate) => void): ChartLinkMember {
    if (!id || this.#members.has(id)) throw new Error(`Duplicate or empty link member: ${id}`);
    this.#members.set(id, receive);
    try {
      receive({ origin: null, changed: 'restore', state: this.state });
    } catch (error) {
      this.#members.delete(id);
      throw error;
    }
    let connected = true;
    const publish = (changed: ChartLinkUpdate['changed'], patch: Partial<ChartLinkState>) => {
      if (!connected) return;
      // A peer leaving cannot clear a cursor most recently published by another member.
      if (changed === 'cursor' && patch.cursorTimeNs === null && this.#cursorOwner !== id) return;
      this.#publish(id, changed, validate({ ...this.#state, ...patch }));
    };
    return {
      cursor: (cursorTimeNs) => publish('cursor', { cursorTimeNs }),
      window: (window) => publish('window', { window }),
      select: (selection) => publish('selection', { selection }),
      disconnect: () => {
        if (!connected) return;
        connected = false;
        this.#members.delete(id);
        if (this.#cursorOwner === id)
          this.#publish(id, 'cursor', { ...this.#state, cursorTimeNs: null });
      }
    };
  }
  #publish(origin: string | null, changed: ChartLinkUpdate['changed'], state: ChartLinkState) {
    if (changed === 'cursor' || changed === 'restore')
      this.#cursorOwner = state.cursorTimeNs === null ? null : origin;
    if (JSON.stringify(state) === JSON.stringify(this.#state)) return;
    this.#state = state;
    this.#queue.push({ origin, changed, state: this.state });
    if (this.#delivering) return;
    this.#delivering = true;
    const errors: unknown[] = [];
    try {
      while (this.#queue.length) {
        const update = this.#queue.shift()!;
        for (const [id, receive] of [...this.#members]) {
          if (id === update.origin || !this.#members.has(id)) continue;
          try {
            receive({ ...update, state: copy(update.state) });
          } catch (error) {
            errors.push(error);
          }
        }
      }
    } finally {
      this.#delivering = false;
    }
    if (errors.length) throw new AggregateError(errors, 'Chart link receivers failed.');
  }
}
