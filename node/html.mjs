import { serializeDocument } from './serialize.mjs';
import { randomUUID } from 'node:crypto';
import { compileDocument } from './compile.mjs';
import { assetMissing } from './errors.mjs';
import { readAsset } from './resources.mjs';

export function canonicalLanguage(lang) {
  if (typeof lang !== 'string' || !lang.trim())
    throw new TypeError('Language must be one nonempty language tag.');
  return Intl.getCanonicalLocales(lang)[0];
}

async function installedStyles() {
  try {
    const { SCOPE_CHART_TOKENS } = await import('../dist/styles.js');
    return SCOPE_CHART_TOKENS;
  } catch (error) {
    if (['ERR_MODULE_NOT_FOUND', 'ENOENT'].includes(error.code))
      throw assetMissing('caption styles', error);
    throw error;
  }
}

export async function buildHTML(input, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('options: Expected an object.');
  const keys = ['format', 'fonts', 'theme', 'caption', 'legend', 'tooltip', 'lang', 'onDiagnostic'];
  for (const key of Object.keys(options))
    if (!keys.includes(key)) throw new TypeError(`options.${key}: Unknown option.`);
  const {
    format = 'html',
    fonts: includeFonts = false,
    theme = 'light',
    caption = true,
    legend: includeLegend = true,
    tooltip = true,
    lang = 'en'
  } = options;
  if (!['html', 'fragment'].includes(format))
    throw new TypeError('options.format: Expected html or fragment.');
  for (const key of ['fonts', 'caption', 'legend', 'tooltip'])
    if (options[key] !== undefined && typeof options[key] !== 'boolean')
      throw new TypeError(`options.${key}: Expected a boolean.`);
  if (options.onDiagnostic !== undefined && typeof options.onDiagnostic !== 'function')
    throw new TypeError('options.onDiagnostic: Expected a callback.');
  const fragment = format === 'fragment';
  let resolvedTheme;
  try {
    const { resolveTheme } = await import('../dist/theme.js');
    resolvedTheme = resolveTheme(theme);
  } catch (error) {
    if (['ERR_MODULE_NOT_FOUND', 'ENOENT'].includes(error.code))
      throw assetMissing('theme resolver', error);
    if (error.name === 'ChartValidationError') error.code = 'ERR_SCOPEVIEW_THEME';
    throw error;
  }
  const mode = resolvedTheme.mode;
  const language = canonicalLanguage(lang);
  const compiled = await compileDocument(input);
  const { title, description } = compiled.document;
  const includeCaption = caption;
  const runtime = await readAsset('../dist/scopeview.js', 'utf8');
  // Keep script data unable to end its containing tag; the bundle is trusted build output.
  const safeRuntime = runtime.replace(/<\/script/gi, '<\\/script');
  const id = `scope-${randomUUID()}`;
  const escapeHTML = (value) =>
    value.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  let heading = '',
    styles = '';
  if (includeCaption) {
    const SCOPE_CHART_TOKENS = await installedStyles();
    const series =
      compiled.kind === 'metric' && includeLegend && compiled.chart.config.mapping.kind === 'axis'
        ? compiled.chart.series
        : [];
    const line = ['line', 'area'].includes(compiled.document.spec?.visualization);
    const legend =
      series.length > 1
        ? `<ul class="scopeview-series" aria-label="Series">${series.map((item) => `<li><span aria-hidden="true" style="background:${escapeHTML((line && item.lineColor) || item.color)}"></span>${escapeHTML(item.name)}</li>`).join('')}</ul>`
        : '';
    styles = `${SCOPE_CHART_TOKENS.replaceAll(':host', `#${id}`)}
#${id}{margin:0;min-width:0;font-family:var(--font-sans);color:var(--color-text-primary);background:var(--color-surface)}
#${id} figcaption{margin-bottom:var(--scope-chart-space-panel);overflow-wrap:anywhere}
#${id} h3{margin:0;font-size:var(--scope-chart-font-size-title);font-weight:500;line-height:var(--scope-chart-tooltip-line-height)}
#${id} p{margin:var(--scope-chart-space-micro) 0 0;font-size:var(--scope-chart-tooltip-font-size);line-height:var(--scope-chart-tooltip-line-height);color:var(--color-text-secondary)}
#${id} .scopeview-series{display:flex;flex-wrap:wrap;gap:var(--scope-chart-space-inline) var(--scope-chart-space-section);list-style:none;padding:0;margin:var(--scope-chart-space-inline) 0 0;font-size:var(--scope-chart-tooltip-font-size)}
#${id} .scopeview-series li{display:flex;align-items:center;gap:var(--scope-chart-space-inline);min-width:0;overflow-wrap:anywhere}
#${id} .scopeview-series span{width:.25em;height:1em;flex-shrink:0}`;
    heading = `${title || description || legend ? `<figcaption>${title ? `<h3>${escapeHTML(title)}</h3>` : ''}${description ? `<p>${escapeHTML(description)}</p>` : ''}${legend}</figcaption>` : ''}<div data-scopeview-plot></div>`;
  }
  let fonts = '';
  for (const weight of includeFonts ? [400, 600] : []) {
    const bytes = await readAsset(`../dist/fonts/inter-latin-${weight}-normal.woff2`);
    fonts += `@font-face{font-family:Inter;font-weight:${weight};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2')}`;
  }
  const tag = includeCaption ? 'figure' : 'div';
  const content = `<${tag} id="${id}" lang="${escapeHTML(language)}" data-scopeview="${compiled.kind}"><style>${fonts}${styles}</style>${heading}\n<script type="application/json">${serializeDocument(compiled.document)}</script>\n<script>${safeRuntime}\n{
const host=document.getElementById('${id}');
for(const [name,value] of Object.entries(${serializeDocument(resolvedTheme.properties)}))host.style.setProperty(name,value);
const currentTheme=()=>{
  if('${mode}'!=='system')return '${mode}';
  const scheme=getComputedStyle(document.documentElement).colorScheme;
  return scheme==='light'||scheme==='dark'?scheme:'system';
};
const syncTheme=()=>{
  const theme=currentTheme();
  host.style.colorScheme=theme==='system'?'light dark':theme;
  if(host.scopeviewView)host.scopeviewView.theme=theme;
};
syncTheme();
host.scopeviewView=ScopeView.createVisualization(host.querySelector('[data-scopeview-plot]')||host,JSON.parse(host.querySelector('script[type="application/json"]').textContent),{theme:currentTheme(),tooltip:${tooltip}});
if('${mode}'==='system'){
  const observer=new MutationObserver(syncTheme);
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});
  window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
}
}</script></${tag}>\n`;
  if (fragment && Buffer.byteLength(content) >= 1_000_000)
    throw Object.assign(
      new RangeError('This fragment exceeds 1 MB. Reduce or aggregate the input data.'),
      { code: 'ERR_SCOPEVIEW_FRAGMENT_SIZE' }
    );
  if (fragment) return { html: content, compiled };
  const html = `<!doctype html>\n<html lang="${escapeHTML(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title || 'ScopeView chart')}</title><style>:root{color-scheme:${mode === 'system' ? 'light dark' : mode}}body{max-width:960px;margin:0 auto;padding:24px;background:Canvas;color:CanvasText}@media(max-width:480px){body{padding:8px}}</style></head><body>${content}</body></html>\n`;
  return { html, compiled };
}
