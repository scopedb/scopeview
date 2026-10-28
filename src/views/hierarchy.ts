import { parseViewOptions } from './options.js';
import {
  hierarchyViewportHeight,
  layoutHierarchy,
  type HierarchyView
} from '../families/hierarchy/layout.js';
import type { Entity } from '../families/hierarchy/model.js';
import type { ChartInteraction } from '../core/scene.js';
import type { HierarchyInspectionContext } from '../core/inspection-context.js';
import { View, type ViewOptions, type ChartView } from './view.js';
import { interactionHosts } from './interactions.js';

/** Shared trace/profile viewport; controls and selected-source details are host-owned. */
export function createHierarchy<
  Source extends Entity,
  Compiled,
  Context extends HierarchyInspectionContext
>(
  host: HTMLElement,
  document: unknown,
  compile: (document: unknown) => Compiled,
  createView: (compiled: Compiled) => HierarchyView<Source>,
  context: (compiled: Compiled, target: ChartInteraction<Source> | null) => Context | null,
  options: ViewOptions<Source, Context>
): ChartView {
  options = parseViewOptions(options);
  let compiled = compile(document);
  let rendered = compiled;
  let model = createView(compiled);
  const view: View<Source, Context> = new View(
    host,
    options,
    '',
    (width, height, measure) => {
      rendered = compiled;
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
    (target) => context(rendered, target),
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
    const next = compile(document);
    const nextView = createView(next);
    view.viewport?.cancel();
    compiled = next;
    model = nextView;
    view.status(model.items.length ? null : 'No data');
    view.changed();
  };
  view.status(model.items.length ? null : 'No data');
  view.changed();
  return view;
}
