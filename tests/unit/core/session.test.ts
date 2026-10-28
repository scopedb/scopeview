import { describe, expect, it } from 'vitest';
import { ChartSession } from '../../../src/core/session.js';
import type { ChartInteraction, RenderModel } from '../../../src/core/scene.js';

function readingModel(): RenderModel {
  const interactions = ['first', 'second', 'last'].map((key) => ({
    key,
    sources: [[key, '1']],
    tooltip: { rows: [] }
  }));
  return {
    interactions,
    interactionByKey: new Map(interactions.map((value) => [value.key, value])),
    ariaLabel: 'Readings'
  };
}

describe('shared headless chart session', () => {
  it('tracks pointer feedback independently of a frozen pin and reconciles it by identity', () => {
    const session = new ChartSession(),
      before = readingModel(),
      after = readingModel();
    session.setModel(before);
    session.inspect('first', true);
    expect(session.inspect('second')).toBe(false);
    expect(session.active).toBe(before.interactions[0]);
    expect(session.selected).toBe(before.interactions[0]);
    expect(session.hovered).toBe(before.interactions[1]);
    session.setModel(after);
    expect(session.hovered).toBe(after.interactions[1]);
    expect(session.active).toBe(after.interactions[0]);
    expect(session.inspect(null)).toBe(false);
    expect(session.hovered).toBeNull();
    expect(session.pinned).toBe(true);
    session.inspect('second');
    session.setModel({ ...after, interactionByKey: new Map([['first', after.interactions[0]]]) });
    expect(session.hovered).toBeNull();
    expect(session.pinned).toBe(true);
    session.setModel(after);
    session.inspect('second');
    session.inspect('last', true);
    expect(session.hovered).toBeNull();
    expect(session.selected).toBe(after.interactions[2]);
    session.inspect('second');
    session.inspect('first', false, true);
    expect(session.hovered).toBeNull();
    expect(session.pinned).toBe(false);
    session.inspect('second');
    session.clearInspection();
    expect(session.hovered).toBeNull();
  });
  it('compares hover with selection, restores the selected reading on leave and locks independently', () => {
    const session = new ChartSession('compare'),
      model = readingModel();
    session.setModel(model);
    session.inspect('first', true);
    session.inspect('second');
    expect(session.active?.key).toBe('second');
    expect(session.selected?.key).toBe('first');
    expect(session.pinned).toBe(false);
    session.inspect(null);
    expect(session.active?.key).toBe('first');
    expect(session.pinned).toBe(true);
    session.lockTooltip(true);
    expect(session.inspect('second')).toBe(false);
    expect(session.active?.key).toBe('first');
    session.lockTooltip(false);
    session.inspect('second');
    session.setModel({ ...model, interactionByKey: new Map([['first', model.interactions[0]]]) });
    expect(session.active?.key).toBe('first');
    expect(session.selected?.key).toBe('first');
    session.inspect('first', true);
    expect(session.active).toBeNull();
    expect(session.selected).toBeNull();
  });
  it('preserves a pin by identity through model replacement and uses the new source snapshot', () => {
    const session = new ChartSession(),
      before = readingModel(),
      after = readingModel();
    session.setModel(before);
    const first = before.interactions[0];
    session.inspect(first.key, true);
    expect(session.inspect(before.interactions[1].key)).toBe(false);
    expect(session.inspect(null)).toBe(false);
    expect(session.active).toBe(first);
    session.setModel(after);
    expect(session.pinned).toBe(true);
    expect(session.active).toBe(after.interactions[0]);
    expect(session.active!.sources).toEqual(first.sources);
    expect(session.active!.sources[0]).not.toBe(first.sources[0]);
    session.inspect(first.key, true);
    expect(session.active).toBeNull();
    expect(session.pinned).toBe(false);
  });

  it('shares canonical keyboard order, wraparound and inspection while pinned', () => {
    const session = new ChartSession(),
      model = readingModel();
    session.setModel(model);
    expect(session.next('Home')).toBe(model.interactions[0]);
    expect(session.next('previous')).toBe(model.interactions.at(-1));
    session.inspect(session.next('End')!.key, true, true);
    const first = session.next('next')!;
    expect(first).toBe(model.interactions[0]);
    session.inspect(first.key, false, true);
    expect(session.pinned).toBe(false);
    expect(session.next('next')).toBe(model.interactions[1]);
    expect(session.next('previous')).toBe(model.interactions.at(-1));
    expect(session.inspect(null)).toBe(false);
    expect(session.active).toBe(first);
    session.clearInspection();
    expect(session.keyboardInspection).toBe(false);
  });

  it('clears stale targets when a new model omits them or the surface disconnects', () => {
    const session = new ChartSession(),
      model = readingModel();
    session.setModel(model);
    session.inspect(model.interactions[0].key, true);
    session.setModel({ interactions: [], interactionByKey: new Map(), ariaLabel: 'Empty' });
    expect(session.active).toBeNull();
    expect(session.pinned).toBe(false);
    expect(session.next('next')).toBeNull();
    session.setModel(model);
    session.inspect(model.interactions[0].key, true);
    session.setModel(null);
    expect(session.active).toBeNull();
    expect(session.next('Home')).toBeNull();
  });

  it('owns visibility snapshots, isolates by identity and resets with a new document', () => {
    const session = new ChartSession(),
      names = ['api', 'ingest', 'worker'];
    session.toggleSeries('api', names);
    expect([...session.hidden]).toEqual(['api']);
    session.hidden.clear();
    expect([...session.hidden]).toEqual(['api']);
    session.toggleSeries('api', names);
    expect(session.hidden.size).toBe(0);
    session.toggleSeries('ingest', names, true);
    expect([...session.hidden]).toEqual(['api', 'worker']);
    session.toggleSeries('absent', names, true);
    expect([...session.hidden]).toEqual(['api', 'worker']);
    session.showAll();
    expect(session.hidden.size).toBe(0);
    session.setModel(readingModel());
    session.inspect(session.next('Home')!.key, true);
    session.toggleSeries('api', names);
    session.reset();
    expect(session.active).toBeNull();
    expect(session.pinned).toBe(false);
    expect(session.hidden.size).toBe(0);
    expect(session.next('Home')).toBeNull();
  });

  it('preserves typed span identity without requiring result rows or timestamp conversion', () => {
    const source = { spanId: 'root', startNs: '1790647200000000001', endNs: '1790647200000000002' };
    const target: ChartInteraction<typeof source> = {
      key: 'span:root',
      sources: [source],
      tooltip: { title: 'Root span', rows: [{ label: 'Duration', value: '1 ns' }] }
    };
    const model: RenderModel<typeof source> = {
      interactions: [target],
      interactionByKey: new Map([[target.key, target]]),
      ariaLabel: 'Trace'
    };
    const session = new ChartSession<typeof source>();
    session.setModel(model);
    session.inspect(session.next('Home')!.key, true, true);
    expect(session.active!.sources[0]).toBe(source);
    expect(session.active!.sources[0].startNs).toBe('1790647200000000001');
  });
  it('restoring the same pin is idempotent and restores only a current source', () => {
    const session = new ChartSession<{ id: string }>();
    const target = { key: 'trace:scan', sources: [{ id: 'scan' }], tooltip: { rows: [] } };
    session.setModel({
      interactions: [target],
      interactionByKey: new Map([[target.key, target]]),
      ariaLabel: ''
    });
    session.restorePin(target.key);
    session.restorePin(target.key);
    expect(session.pinned).toBe(true);
    expect(session.active).toBe(target);
    session.restorePin('missing');
    expect(session.active).toBeNull();
    expect(session.pinned).toBe(false);
  });
});
