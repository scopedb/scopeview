import { shareReading, releaseReading } from '../../../src/core/reading-state.js';
import {
  compileProfile,
  createProfileView,
  type CompiledProfile
} from '../../../src/families/profile.js';
import type { Entity } from '../../../src/families/hierarchy/model.js';
import { describe, expect, it, vi } from 'vitest';
import {
  Interaction,
  channel,
  interactionFor,
  shareInteraction,
  claimInteraction,
  controlsPhase,
  readingPhase,
  viewportPhase,
  viewStatePhase,
  readyPhase
} from '../../../src/core/interaction.js';
import { InspectionNotifications } from '../../../src/core/inspection-notifications.js';
import { ChartSession } from '../../../src/core/session.js';
import { HierarchyInteraction } from '../../../src/families/hierarchy/interaction.js';
import { compileTrace, createTraceView, type CompiledTrace } from '../../../src/families/trace.js';

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

  it('consumes a Canvas provider once and detaches borrowed facades without resetting the host', () => {
    const parent = new ChartSession<string>();
    const target = { key: 'a', sources: ['a'], tooltip: { rows: [] } };
    parent.setModel({
      interactions: [target],
      interactionByKey: new Map([['a', target]]),
      ariaLabel: 'a'
    });
    parent.inspect('a', true);
    const canvas = {},
      facade = new ChartSession<string>();
    shareInteraction(canvas, interactionFor(parent));
    claimInteraction(facade, canvas);
    shareReading(facade, parent);
    expect(facade.selected).toBe(parent.selected);
    releaseReading(facade);
    facade.reset();
    expect(parent.selected).toBe(target);
    expect(facade.selected).toBeNull();
    const next = new ChartSession<string>();
    claimInteraction(next, canvas);
    expect(next.selected).toBeNull();
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

  // This reference tracks only the last accepted semantic action. It does not reproduce layout.
  it.each(
    (['trace', 'profile'] as const).flatMap((family) =>
      Array.from({ length: 24 }, (_, index) => ({ family, seed: index + 1 }))
    )
  )('matches a last-intent model across generated nested commands ($family, seed $seed)', ({
    family,
    seed
  }) => {
    let random = seed;
    const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
    const session = new ChartSession<Entity>();
    const hierarchy = new HierarchyInteraction<Entity, CompiledTrace | CompiledProfile>(
      session,
      (compiled, collapsed) =>
        compiled.kind === 'trace'
          ? createTraceView(compiled, collapsed)
          : createProfileView(compiled, collapsed)
    );
    const interaction = interactionFor(session);
    const compiled = () => {
      const nodes = Array.from({ length: 30 }, (_, i) => ({
        id: `${i}`,
        name: `${i}`,
        ...(i ? { parentId: `${i - 1}` } : {})
      }));
      return family === 'trace'
        ? compileTrace({
            version: 1,
            kind: family,
            spans: nodes.map((node) => ({ ...node, startTimeNs: '0', endTimeNs: `${seed}` }))
          })
        : compileProfile({
            version: 1,
            kind: family,
            unit: 'samples',
            frames: nodes.map((node) => ({ ...node, selfWeight: `${seed}` }))
          });
    };
    hierarchy.replace(compiled());
    hierarchy.activate();
    hierarchy.measure(120, 'full');
    let active: string | null = null,
      selected: string | null = null;
    let revision = 0;
    const reports = new InspectionNotifications(
      () => ({
        snapshot: hierarchy.compiled,
        inspect: { target: session.active, pinned: session.pinned },
        select: { target: session.selected }
      }),
      interaction
    );
    const check = () => {
      expect(session.active?.key ?? null).toBe(active);
      expect(session.selected?.key ?? null).toBe(selected);
      if (session.active)
        expect(session.active.sources[0]).toBe(
          hierarchy.compiled!.hierarchy.byId.get(session.active.sources[0].id)
        );
    };
    const command = (choice: number) => {
      revision++;
      if (choice % 6 === 0) {
        hierarchy.dismiss();
        active = selected = null;
      } else if (choice % 6 === 1) {
        hierarchy.replace(compiled());
        active = selected = null;
      } else if (choice % 6 === 2) {
        hierarchy.viewport.set({ start: 0, end: 1, scrollOffset: choice % 300 });
      } else if (choice % 6 === 3) {
        const key = `${family}:${choice % 30}`;
        hierarchy.restore({
          version: 1,
          kind: family,
          pinnedKey: key,
          collapsed: [],
          viewport: { ...hierarchy.viewport.state }
        });
        active = selected = key;
      } else {
        if (choice % 7 === 0) {
          hierarchy.collapse(['0']);
          selected = selected === `${family}:0` ? selected : null;
          active = active === `${family}:0` ? active : selected;
        }
        const id = `${choice % 30}`,
          pin = choice % 2 === 0;
        hierarchy.focus(id, pin);
        const key = `${family}:${id}`;
        if (pin && selected === key) active = selected = null;
        else {
          active = key;
          selected = pin ? key : null;
        }
      }
      if (choice % 11 === 0) {
        const saved = selected;
        const collapsed = [...hierarchy.collapsed];
        const viewport = { ...hierarchy.viewport.state };
        hierarchy.deactivate();
        active = selected = null;
        hierarchy.restore({ version: 1, kind: family, pinnedKey: saved, collapsed, viewport });
        hierarchy.focus('29', true);
        check();
        hierarchy.activate();
        active = selected = saved;
      }
      hierarchy.measure(choice % 3 ? (choice % 2 ? 120 : 240) : 0, 'full');
      check();
    };
    for (let step = 0; step < 60; step++) {
      interaction.batch(() => {
        command(next());
        const accepted = revision;
        reports.capture().emit('inspect', () => {
          if (revision === accepted && next() % 3 === 0) {
            command(next());
            reports.capture().emit('select', check);
          }
        });
      });
      check();
    }
  });
});
