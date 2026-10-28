import { SCOPE_CHART_STYLES } from '../../../src/styles.js';

/** Minimal browser host for painter/runtime contracts, independent of example documents. */
export function createCanvasHost({
  id,
  width,
  height,
  surface = 'light'
}: {
  id: string;
  width: number;
  height: number;
  surface?: 'light' | 'dark';
}) {
  const host = document.createElement('div');
  host.id = id;
  if (surface === 'dark') {
    host.style.setProperty('--color-text-primary', '#f4f5f7');
    host.style.setProperty('--color-surface', '#171920');
  }
  const root = host.attachShadow({ mode: 'open' }),
    style = document.createElement('style'),
    viewport = document.createElement('div'),
    canvas = document.createElement('div'),
    decoration = document.createElement('div');
  style.textContent = `${SCOPE_CHART_STYLES}.viewport{width:${width}px;height:${height}px;background:var(--color-surface)}`;
  viewport.className = 'viewport';
  canvas.className = 'canvas';
  decoration.className = 'decoration';
  viewport.append(canvas, decoration);
  root.append(style, viewport);
  document.body.prepend(host);
  return { host, canvas, decoration };
}
