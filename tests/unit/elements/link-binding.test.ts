import { describe, expect, it } from 'vitest';
import { ChartLinkGroup, type LinkedHighlight } from '../../../src/core/link-group.js';
import { bindChartLinks } from '../../../src/elements/link-binding.js';

// The binding uses universal EventTarget/AbortController primitives; no rendered browser
// is needed to verify event arbitration, current-state projection and cleanup.
class Target extends EventTarget {
  highlight: LinkedHighlight | null = null;
  get linkedHighlight() {
    return this.highlight;
  }
  set linkedHighlight(value: LinkedHighlight | null) {
    this.highlight = value;
    this.dispatchEvent(new CustomEvent('scope-inspect', { detail: { time: '99' } }));
  }
}
describe('thin chart link binding', () => {
  it('does not publish projection events or ready re-projection back into the group', () => {
    const group = new ChartLinkGroup(),
      target = new Target();
    let received = 0,
      projected = 0;
    const binding = bindChartLinks<{ time: string }>(target, group, {
      id: 'chart',
      cursor: (detail) => detail.time,
      project: ({ state }) => {
        projected++;
        return { inspectionKey: null, cursor: state.cursorTimeNs === '1' ? 0.5 : null };
      },
      receive: () => {
        received++;
      }
    });
    const peer = group.connect('peer', () => {});
    peer.cursor('1');
    expect(group.state.cursorTimeNs).toBe('1');
    expect(target.highlight?.cursor).toBe(0.5);
    target.dispatchEvent(new Event('scope-ready'));
    expect(group.state.cursorTimeNs).toBe('1');
    expect(received).toBe(2);
    expect(projected).toBe(3);
    target.dispatchEvent(new CustomEvent('scope-inspect', { detail: { time: '2' } }));
    expect(group.state.cursorTimeNs).toBe('2');
    binding.disconnect();
    expect(group.state.cursorTimeNs).toBeNull();
    expect(target.highlight).toBeNull();
    target.dispatchEvent(new CustomEvent('scope-inspect', { detail: { time: '3' } }));
    peer.cursor('4');
    expect(group.state.cursorTimeNs).toBe('4');
    expect(target.highlight).toBeNull();
    binding.disconnect();
  });
});
