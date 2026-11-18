import { Interaction, controlsPhase } from '../../../src/core/interaction.js';
import { describe, expect, it, vi } from 'vitest';
import {
  InspectionNotifications,
  type InspectionChannel,
  type InspectionState
} from '../../../src/core/inspection-notifications.js';
import type { ChartInteraction } from '../../../src/index.js';

const target = (key: string): ChartInteraction<string> => ({
  key,
  sources: [key],
  tooltip: { rows: [] }
});

function fixture() {
  const a = target('a');
  const state: InspectionState<string> = {
    snapshot: {},
    inspect: { target: a },
    select: { target: a }
  };
  const read = vi.fn(() => state);
  const interaction = new Interaction();
  const notifications = new InspectionNotifications(read, interaction);
  const sent: string[] = [];
  const deliver = (value: { target: ChartInteraction<string> | null }) =>
    sent.push(value.target?.key ?? 'null');
  return { a, state, read, interaction, notifications, sent, deliver };
}

describe('inspection notifications', () => {
  it.each([
    'inspect',
    'select'
  ] as const)('preserves fresh %s-first order and independently coalesces nested channel values', (first: InspectionChannel) => {
    const other = first === 'inspect' ? 'select' : 'inspect';
    const { state, interaction, notifications } = fixture();
    const seen: string[] = [];
    const emit = () => {
      const captured = notifications.capture();
      for (const channel of [first, other] as const)
        captured.emit(channel, (value) => {
          seen.push(`${channel}:${value.target?.key}`);
          if (channel === first && value.target?.key === 'a') {
            state.inspect.target = state.select.target = target('b');
            emit();
          }
        });
    };
    interaction.batch(emit);
    expect(seen[0]).toBe(`${first}:a`);
    expect(seen.slice(1).sort()).toEqual(['inspect:b', 'select:b']);
    expect(seen).not.toContain(`${other}:a`);

    // With no nested command, both adapters preserve their original enqueue order.
    const stable: InspectionChannel[] = [];
    state.snapshot = {};
    interaction.batch(() => {
      const captured = notifications.capture();
      for (const channel of [first, other] as const)
        captured.emit(channel, () => stable.push(channel));
    });
    expect(stable).toEqual([first, other]);
  });

  it('publishes captured readings while synchronous getters expose a nested command immediately', () => {
    const interaction = new Interaction();
    const state = { snapshot: {}, inspect: { target: target('a') }, select: { target: null } };
    const notifications = new InspectionNotifications(() => state, interaction);
    const seen: string[] = [];
    const publish = (key: string) =>
      interaction.batch(() => {
        state.inspect.target = target(key);
        notifications.capture().emit('inspect', broadcast);
      });
    const broadcast = (value: { target: ChartInteraction<string> | null }) => {
      seen.push(`first:${value.target?.key}/${state.inspect.target.key}`);
      if (value.target?.key === 'a') {
        publish('b');
        seen.push(`after:${value.target.key}/${state.inspect.target.key}`);
      }
      seen.push(`second:${value.target?.key}/${state.inspect.target.key}`);
    };
    publish('a');
    expect(seen).toEqual(['first:a/a', 'after:a/b', 'second:a/b', 'first:b/b', 'second:b/b']);
  });

  it.each([true, false])('coalesces explicit input followed by a forced=%s report', (force) => {
    const { interaction, notifications, deliver, sent } = fixture();
    notifications.capture().emit('inspect', deliver);
    sent.length = 0;
    interaction.batch(() => {
      notifications.capture().emit('inspect', deliver, true);
      notifications.capture().emit('inspect', deliver, force);
    });
    expect(sent).toEqual(['a']);
  });

  it('deduplicates geometry changes and refreshes exact snapshot, series and pin identities', () => {
    const { state, notifications, deliver, sent } = fixture();
    notifications.capture().emit('select', deliver);
    state.select.target = target('a');
    expect(notifications.capture().emit('select', deliver)).toBe(false);
    state.snapshot = {};
    notifications.capture().emit('select', deliver);
    state.select.series = 'second';
    notifications.capture().emit('select', deliver);
    expect(sent).toEqual(['a', 'a', 'a']);
    notifications.capture().emit('inspect', deliver);
    state.inspect.pinned = true;
    expect(notifications.capture().emit('inspect', deliver)).toBe(true);
  });

  it('clears the last delivered selection once even after a silent loading transaction', () => {
    const { state, notifications, deliver, sent } = fixture();
    notifications.capture().emit('select', deliver);
    notifications.invalidate();
    state.select.target = null;
    state.snapshot = {};
    const cleared = notifications.capture();
    expect(cleared.emit('select', deliver)).toBe(true);
    expect(cleared.current('select')).toBe(true);
    state.snapshot = {};
    expect(notifications.capture().emit('select', deliver)).toBe(false);
    expect(sent).toEqual(['a', 'null']);
  });

  it('discards an old selection after an inspect callback clears both channels', () => {
    const { state, notifications, deliver, sent } = fixture();
    notifications.capture().emit('select', deliver);
    state.snapshot = {};
    const pending = notifications.capture();
    pending.emit('inspect', () => {
      state.inspect.target = state.select.target = null;
      const cleared = notifications.capture();
      cleared.emit('inspect', deliver);
      cleared.emit('select', deliver);
    });
    expect(pending.emit('select', deliver)).toBe(false);
    expect(pending.current('inspect')).toBe(false);
    expect(pending.current('select')).toBe(false);
    expect(sent).toEqual(['a', 'null', 'null']);
  });

  it('retains a pending selection while a nested hover updates only inspection', () => {
    const { state, notifications, deliver, sent } = fixture();
    const pending = notifications.capture();
    pending.emit('inspect', () => {
      state.inspect.target = target('b');
      notifications.capture().emit('inspect', deliver);
    });
    expect(pending.current('inspect')).toBe(false);
    expect(pending.current('select')).toBe(true);
    expect(pending.emit('select', deliver)).toBe(true);
    expect(sent).toEqual(['b', 'a']);
  });

  it('finishes broadcasting to every observer before delivering a nested clear', () => {
    const { state, notifications } = fixture();
    const first: (string | null)[] = [];
    const second: (string | null)[] = [];
    const broadcast = (value: { target: ChartInteraction<string> | null }) => {
      const key = value.target?.key ?? null;
      first.push(key);
      if (key) {
        state.select.target = null;
        notifications.invalidate('select');
        notifications.capture().emit('select', broadcast);
      }
      second.push(key);
    };
    notifications.capture().emit('select', broadcast);
    expect(first).toEqual(['a', null]);
    expect(second).toEqual(first);
  });

  it('revalidates queued reports and keeps only the latest nested state', () => {
    const { state, notifications, deliver, sent } = fixture();
    notifications.capture().emit('select', () => {
      state.select.target = target('b');
      notifications.capture().emit('select', deliver);
      state.select.target = target('c');
      notifications.capture().emit('select', deliver);
      expect(sent).toEqual([]);
    });
    expect(sent).toEqual(['c']);
  });

  it('cancels queued deliveries and releases the reader on permanent disposal', () => {
    const { state, notifications, deliver, sent, read } = fixture();
    const pending = notifications.capture();
    notifications.capture().emit('inspect', () => {
      state.select.target = target('b');
      notifications.capture().emit('select', deliver);
      notifications.dispose();
      read.mockImplementation(() => {
        throw new Error('Disposed reader');
      });
      expect(pending.emit('select', deliver)).toBe(false);
      expect(notifications.capture().emit('inspect', deliver)).toBe(false);
    });
    expect(sent).toEqual([]);
  });

  it('drains pending state and releases the broadcast boundary when a callback throws', () => {
    const { state, notifications, deliver, sent } = fixture();
    expect(() =>
      notifications.capture().emit('select', () => {
        state.select.target = null;
        notifications.capture().emit('select', deliver);
        throw new Error('Host failure');
      })
    ).toThrow('Host failure');
    expect(sent).toEqual(['null']);
    state.select.target = target('b');
    notifications.capture().emit('select', deliver);
    expect(sent).toEqual(['null', 'b']);
  });

  it.each([
    'inspect',
    'select'
  ] as const)('drains the other channel when a queued %s callback throws', (channel) => {
    const { state, notifications, deliver, sent } = fixture();
    const other = channel === 'inspect' ? 'select' : 'inspect';
    const initial = notifications.capture();
    initial.emit('inspect', deliver);
    initial.emit('select', deliver);
    sent.length = 0;
    const error = new Error('Queued failure');
    expect(() =>
      notifications.capture().emit(
        'inspect',
        () => {
          state.inspect.target = state.select.target = null;
          notifications.invalidate();
          const cleared = notifications.capture();
          cleared.emit(channel, () => {
            throw error;
          });
          cleared.emit(other, deliver);
        },
        true
      )
    ).toThrow(error);
    expect(sent).toEqual(['null']);
    expect(notifications.capture().emit(channel, deliver)).toBe(false);
    expect(notifications.capture().emit(other, deliver)).toBe(false);
    state[other].target = target('b');
    notifications.capture().emit(other, deliver);
    expect(sent).toEqual(['null', 'b']);
  });

  it.each([
    new Error('Outer failure'),
    undefined
  ])('preserves the first thrown value (%s) and drains work added by a failing queued callback', (error) => {
    const { state, notifications, deliver, sent } = fixture();
    const caught = vi.fn();
    try {
      notifications.capture().emit('select', () => {
        notifications.capture().emit('inspect', () => {
          state.select.target = null;
          notifications.capture().emit('select', deliver);
          throw new Error('Queued failure');
        });
        throw error;
      });
    } catch (value) {
      caught(value);
    }
    expect(caught).toHaveBeenCalledExactlyOnceWith(error);
    expect(sent).toEqual(['null']);
  });

  it('revalidates reports after earlier control effects replace their state', () => {
    const { state, interaction, notifications, sent, deliver } = fixture();
    interaction.batch(() => {
      const pending = notifications.capture();
      pending.emit('select', deliver);
      interaction.effect(
        () => {
          state.select.target = null;
          notifications.capture().emit('select', deliver);
        },
        {},
        controlsPhase
      );
    });
    expect(sent).toEqual([]);
    expect(notifications.capture().emit('select', deliver)).toBe(false);
  });

  it('cancels requests before paint and permits independent reading invalidation', () => {
    const { notifications, deliver } = fixture();
    const changed = notifications.capture();
    notifications.invalidate();
    expect(changed.emit('select', deliver)).toBe(false);
    const hidden = notifications.capture();
    notifications.invalidate('inspect');
    expect(hidden.emit('inspect', deliver)).toBe(false);
    expect(hidden.emit('select', deliver)).toBe(true);
  });

  it('supports forced pointer reports without repeating selection notifications', () => {
    const { notifications, deliver, sent } = fixture();
    const initial = notifications.capture();
    initial.emit('inspect', deliver);
    initial.emit('select', deliver);
    const pointer = notifications.capture();
    pointer.emit('inspect', deliver, true);
    expect(pointer.emit('select', deliver)).toBe(false);
    expect(sent).toEqual(['a', 'a', 'a']);
  });
});
