import { parseViewOptions } from './options.js';
import {
  hierarchyViewportHeight,
  layoutHierarchy,
  type HierarchyView
} from '../families/hierarchy/layout.js';
import type { Entity } from '../families/hierarchy/model.js';
import { View, type ViewOptions, type ChartView } from './view.js';
import { interactionHosts } from './interactions.js';

/** Shared trace/profile viewport; controls and selected-source details are host-owned. */
export function createHierarchy<Source extends Entity>(
  host: HTMLElement,
  document: unknown,
  prepare: (document: unknown) => HierarchyView<Source>,
  options: ViewOptions<Source>
): ChartView {
  options = parseViewOptions(options);
  let model = prepare(document);
  const view: View<Source> = new View(
    host,
    options,
    '',
    (width, height, measure) => {
      const state = view.viewport?.state(
        model.rowCount * model.rowHeight,
        hierarchyViewportHeight(height, options.axes ?? 'minimal')
      );
      return layoutHierarchy(
        model,
        width,
        height,
        measure,
        state,
        options.axes ?? 'minimal',
        !view.viewport
      );
    },
    {
      inputConsumed: () => view.viewport?.consumed ?? false,
      onNavigate(target) {
        const item = model.byId.get(target.sources[0]?.id);
        if (!item || !view.viewport) return;
        view.viewport.reveal(
          item.start,
          item.end,
          item.row * model.rowHeight,
          (item.row + 1) * model.rowHeight
        );
        view.runtime.paint();
      }
    }
  );
  interactionHosts.get(view)!.viewport = (create) => {
    view.viewport = create(
      view.canvas,
      () => view.runtime.model?.rect,
      () => model.document.options?.interactive !== false,
      () => {
        view.hideReading();
        view.runtime.refresh();
      }
    );
    view.runtime.refresh();
    return () => {
      view.viewport?.dispose();
      view.viewport = undefined;
      view.runtime.refresh();
    };
  };
  view.update = (document) => {
    view.assertActive();
    const next = prepare(document);
    view.viewport?.cancel();
    model = next;
    view.status(model.items.length ? null : 'No data');
    view.changed();
  };
  view.status(model.items.length ? null : 'No data');
  view.changed();
  return view;
}
