import type { ChartInteraction } from '../core/scene.js';
import { observationPageSize as tokenObservationPageSize } from '../theme/visual-tokens.js';
import { actionButton, appendSwatch, node } from './dom.js';

interface ObservationReading {
  value: ChartInteraction<unknown>;
  pinned: boolean;
  page: number;
  options: {
    locked?: boolean;
    neighbors?: readonly ChartInteraction<unknown>[];
    onChoose?: (key: string) => void;
  };
}

export function sameObservations(
  left: readonly ChartInteraction<unknown>[] = [],
  right: readonly ChartInteraction<unknown>[] = []
) {
  return (
    left.length === right.length && left.every((value, index) => value.key === right[index].key)
  );
}

/** Disclose overlapping sources without taking ownership of the chart's selection. */
export function renderObservations(read: () => ObservationReading) {
  const { value, pinned, options } = read(),
    neighbors = options.neighbors;
  if (!neighbors || neighbors.length < 2) return null;
  const persistent = pinned || options.locked,
    chooser = node('div', 'tooltip-observations');
  chooser.append(
    node(
      'p',
      'tooltip-context',
      `${neighbors.length} ${persistent ? 'overlapping observations' : 'observations under this pointer'}`
    )
  );
  if (!persistent) {
    chooser.append(node('p', 'tooltip-preview-hint', 'Click to choose an observation'));
    return chooser;
  }

  const pageSize = tokenObservationPageSize,
    pages = Math.ceil(neighbors.length / pageSize),
    list = node('div', 'tooltip-observation-list'),
    navigation = node('div', 'tooltip-footer tooltip-observation-pages'),
    before = actionButton('Previous', () => {
      read().page--;
      draw();
    }),
    after = actionButton('Next', () => {
      read().page++;
      draw();
    }),
    pageLabel = node('span');
  const draw = () => {
    const state = read();
    state.page = Math.min(state.page, pages - 1);
    list.replaceChildren();
    const start = state.page * pageSize;
    neighbors.slice(start, start + pageSize).forEach((observation, offset) => {
      const choice = actionButton(
          '',
          () => read().options.onChoose?.(observation.key),
          'tooltip-observation'
        ),
        label = node('span', 'tooltip-label');
      choice.dataset.key = observation.key;
      choice.setAttribute('aria-pressed', String(observation.key === value.key));
      appendSwatch(label, observation.tooltip.color);
      label.append(
        node('span', '', observation.tooltip.title ?? `Observation ${start + offset + 1}`)
      );
      choice.append(
        label,
        node(
          'span',
          'tooltip-context',
          observation.tooltip.rows
            .slice(0, 2)
            .map((row) => `${row.label}: ${row.value}`)
            .join(' · ')
        )
      );
      list.append(choice);
    });
    before.disabled = state.page === 0;
    after.disabled = state.page === pages - 1;
    pageLabel.textContent = `${state.page + 1} / ${pages}`;
    navigation.hidden = pages === 1;
  };
  navigation.append(before, pageLabel, after);
  chooser.append(list, navigation);
  draw();
  return chooser;
}
