import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '../src/register.js';
import type { ScopeChartElement } from '../src/element.js';
import { markDocument, type Family } from './mark-data.js';

const charts = [...document.querySelectorAll<ScopeChartElement>('scope-chart')];
for (const chart of charts) {
  const family = chart.dataset.family as Family;
  chart.configure({
    axes: 'minimal',
    legend: ['line', 'area'].includes(family) ? { columns: ['last', 'avg', 'max'] } : true
  });
  chart.document = markDocument(family);
}

document.querySelector<HTMLSelectElement>('#family')!.addEventListener('change', (event) => {
  const family = (event.target as HTMLSelectElement).value;
  for (const article of document.querySelectorAll<HTMLElement>('article'))
    article.hidden = family !== 'all' && article.dataset.family !== family;
});
document.querySelector('#reset')!.addEventListener('click', () => {
  for (const chart of charts)
    chart.viewState = { ...chart.viewState, pinnedKey: null, hiddenSeries: [] };
});
