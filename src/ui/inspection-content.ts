import type { InspectionRow } from '../core/scene.js';
import { appendSwatch, node } from './dom.js';

export function readingRows(body: HTMLElement, rows: readonly InspectionRow[]) {
  for (const row of rows) {
    const line = node('div', 'tooltip-row'),
      label = node('span', 'tooltip-label');
    line.dataset.series = row.label;
    if (row.format) line.dataset.format = row.format;
    if (row.tone) line.dataset.tone = row.tone;
    appendSwatch(label, row.color);
    label.append(node('span', '', row.label));
    line.append(label, node('span', 'tooltip-value', row.value));
    body.append(line);
  }
}
