import { compileChart, type CompiledChart } from '../families/metrics/document.js';
import { metricLayoutKind } from '../families/metrics/layout-kind.js';
import type { MetricLayout } from '../families/metrics/layout-common.js';
import type { ResultRow } from '../data/result.js';
import type { MetricInspectionContext } from '../core/inspection-context.js';
import { createMetric } from './metric.js';
import type { ViewOptions } from './view.js';
import type { ReportView } from './host.js';

async function loadLayout(compiled: CompiledChart): Promise<MetricLayout> {
  switch (metricLayoutKind(compiled)) {
    case 'axis':
      return (await import('../families/metrics/layout-axis.js')).layoutAxis;
    case 'scatter':
      return (await import('../families/metrics/layout-scatter.js')).layoutScatter;
    case 'donut':
      return (await import('../families/metrics/layout-donut.js')).layoutDonut;
    case 'top-list':
      return (await import('../families/metrics/layout-top-list.js')).layoutTopList;
    case 'treemap':
      return (await import('../families/metrics/layout-treemap.js')).layoutTreemap;
    case 'aggregate':
      return (await import('../families/metrics/layout-common.js')).layoutEmpty;
  }
}

export async function createReportChart(
  host: HTMLElement,
  document: unknown,
  options: ViewOptions<ResultRow, MetricInspectionContext> = {},
  signal?: AbortSignal
): Promise<ReportView> {
  const compiled = compileChart(document);
  const layout = await loadLayout(compiled);
  signal?.throwIfAborted();
  const { view, replace } = createMetric(host, compiled, layout, compileChart, options);
  let revision = 0;
  let disposed = false;
  const dispose = view.dispose.bind(view);
  return Object.assign(view, {
    async update(document: unknown) {
      if (disposed) throw new Error('This chart has been disposed.');
      // Validate and snapshot before yielding; a failed update leaves the current figure intact.
      const next = compileChart(document);
      const current = ++revision;
      const layout = await loadLayout(next);
      if (disposed) throw new DOMException('This chart has been disposed.', 'AbortError');
      // An older download must not overwrite a newer document.
      if (current !== revision) return;
      replace(next, layout);
    },
    dispose() {
      disposed = true;
      revision++;
      dispose();
    }
  });
}
