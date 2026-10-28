import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '../src/register.js';
import runtime from '../dist/scopeview.js?raw';
import regularFont from '@fontsource/inter/files/inter-latin-400-normal.woff2?inline';
import semiboldFont from '@fontsource/inter/files/inter-latin-600-normal.woff2?inline';
import type { ScopeChartElement, ScopeTraceElement, ScopeFlameElement } from '../src/element.js';
import { metricDocument, traceDocument, profileDocument } from './embedding-data.js';

type ChartElement = ScopeChartElement | ScopeTraceElement | ScopeFlameElement;
const charts = [
  ...document.querySelectorAll<ChartElement>('scope-chart, scope-trace, scope-flame')
];
for (const chart of charts) {
  if (chart.localName === 'scope-chart')
    (chart as ScopeChartElement).configure({ axes: 'minimal', legend: true });
  chart.document = chart.hasAttribute('data-trace')
    ? traceDocument
    : chart.hasAttribute('data-profile')
      ? profileDocument
      : metricDocument(chart.hasAttribute('data-bar'));
}
const stage = document.querySelector<HTMLElement>('.preview-stage')!;
const width = document.querySelector<HTMLInputElement>('#width')!;
const widthValue = document.querySelector<HTMLOutputElement>('#width-value')!;
const widths: Record<string, number> = {
  conversation: 680,
  document: 800,
  drawer: 1000,
  dashboard: 1100,
  sandbox: 680
};
const resize = () => stage.style.setProperty('--preview-width', `${width.value}px`);
width.addEventListener('input', resize);
new ResizeObserver(() => {
  widthValue.value = `${Math.round(stage.getBoundingClientRect().width)}px`;
}).observe(stage);
document.querySelectorAll<HTMLButtonElement>('[data-context]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll<HTMLButtonElement>('[data-context]').forEach((item) => {
      item.setAttribute('aria-pressed', String(item === button));
    });
    document.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== button.dataset.context;
    });
    width.value = String(widths[button.dataset.context!]);
    resize();
  });
});
const report = document.querySelector<HTMLDialogElement>('#report')!;
document.querySelector('#open-report')!.addEventListener('click', () => report.showModal());
document.querySelector('#close-report')!.addEventListener('click', () => report.close());

const darkTokens: Record<string, string> = {
  '--color-surface': '#181e27',
  '--color-text-primary': '#f0f0f0',
  '--color-text-secondary': '#b5becb',
  '--color-text-tertiary': '#9ca8b8',
  '--color-text-brand': '#70b5f6',
  '--color-border': '#384150',
  '--color-border-light': '#2c3441',
  '--color-surface-hover': 'rgb(255 255 255 / 5%)',
  '--color-surface-pressed': 'rgb(255 255 255 / 8%)',
  '--color-text-danger': '#fa9090',
  '--color-chart-warning': '#e4bd66'
};
const surface = document.querySelector<HTMLSelectElement>('#surface')!;
const frame = document.querySelector<HTMLIFrameElement>('#isolated')!;
const sendTheme = () =>
  frame.contentWindow?.postMessage(
    { type: 'scopeview-demo-theme', dark: surface.value === 'dark', tokens: darkTokens },
    '*'
  );
surface.addEventListener('change', () => {
  const dark = surface.value === 'dark';
  document.documentElement.dataset.surface = surface.value;
  for (const chart of charts) {
    for (const [token, value] of Object.entries(darkTokens)) {
      if (dark) chart.style.setProperty(token, value);
      else chart.style.removeProperty(token);
    }
    chart.style.colorScheme = surface.value;
    chart.refresh();
  }
  sendTheme();
});

// This opaque-origin iframe carries the built runtime and fonts, with no network imports.
// Messages are local demo plumbing; the library itself has no host-message dependency.
const json = (value: unknown) =>
  JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
frame.srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
@font-face{font-family:Inter;font-weight:400;src:url(${regularFont}) format('woff2')}
@font-face{font-family:Inter;font-weight:600;src:url(${semiboldFont}) format('woff2')}
body{margin:0;padding:8px}#embed{display:grid;gap:12px}#isolated-chart{--scope-chart-height:200px}#isolated-trace{--scope-chart-height:176px}
</style></head><body><div id="embed"><div id="isolated-chart"><script type="application/json">${json(metricDocument(true))}</script></div><div id="isolated-trace"><script type="application/json">${json(traceDocument)}</script></div></div>
<script>${runtime.replace(/<\/script/gi, '<\\/script')}</script><script>
const root=document.getElementById('embed');
const views=[...root.children].map(host=>ScopeView.createVisualization(host,JSON.parse(host.querySelector('script').textContent)));
let pending=0;
const reportSize=()=>{if(pending)return;pending=requestAnimationFrame(()=>{pending=0;parent.postMessage({type:'scopeview-demo-height',height:Math.ceil(root.getBoundingClientRect().height)+16},'*')})};
new ResizeObserver(reportSize).observe(root);
document.fonts.ready.then(reportSize);
addEventListener('message',event=>{
  if(event.source!==parent||event.data?.type!=='scopeview-demo-theme')return;
  const dark=event.data.dark===true;
  document.body.style.backgroundColor=dark?'#181e27':'#fff';
  for(const [index,chart] of [...root.children].entries()){
    for(const [token,value] of Object.entries(event.data.tokens)){
      if(dark)chart.style.setProperty(token,value);else chart.style.removeProperty(token);
    }
    views[index].theme=dark?'dark':'light';views[index].refresh();
  }
});
</script></body></html>`;
frame.addEventListener('load', sendTheme);
window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow || event.data?.type !== 'scopeview-demo-height') return;
  const height: unknown = event.data.height;
  if (typeof height !== 'number' || !Number.isFinite(height) || height < 100 || height > 8000)
    return;
  frame.style.height = `${height}px`;
  document.querySelector('#frame-height')!.textContent = `${height}px · auto height`;
});
