import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import {
  compileTrace,
  createTraceView,
  layoutTrace,
  compileProfile,
  createProfileView,
  layoutProfile,
  type TraceSpan,
  type ProfileFrame,
  type ChartScene
} from '../src/index.js';
import { CanvasRenderer, SCOPE_CHART_STYLES } from '../src/canvas.js';
import { renderInspection } from '../src/ui/inspection.js';

type Source = TraceSpan | ProfileFrame;
const time = (offset: bigint) => (1790643600000000001n + offset).toString();
export const trace = createTraceView(
  compileTrace({
    version: 1,
    kind: 'trace',
    spans: [
      {
        id: 'query',
        name: 'SELECT · logs',
        service: 'query',
        startTimeNs: time(0n),
        endTimeNs: time(100_000_000n)
      },
      {
        id: 'scan',
        parentId: 'query',
        name: 'scan · worker A',
        service: 'storage',
        startTimeNs: time(12_000_000n),
        endTimeNs: time(76_000_000n)
      },
      {
        id: 'retry',
        parentId: 'scan',
        name: 'retry · timeout',
        service: 'storage',
        status: 'error',
        startTimeNs: time(40_000_000n),
        endTimeNs: time(60_000_000n)
      }
    ]
  })
);
export const profile = createProfileView(
  compileProfile({
    version: 1,
    kind: 'profile',
    unit: 'samples',
    frames: [
      { id: 'query', name: 'executeQuery', selfWeight: '10' },
      { id: 'scan', parentId: 'query', name: 'scanSegments', selfWeight: '15' },
      {
        id: 'decode',
        parentId: 'scan',
        name: 'decodeBatch',
        selfWeight: '45',
        file: 'decoder.ts',
        line: 42
      },
      { id: 'filter', parentId: 'scan', name: 'evaluatePredicate', selfWeight: '30' }
    ]
  })
);
const family = document.querySelector<HTMLSelectElement>('#family')!,
  target = document.querySelector<HTMLSelectElement>('#target')!,
  surface = document.querySelector<HTMLSelectElement>('#surface')!;
let pinnedOpen = true;

const panels = ['default', 'hover', 'pinned'].map((state) => {
  const host = document.querySelector<HTMLElement>(`#${state}`)!,
    root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${SCOPE_CHART_STYLES}
    .viewport{height:176px}.root{border:0}.preview-reading{border-top:1px solid var(--color-border-light)}
    .inspection-placeholder{padding:16px}.tooltip-body{padding-bottom:12px}
  </style><section class="root"><div class="viewport"><div class="canvas"></div><div class="decoration"></div></div>
    <div class="preview-reading"><div class="inspection-placeholder"><strong>No reading is active</strong><span>Data stays unchanged.</span></div><div class="tooltip docked" hidden></div></div></section>`;
  const canvas = root.querySelector<HTMLElement>('.canvas')!,
    decoration = root.querySelector<HTMLElement>('.decoration')!,
    tooltip = root.querySelector<HTMLElement>('.tooltip')!,
    placeholder = root.querySelector<HTMLElement>('.inspection-placeholder')!;
  const renderer = new CanvasRenderer<Source>(canvas, decoration, (value, _position, pin) => {
    if (pin && value) {
      target.value = value.key;
      pinnedOpen = true;
      paint();
    }
  });
  return { state, host, canvas, renderer, tooltip, placeholder };
});
function choices() {
  const view = family.value === 'trace' ? trace : profile;
  target.replaceChildren(
    ...view.navigation.interactions.map((value) => {
      const option = document.createElement('option');
      option.value = value.key;
      option.textContent = value.tooltip.title!;
      return option;
    })
  );
  target.value = `${family.value === 'trace' ? 'trace' : 'profile'}:scan`;
  pinnedOpen = true;
  paint();
}
function paint() {
  for (const panel of panels) {
    const dark = surface.value === 'dark';
    panel.host.style.setProperty('--color-surface', dark ? '#15191f' : '#ffffff');
    panel.host.style.setProperty('--color-text-primary', dark ? '#f4f4f5' : '#000000');
    panel.host.style.setProperty('--color-text-secondary', dark ? '#b3b5b8' : 'rgba(0,0,0,.6)');
    panel.host.style.setProperty('--color-text-tertiary', dark ? '#a0a3a6' : 'rgba(0,0,0,.55)');
    panel.host.style.setProperty(
      '--color-border',
      dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.12)'
    );
    panel.host.style.setProperty(
      '--color-border-light',
      dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.06)'
    );
    panel.host.style.setProperty(
      '--color-chart-axis',
      dark ? 'rgba(255,255,255,.4)' : 'rgba(0,0,0,.4)'
    );
    const width = panel.canvas.getBoundingClientRect().width;
    if (width <= 0) continue;
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = `11px ${getComputedStyle(panel.canvas).fontFamily}`;
    const textWidth = (text: string) => measure.measureText(text).width;
    const scene: ChartScene<Source> =
      family.value === 'trace'
        ? layoutTrace(trace, width, 176, textWidth)
        : layoutProfile(profile, width, 176, textWidth);
    const active =
      panel.state === 'default' || (panel.state === 'pinned' && !pinnedOpen)
        ? null
        : scene.interactionByKey.get(target.value)!;
    panel.renderer.render(scene, {
      inspectionKey: active?.key ?? null,
      inspectionPinned: panel.state === 'pinned',
      range: null
    });
    panel.placeholder.hidden = active !== null;
    if (active)
      renderInspection(panel.tooltip, active, panel.state === 'pinned', () => {
        pinnedOpen = false;
        paint();
      });
    else panel.tooltip.hidden = true;
    panel.host.setAttribute(
      'aria-label',
      `${panel.state}: ${active?.tooltip.title ?? 'no active target'}`
    );
  }
}
family.addEventListener('change', choices);
target.addEventListener('change', () => {
  pinnedOpen = true;
  paint();
});
surface.addEventListener('change', paint);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && pinnedOpen) {
    pinnedOpen = false;
    paint();
  }
});
const resize = new ResizeObserver(paint);
for (const panel of panels) resize.observe(panel.host);
document.fonts.ready.then(paint);
document.fonts.addEventListener('loadingdone', paint);
window.addEventListener(
  'pagehide',
  () => {
    resize.disconnect();
    for (const panel of panels) panel.renderer.dispose();
  },
  { once: true }
);
choices();
