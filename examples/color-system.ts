import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import { SCOPE_CHART_TOKENS } from '../src/styles.js';
import { inspectionFill } from '../src/renderers/canvas/contrast.js';

const names = [
  'Blue',
  'Teal',
  'Violet',
  'Amber',
  'Steel',
  'Rose',
  'Olive',
  'Cyan',
  'Clay',
  'Indigo'
];
const semantics = ['Info', 'Success', 'Warning', 'Error', 'Critical', 'Debug', 'Trace', 'Unknown'];
for (const host of document.querySelectorAll<HTMLElement>('.surface')) {
  const dark = host.dataset.surface === 'dark';
  host.style.colorScheme = dark ? 'dark' : 'light';
  if (dark) {
    host.style.setProperty('--color-surface', '#19212b');
    host.style.setProperty('--color-text-primary', '#edf3f8');
    host.style.setProperty('--color-text-secondary', '#b2c0cc');
    host.style.setProperty('--color-border-light', '#344352');
  }
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `${SCOPE_CHART_TOKENS}
    :host{display:block;font:12px/1.5 Inter,system-ui,sans-serif;color:var(--color-text-primary)}
    h2{font-size:14px;font-weight:600;margin:0 0 14px}h3{font-size:12px;font-weight:600;margin:22px 0 8px}
    table{width:100%;border-collapse:collapse;font-size:11px}th{text-align:left;font-weight:400;color:var(--color-text-secondary);padding:0 0 8px}
    td{padding:6px 0;border-top:1px solid var(--color-border-light);vertical-align:middle}td:first-child{width:26%}td:not(:first-child){width:24.6%}
    .sample{display:block;width:calc(100% - 14px);height:16px;border-radius:2px}.sample.line{height:0;border-top:2px solid var(--paint);border-radius:0;margin-block:7px}
    .slot{color:var(--color-text-secondary);display:inline-block;width:22px;font-size:10px;font-variant-numeric:tabular-nums}
    p{font-size:11px;color:var(--color-text-secondary);margin:8px 0 0}
  `;
  root.append(style);
  const title = document.createElement('h2');
  title.textContent = dark ? 'Dark surface' : 'Light surface';
  root.append(title);
  for (const [labels, semantic] of [
    [names, false],
    [semantics, true]
  ] as const) {
    const heading = document.createElement('h3');
    heading.textContent = semantic ? 'Status · fixed meaning' : 'Series · stable identity';
    root.append(heading);
    const table = document.createElement('table');
    table.innerHTML =
      '<thead><tr><th scope="col">Color role</th><th scope="col">Default</th><th scope="col">Hover</th><th scope="col">Line</th></tr></thead>';
    const body = document.createElement('tbody');
    table.append(body);
    root.append(table);
    for (const [i, name] of labels.entries()) {
      const role = semantic ? `semantic-${name.toLowerCase()}` : `series-${i + 1}`;
      const row = document.createElement('tr');
      row.dataset.role = role;
      const label = document.createElement('td');
      if (!semantic) {
        const slot = document.createElement('span');
        slot.className = 'slot';
        slot.textContent = String(i + 1).padStart(2, '0');
        label.append(slot);
      }
      label.append(name);
      row.append(label);
      body.append(row);
      for (const state of ['default', 'hover', 'line']) {
        const cell = document.createElement('td'),
          sample = document.createElement('span');
        sample.className = `sample ${state}`;
        sample.style.backgroundColor = `var(--color-chart-${role}${state === 'line' ? '-line' : ''})`;
        cell.append(sample);
        row.append(cell);
        const paint = getComputedStyle(sample).backgroundColor;
        const fill =
          state === 'hover'
            ? inspectionFill(paint, dark ? 'rgb(25, 33, 43)' : 'rgb(255, 255, 255)')
            : paint;
        sample.style.backgroundColor = fill;
        sample.style.setProperty('--paint', fill);
        sample.dataset.paint = fill;
        sample.title = `${name} · ${state}: ${fill}`;
      }
    }
  }
  const note = document.createElement('p');
  note.textContent =
    'Hover changes lightness at the same hue. Narrow strokes get their own reading contrast; selection never changes the category.';
  root.append(note);
}
