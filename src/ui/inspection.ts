import type { ChartInteraction } from '../core/scene.js';
import { observationPageSize as tokenObservationPageSize } from '../theme/visual-tokens.js';
import { actionButton, appendSwatch, node } from './dom.js';
import { renderObservations, sameObservations } from './inspection-observations.js';
import { readingRows } from './inspection-content.js';
import { syncFloatingInspection } from './inspection-floating.js';
export {
  hideInspection,
  syncFloatingInspection,
  dockInspection,
  positionInspection
} from './inspection-floating.js';

interface InspectionOptions {
  series?: string | null;
  locked?: boolean;
  onLock?: () => void;
  neighbors?: readonly ChartInteraction<unknown>[];
  onChoose?: (key: string) => void;
}

interface InspectionReading {
  value: ChartInteraction<unknown>;
  pinned: boolean;
  dismiss: () => void;
  options: InspectionOptions;
  page: number;
}

const readings = new WeakMap<HTMLElement, InspectionReading>();

/** Shared accessible DOM inspector; never interprets source labels as HTML. */
export function renderInspection<Source>(
  tooltip: HTMLElement,
  value: ChartInteraction<Source>,
  pinned: boolean,
  dismiss: () => void,
  options: InspectionOptions = {}
) {
  const previous = readings.get(tooltip);
  const sameNeighbors = previous && sameObservations(previous.options.neighbors, options.neighbors);
  const selectedPage = Math.max(
    0,
    Math.floor(
      (options.neighbors?.findIndex((v) => v.key === value.key) ?? 0) / tokenObservationPageSize
    )
  );
  readings.set(tooltip, {
    value,
    pinned,
    dismiss,
    options,
    page: sameNeighbors && previous.pinned ? previous.page : pinned ? selectedPage : 0
  });
  const emphasize = () => {
    for (const row of tooltip.querySelectorAll<HTMLElement>('.tooltip-row'))
      row.toggleAttribute('data-active', row.dataset.series === options.series);
  };
  if (
    !tooltip.hidden &&
    previous?.value === value &&
    previous.pinned === pinned &&
    sameNeighbors &&
    previous.options.locked === options.locked
  ) {
    emphasize();
    syncFloatingInspection(tooltip);
    return;
  }
  const scroll =
    !tooltip.hidden && tooltip.dataset.key === value.key
      ? (tooltip.querySelector('.tooltip-content')?.scrollTop ?? 0)
      : 0;
  tooltip.replaceChildren();
  tooltip.dataset.key = value.key;
  tooltip.hidden = false;
  tooltip.classList.toggle('pinned', pinned);
  tooltip.classList.toggle('locked', options.locked === true);
  const compact = !pinned && value.tooltip.previewRows !== undefined;
  tooltip.classList.toggle('compact', compact);
  const sample = value.tooltip.presentation === 'sample' && !pinned && !options.locked;
  tooltip.classList.toggle('sample', sample);
  tooltip.setAttribute('role', pinned || options.locked ? 'group' : 'tooltip');
  tooltip.setAttribute('aria-label', 'Chart inspection');
  const content = node('div', 'tooltip-content'),
    heading = node('div', 'tooltip-heading');
  appendSwatch(heading, value.tooltip.color);
  if (value.tooltip.title) {
    const title = node('strong', '', value.tooltip.title);
    title.title = [value.tooltip.title, value.tooltip.context].filter(Boolean).join(' · ');
    heading.append(title);
  }
  if (pinned || options.locked)
    heading.append(
      node(
        'span',
        'tooltip-badge',
        options.locked ? 'Locked' : options.onLock ? 'Selected' : 'Pinned'
      )
    );
  if (heading.childNodes.length) content.append(heading);
  if (value.tooltip.context) {
    const context = node('p', 'tooltip-context', value.tooltip.context);
    context.title = value.tooltip.context;
    content.append(context);
  }
  const body = node('div', 'tooltip-body');
  readingRows(body, compact ? value.tooltip.previewRows! : value.tooltip.rows);
  content.append(body);
  if (value.tooltip.summary) {
    const summary = node('div', 'tooltip-summary');
    summary.append(
      node('span', '', value.tooltip.summary.label),
      node('strong', '', value.tooltip.summary.value)
    );
    content.append(summary);
  }
  tooltip.append(content);
  const observations = renderObservations(() => readings.get(tooltip)!);
  if (observations) content.append(observations);
  if (compact) content.append(node('p', 'tooltip-preview-hint', 'Click or Enter to pin details'));
  if (pinned || options.locked) {
    const footer = node('div', 'tooltip-footer'),
      close = actionButton('Close', () => readings.get(tooltip)?.dismiss());
    footer.append(
      node(
        'span',
        'tooltip-hint',
        options.onLock && !options.locked ? 'Hover to compare' : 'Esc to dismiss'
      )
    );
    if (options.onLock) {
      const lock = actionButton(options.locked ? 'Unlock' : 'Lock', () =>
        readings.get(tooltip)?.options.onLock?.()
      );
      lock.setAttribute('aria-label', options.locked ? 'Unlock tooltip' : 'Lock tooltip');
      footer.append(lock);
    }
    footer.append(close);
    tooltip.append(footer);
  }
  content.scrollTop = scroll;
  emphasize();
  syncFloatingInspection(tooltip);
}
