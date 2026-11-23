import type { ChartInteraction } from '../core/scene.js';
import { appendSwatch, node } from './dom.js';
import { readingRows } from './inspection-content.js';
const previews = new WeakMap<HTMLElement, ChartInteraction<unknown>>();

/** Transient reading only. Selection belongs to the host, without a detail panel or controls. */
export function renderPreview<Source>(
  tooltip: HTMLElement,
  value: ChartInteraction<Source>,
  series?: string | null
) {
  if (previews.get(tooltip) !== value) {
    previews.set(tooltip, value);
    const reading = value.tooltip;
    const nodes: HTMLElement[] = [];
    const heading = node('div', 'tooltip-heading');
    appendSwatch(heading, reading.color);
    if (reading.title) {
      const title = node('strong', '', reading.title);
      title.title = [reading.title, reading.context].filter(Boolean).join(' · ');
      heading.append(title);
    }
    if (heading.childNodes.length) nodes.push(heading);
    if (reading.context) {
      const context = node('p', 'tooltip-context', reading.context);
      context.title = reading.context;
      nodes.push(context);
    }
    const body = node('div', 'tooltip-body');
    readingRows(body, reading.previewRows ?? reading.rows);
    nodes.push(body);
    if (reading.summary) {
      const summary = node('div', 'tooltip-summary');
      summary.append(
        node('span', '', reading.summary.label),
        node('strong', '', reading.summary.value)
      );
      nodes.push(summary);
    }
    tooltip.replaceChildren(...nodes);
    tooltip.classList.toggle('sample', reading.presentation === 'sample');
    tooltip.classList.toggle('compact', reading.previewRows !== undefined);
    tooltip.setAttribute('role', 'tooltip');
  }
  for (const row of tooltip.querySelectorAll<HTMLElement>('.tooltip-row'))
    row.toggleAttribute('data-active', row.dataset.series === series);
  tooltip.hidden = false;
}
