import { ViewportSession } from './core/viewport.js';
import { ViewportController } from './runtime/viewport-controller.js';
import { interactionHosts, type ViewportFactory } from './views/interactions.js';
import type { ChartView } from './views/host.js';

const active = new WeakMap<ChartView, () => void>();
const createViewport: ViewportFactory = (canvas, rect, enabled, changed) => {
  const viewport = new ViewportSession();
  const input = new ViewportController(canvas, viewport, { rect, enabled, onChange: changed });
  return {
    get consumed() {
      return input.consumed;
    },
    state(contentHeight, visibleHeight) {
      viewport.configure({ contentHeight, visibleHeight });
      return viewport.state;
    },
    reveal: (start, end, top, bottom) => viewport.reveal(start, end, top, bottom),
    cancel: () => input.cancel(),
    dispose: () => input.dispose()
  };
};

/** Opt into persistent selection and trace/profile pan, zoom and scroll. Returns a disposer. */
export function enableInteractions(view: ChartView): () => void {
  const existing = active.get(view);
  if (existing) return existing;
  const host = interactionHosts.get(view);
  if (!host) throw new Error('Interactions require an active chart view, not a scalar.');
  host.select(true);
  const stopViewport = host.viewport?.(createViewport);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    active.delete(view);
    stopViewport?.();
    host.select(false);
  };
  active.set(view, stop);
  host.cleanup(stop);
  return stop;
}
