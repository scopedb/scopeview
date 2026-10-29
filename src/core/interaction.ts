type Effect = readonly [run: () => void, current: (() => boolean) | undefined];
const nonempty = (queue?: ReadonlyMap<object, Effect>) => queue?.size;

// Fixed compatibility order, not caller-defined scheduling priorities.
export const controlsPhase = 1,
  readingPhase = 2,
  viewportPhase = 3,
  viewStatePhase = 4,
  readyPhase = 5;
type NotificationPhase = 1 | 2 | 3 | 4 | 5;

/** One commit/effect boundary per chart. State transitions never call observers. */
export class Interaction {
  declare reading?: unknown;
  #busy = 0;
  #work: Map<object, Effect>[] = [];
  #scheduled = false;

  batch<T>(commit: () => T): T {
    this.#busy++;
    try {
      return commit();
    } finally {
      if (!--this.#busy) this.#flush();
    }
  }

  /** A key coalesces obsolete effects. A broadcast always runs to completion. */
  effect(
    run: () => void,
    key: object = {},
    phase: 0 | NotificationPhase = 0,
    current?: () => boolean
  ): boolean {
    if (current && !current()) return false;
    this.#work[phase] ??= new Map();
    this.#work[phase].set(key, [run, current]);
    this.#flush();
    return true;
  }

  report<T>(
    channel: InteractionChannel<T>,
    value: T,
    current: () => boolean,
    deliver: (value: T) => void,
    force = false
  ): boolean {
    const ready = () => current() && (force || !channel.same(channel.value, value));
    return this.effect(
      () => {
        channel.value = value;
        deliver(value);
      },
      channel,
      channel.phase,
      ready
    );
  }

  #flush() {
    if (this.#busy || this.#scheduled) return;
    this.#busy = 1;
    const errors: unknown[] = [];
    try {
      // A changing-value observer cycle must yield to input, timers and painting.
      for (let budget = 64; budget; budget--) {
        const queue = this.#work.find(nonempty);
        if (!queue) break;
        const [key, [run, current]] = queue.entries().next().value!;
        queue.delete(key);
        try {
          if (!current || current()) run();
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      this.#busy = 0;
      if (this.#work.find(nonempty)) {
        this.#scheduled = true;
        setTimeout(() => {
          this.#scheduled = false;
          this.#flush();
        }, 0);
      }
    }
    if (errors.length) throw errors[0];
  }
}

export interface InteractionChannel<T> {
  value: T;
  same(a: T, b: T): boolean;
  readonly phase: NotificationPhase;
}

/** A channel owns its published value, comparison and fixed delivery phase. */
export function channel<T>(
  value: T,
  same: (a: T, b: T) => boolean,
  phase: NotificationPhase = readingPhase
): InteractionChannel<T> {
  return { value, same, phase };
}

// Public session objects are facades; sharing a session never duplicates its state owner.
const owners = new WeakMap<object, Interaction>();
export function interactionFor(owner: object): Interaction {
  let interaction = owners.get(owner);
  if (!interaction) {
    interaction = new Interaction();
    owners.set(owner, interaction);
  }
  return interaction;
}

export function shareInteraction(owner: object, interaction: Interaction) {
  owners.set(owner, interaction);
}

/** Canvas providers are consumed once; an unrelated runtime never inherits a disposed session. */
export function claimInteraction(owner: object, provider: object) {
  const interaction = owners.get(provider);
  owners.delete(provider);
  if (interaction) owners.set(owner, interaction);
}

export function detachInteraction(owner: object) {
  owners.delete(owner);
}
