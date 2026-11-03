import { describe, expect, it, vi } from 'vitest';
import {
  Interaction,
  channel,
  controlsPhase,
  readingPhase,
  viewportPhase,
  viewStatePhase,
  readyPhase
} from '../../../src/core/interaction.js';

describe('interaction transactions', () => {
  it("uses each channel's fixed public delivery order regardless of enqueue order", () => {
    const interaction = new Interaction();
    const delivered: string[] = [];
    interaction.batch(() => {
      for (const [name, phase] of [
        ['ready', readyPhase],
        ['state', viewStatePhase],
        ['viewport', viewportPhase],
        ['reading', readingPhase],
        ['controls', controlsPhase]
      ] as const) {
        interaction.report(
          channel(false, Object.is, phase),
          true,
          () => true,
          () => delivered.push(name)
        );
      }
      interaction.effect(() => delivered.push('presentation'));
    });
    expect(delivered).toEqual([
      'presentation',
      'controls',
      'reading',
      'viewport',
      'state',
      'ready'
    ]);
  });

  it('deduplicates acknowledgements and finishes each broadcast before its nested successor', () => {
    const interaction = new Interaction();
    let state = 0;
    const reports = channel<number>(0, Object.is);
    const early: number[] = [],
      late: number[] = [];
    const commit = (value: number) =>
      interaction.batch(() => {
        state = value;
        interaction.report(
          reports,
          value,
          () => state === value,
          (value) => {
            early.push(value);
            commit(value);
            if (value === 1) {
              commit(2);
              commit(3);
            }
            late.push(value);
          }
        );
      });
    commit(1);
    expect(state).toBe(3);
    expect(early).toEqual([1, 3]);
    expect(late).toEqual(early);
  });

  it('rejects stale keyed effects before they can replace a valid projection', () => {
    const interaction = new Interaction(),
      key = {};
    const seen: string[] = [];
    interaction.batch(() => {
      interaction.effect(
        () => seen.push('current'),
        key,
        0,
        () => true
      );
      expect(
        interaction.effect(
          () => seen.push('stale'),
          key,
          0,
          () => false
        )
      ).toBe(false);
    });
    expect(seen).toEqual(['current']);
  });

  it('bounds changing-value feedback and schedules remaining work even when an observer throws', () => {
    vi.useFakeTimers();
    try {
      const interaction = new Interaction();
      const reports = channel<number>(0, Object.is);
      let value = 0;
      const deliver = (next: number) => {
        value = next;
        if (next < 200) interaction.report(reports, next + 1, () => true, deliver);
        if (next === 1) throw undefined;
      };
      let failed = false;
      try {
        interaction.report(reports, 1, () => true, deliver);
      } catch (error) {
        failed = true;
        expect(error).toBeUndefined();
      }
      expect(failed).toBe(true);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(200);
      expect(vi.getTimerCount()).toBe(1);
      vi.runAllTimers();
      expect(value).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('orders geometry, controls and readings before a viewport report, discarding a superseded window', () => {
    const interaction = new Interaction();
    let state = 1;
    const reports = channel<number>(0, Object.is, viewportPhase);
    const sent: number[] = [];
    interaction.batch(() => {
      interaction.report(
        reports,
        1,
        () => state === 1,
        (value) => sent.push(value)
      );
      interaction.effect(
        () => {
          state = 2;
          interaction.report(
            reports,
            2,
            () => state === 2,
            (value) => sent.push(value)
          );
        },
        {},
        readingPhase
      );
    });
    expect(sent).toEqual([2]);
  });
});
