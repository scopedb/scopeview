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
    const heading = node('div', 'tooltip-heading');
    appendSwatch(heading, reading.color);
    const title = node('strong', '', reading.title ?? '');
    title.title = [reading.title, reading.context].filter(Boolean).join(' · ');
    heading.append(title);
    const body = node('div', 'tooltip-body');
    readingRows(body, reading.previewRows ?? reading.rows);
    tooltip.replaceChildren(heading, body);
    tooltip.classList.toggle('sample', reading.presentation === 'sample');
    tooltip.classList.toggle('compact', reading.previewRows !== undefined);
    if (reading.context) {
      const context = node('p', 'tooltip-context', reading.context);
      context.title = reading.context;
      heading.after(context);
    }
    if (reading.summary) {
      const summary = node('div', 'tooltip-summary');
      summary.append(
        node('span', '', reading.summary.label),
        node('strong', '', reading.summary.value)
      );
      tooltip.append(summary);
    }
    tooltip.setAttribute('role', 'tooltip');
  }
  for (const row of tooltip.querySelectorAll<HTMLElement>('.tooltip-row'))
    row.toggleAttribute('data-active', row.dataset.series === series);
  tooltip.hidden = false;
}
