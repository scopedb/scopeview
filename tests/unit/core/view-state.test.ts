import { describe, expect, it } from 'vitest';
import {
  parseViewState,
  reconcileViewState,
  type HierarchyViewState
} from '../../../src/core/view-state.js';

const state: HierarchyViewState = {
  version: 1,
  kind: 'trace',
  pinnedKey: 'trace:scan',
  viewport: { start: 0.2, end: 0.7, scrollOffset: 240 },
  collapsed: ['plan', 'missing', 'plan']
};
describe('durable view state contract', () => {
  it('round trips JSON, copies nested state and canonicalizes duplicate identities', () => {
    const restored = parseViewState(JSON.parse(JSON.stringify(state)));
    expect(restored).toEqual({ ...state, collapsed: ['missing', 'plan'] });
    if (restored.kind === 'metric') throw new Error('Wrong family');
    restored.viewport.start = 0;
    restored.collapsed.push('other');
    expect(state.viewport.start).toBe(0.2);
    expect(state.collapsed).not.toContain('other');
  });
  it('drops missing pins and collapsed identities without selecting another node', () => {
    expect(
      reconcileViewState(state, {
        interactionKeys: new Set(['trace:plan']),
        collapsibleIds: new Set(['plan'])
      })
    ).toEqual({ ...state, pinnedKey: null, collapsed: ['plan'] });
    expect(
      reconcileViewState(
        { version: 1, kind: 'metric', pinnedKey: 'time:123', hiddenSeries: ['API', 'Missing'] },
        {
          interactionKeys: new Set(['time:123']),
          seriesNames: new Set(['API'])
        }
      ).hiddenSeries
    ).toEqual(['API']);
  });
  it.each([
    { ...state, version: 2 },
    { ...state, future: true },
    { ...state, viewport: { ...state.viewport, zoom: 2 } },
    { ...state, hiddenSeries: [] },
    { ...state, kind: 'unknown' },
    { ...state, pinnedKey: 12 },
    { ...state, collapsed: ['plan', 12] },
    ...[
      { start: 0, end: Infinity, scrollOffset: 0 },
      { start: 0.2, end: 0.2, scrollOffset: 0 },
      { start: -0.1, end: 0.5, scrollOffset: 0 },
      { start: 0, end: 1.1, scrollOffset: 0 },
      { start: 0, end: 1, scrollOffset: -1 }
    ].map((viewport) => ({ ...state, viewport }))
  ])('rejects malformed saved state without silently repairing its meaning', (input) => {
    expect(() => parseViewState(input)).toThrow(/viewState/);
  });
});
