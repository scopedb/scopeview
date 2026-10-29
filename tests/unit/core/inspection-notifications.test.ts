import { describe, expect, it, vi } from 'vitest';
import {
  InspectionNotifications,
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
  const notifications = new InspectionNotifications(read);
  const sent: string[] = [];
  const deliver = (value: { target: ChartInteraction<string> | null }) =>
    sent.push(value.target?.key ?? 'null');
  return { a, state, read, notifications, sent, deliver };
}

describe('inspection notifications', () => {
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
    expect(pending.current()).toBe(false);
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

  it('cancels queued deliveries on disposal', () => {
    const { state, notifications, deliver, sent } = fixture();
    notifications.capture().emit('inspect', () => {
      state.select.target = target('b');
      notifications.capture().emit('select', deliver);
      notifications.dispose();
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

  it('revalidates after control callbacks and does not commit superseded reports', () => {
    const { state, notifications, deliver, sent } = fixture();
    const pending = notifications.capture();
    expect(
      pending.emit('select', deliver, {
        before: () => {
          state.select.target = null;
          notifications.capture().emit('select', deliver);
        }
      })
    ).toBe(false);
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
    pointer.emit('inspect', deliver, { force: true });
    expect(pointer.emit('select', deliver)).toBe(false);
    expect(sent).toEqual(['a', 'a', 'a']);
  });

  it('silences pending work and releases the reader on permanent disposal', () => {
    const { notifications, deliver, read } = fixture();
    const pending = notifications.capture();
    notifications.dispose();
    read.mockImplementation(() => {
      throw new Error('Disposed reader');
    });
    expect(pending.emit('select', deliver)).toBe(false);
    expect(notifications.capture().emit('inspect', deliver)).toBe(false);
  });
});
