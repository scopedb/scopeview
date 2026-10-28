import { describe, expect, it } from 'vitest';
import {
  ChartLinkGroup,
  type ChartLinkUpdate,
  type ChartLinkState
} from '../../../src/core/link-group.js';

describe('headless link coordination', () => {
  it('shares exact time and explicit entity namespaces, isolates snapshots and excludes the origin', () => {
    const group = new ChartLinkGroup(),
      a: ChartLinkUpdate[] = [],
      b: ChartLinkUpdate[] = [];
    const metric = group.connect('metric', (update) => a.push(update));
    group.connect('trace', (update) => b.push(update));
    metric.cursor('1790643600000000001');
    metric.window({ startTimeNs: '1790643600000000001', endTimeNs: '1790643600000000002' });
    metric.select({ namespace: 'operation', id: 'decode' });
    expect(a).toHaveLength(1);
    expect(b.at(-1)?.state.window).toEqual({
      startTimeNs: '1790643600000000001',
      endTimeNs: '1790643600000000002'
    });
    expect(b.at(-1)?.state.selection).toEqual({ namespace: 'operation', id: 'decode' });
    b.at(-1)!.state.selection!.id = 'mutated';
    expect(group.state.selection!.id).toBe('decode');
    const state = group.state;
    state.window!.startTimeNs = '0';
    expect(group.state.window!.startTimeNs).toBe('1790643600000000001');
  });
  it('deduplicates equivalent updates and handles synchronous echoes without recursion', () => {
    const group = new ChartLinkGroup();
    let events = 0;
    const a = group.connect('a', () => {});
    const b = group.connect('b', () => {
      events++;
      if (events > 1) b.cursor('001');
    });
    a.cursor('1');
    a.cursor('01');
    expect(events).toBe(2);
    expect(group.state.cursorTimeNs).toBe('1');
  });
  it('only lets the most recent cursor owner clear it, including disconnect and stale handles', () => {
    const group = new ChartLinkGroup();
    const a = group.connect('a', () => {}),
      b = group.connect('b', () => {});
    a.cursor('1');
    b.cursor('2');
    a.cursor(null);
    expect(group.state.cursorTimeNs).toBe('2');
    a.disconnect();
    expect(group.state.cursorTimeNs).toBe('2');
    b.disconnect();
    expect(group.state.cursorTimeNs).toBeNull();
    b.cursor('3');
    expect(group.state.cursorTimeNs).toBeNull();
  });
  it('restores to every peer, rejects invalid messages atomically and retains durable window after unmount', () => {
    const group = new ChartLinkGroup();
    const a = group.connect('a', () => {});
    group.state = {
      cursorTimeNs: null,
      selection: { namespace: 'span', id: 'scan' },
      window: { startTimeNs: '1', endTimeNs: '2' }
    };
    const previous = group.state;
    expect(() => a.window({ startTimeNs: '2', endTimeNs: '1' })).toThrow();
    expect(() => a.cursor('1.1')).toThrow();
    expect(() => {
      group.state = { cursorTimeNs: null } as ChartLinkState;
    }).toThrow();
    expect(() => {
      group.state = { cursorTimeNs: null, window: null } as ChartLinkState;
    }).toThrow();
    expect(group.state).toEqual(previous);
    a.disconnect();
    expect(group.state).toEqual(previous);
  });
  it('delivers to healthy peers even when a receiver throws and cleans up failed connections', () => {
    const group = new ChartLinkGroup(),
      values: ChartLinkUpdate[] = [];
    expect(() =>
      group.connect('bad', () => {
        throw new Error('Connect failure');
      })
    ).toThrow();
    group.connect('bad', (update) => {
      if (update.origin) throw new Error('Receive failure');
    });
    group.connect('healthy', (update) => values.push(update));
    const sender = group.connect('sender', () => {});
    expect(() => sender.cursor('1')).toThrow(AggregateError);
    expect(values.at(-1)?.state.cursorTimeNs).toBe('1');
  });
});
