import { describe, expect, it } from 'vitest';
import { SceneHitIndex } from '../../../src/core/hit-test.js';
import type { ChartScene, SceneMark } from '../../../src/core/scene.js';

function scene(marks: SceneMark[]): ChartScene<{ id: string }> {
  const interactions = [...new Set(marks.flatMap((mark) => (mark.key ? [mark.key] : [])))].map(
    (key) => ({
      key,
      sources: [{ id: key }],
      tooltip: { rows: [] },
      anchor: { x: 0, y: 0 },
      points: []
    })
  );
  return {
    width: 300,
    height: 200,
    rect: null,
    marks,
    hitMode: 'item',
    xTicks: [],
    yTicks: [],
    interactions,
    interactionByKey: new Map(interactions.map((value) => [value.key, value])),
    ariaLabel: 'Test'
  };
}

describe('renderer-independent item inspection', () => {
  it('discloses all overlapping point sources in paint order without replacing the winner', () => {
    const model = scene([
      { kind: 'circle', key: 'one', x: 64, y: 60, radius: 5, fill: '#fff' },
      { kind: 'circle', key: 'two', x: 67, y: 60, radius: 20, fill: '#f00' },
      { kind: 'circle', key: 'empty', x: 64, y: 60, radius: 0, fill: '#fff' }
    ]);
    model.emphasis = 'point';
    model.clipRect = { x: 60, y: 20, width: 130, height: 100 };
    const index = new SceneHitIndex(model),
      p = { x: 65, y: 60 };
    expect(index.pointHits(p)).toEqual([model.interactions[0], model.interactions[1]]);
    expect(index.hit(p)).toBe(model.interactions[1]);
    expect(index.pointHits({ x: 59, y: 60 })).toEqual([]);
    expect(index.pointHits({ x: 70, y: 60 })).toEqual([model.interactions[1]]);
    model.interactionByKey.delete('two');
    expect(index.pointHits(p)).toEqual([model.interactions[0]]);
    model.interactive = false;
    expect(index.pointHits(p)).toEqual([]);
  });
  it('retains every source in a dense collision and keeps this policy specific to points', () => {
    const model = scene(
      Array.from({ length: 1000 }, (_, i) => ({
        kind: 'circle' as const,
        key: String(i),
        x: 64,
        y: 60,
        radius: 5,
        fill: '#fff'
      }))
    );
    const index = new SceneHitIndex(model),
      p = { x: 64, y: 60 };
    expect(index.pointHits(p)).toEqual([]);
    model.emphasis = 'point';
    expect(index.pointHits(p)).toEqual(model.interactions);
    expect(index.hit(p)).toBe(model.interactions.at(-1));
  });
  it('covers a rectangular reading row across index cells without widening its time interval', () => {
    const model = scene([
      { kind: 'rect', key: 'span', x: 20, y: 60, width: 80, height: 2, fill: '#fff' },
      { kind: 'rect', key: 'zero', x: 140, y: 60, width: 0, height: 2, fill: '#fff' }
    ]);
    model.interactionByKey.get('span')!.hitRect = { x: 20, y: 60, width: 80, height: 10 };
    model.interactionByKey.get('zero')!.hitRect = { x: 140, y: 60, width: 20, height: 10 };
    model.clipRect = { x: 0, y: 0, width: 300, height: 69 };
    const index = new SceneHitIndex(model);
    expect(index.hit({ x: 50, y: 68 })?.sources).toEqual([{ id: 'span' }]);
    expect(index.hit({ x: 19, y: 68 })).toBeNull();
    expect(index.hit({ x: 101, y: 68 })).toBeNull();
    expect(index.hit({ x: 50, y: 70 })).toBeNull();
    expect(index.hit({ x: 145, y: 68 })).toBeNull();
  });
  it('chooses the last painted primitive and returns the original source-linked target', () => {
    const model = scene([
        { kind: 'rect', key: 'row', x: 5, y: 5, width: 130, height: 40, fill: 'transparent' },
        { kind: 'circle', key: 'point', x: 65, y: 25, radius: 8, fill: '#fff' },
        { kind: 'text', key: 'label', x: 65, y: 25, text: 'Label', fill: '#000' }
      ]),
      index = new SceneHitIndex(model);
    expect(index.hit({ x: 65, y: 25 })).toBe(model.interactionByKey.get('point'));
    expect(index.hit({ x: 74, y: 25 })).toBe(model.interactionByKey.get('row'));
    expect(index.hit({ x: 170, y: 25 })).toBeNull();
  });
  it('uses exact circle bounds across index cells and respects expanded clip bounds', () => {
    const model = scene([{ kind: 'circle', key: 'edge', x: 64, y: 60, radius: 6, fill: '#fff' }]);
    model.rect = { x: 65, y: 20, width: 120, height: 100 };
    model.clipRect = { x: 60, y: 20, width: 130, height: 100 };
    const index = new SceneHitIndex(model);
    expect(index.hit({ x: 60, y: 60 })?.key).toBe('edge');
    expect(index.hit({ x: 59, y: 60 })).toBeNull();
    expect(index.hit({ x: 70.5, y: 60 })?.key).toBe('edge');
    expect(index.hit({ x: 70, y: 66 })).toBeNull();
  });
  it('preserves draw order between indexed items and exact path hits', () => {
    const model = scene([
        { kind: 'path', key: 'back', d: 'M0 0', fill: '#fff' },
        { kind: 'rect', key: 'front', x: 0, y: 0, width: 100, height: 100, fill: '#fff' },
        { kind: 'path', key: 'hole', d: 'M1 1', fill: '#fff' }
      ]),
      index = new SceneHitIndex(model);
    expect(index.hit({ x: 10, y: 10 }, (mark) => mark.key === 'back')?.key).toBe('front');
    expect(index.hit({ x: 10, y: 10 }, () => true)?.key).toBe('hole');
    expect(index.hit({ x: 150, y: 10 }, (mark) => mark.key === 'back')?.key).toBe('back');
  });
  it('does not invent area for zero-size items or inspect decorative/outside marks', () => {
    const model = scene([
      { kind: 'rect', key: 'zero', x: 10, y: 10, width: 0, height: 20, fill: '#fff' },
      { kind: 'rect', key: 'none', x: 10, y: 10, width: 20, height: 20, fill: 'none' },
      { kind: 'circle', key: 'outside', x: 310, y: 20, radius: 20, fill: '#fff' }
    ]);
    expect(new SceneHitIndex(model).hit({ x: 10, y: 20 })).toBeNull();
    expect(new SceneHitIndex(model).hit({ x: 305, y: 20 })).toBeNull();
    model.interactive = false;
    expect(new SceneHitIndex(model).hit({ x: 295, y: 20 })).toBeNull();
  });
});
