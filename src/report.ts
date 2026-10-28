import type { ViewOptions } from './views/view.js';
import type { ReportView } from './views/host.js';

export type { ChartView, ChartTheme, ThemeConfig, ThemeMode, ViewOptions } from './views/view.js';
export type { ReportView } from './views/host.js';
export interface ReportOptions extends ViewOptions<unknown> {
  /** Cancel mounting if the report section is removed while its module loads. */
  signal?: AbortSignal;
}

/** Load this figure's family and metric layout. Readings are ready with the first paint. */
export async function createReport(
  host: HTMLElement,
  document: unknown,
  options: ReportOptions = {}
): Promise<ReportView> {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('Expected report options.');
  const { signal, ...viewOptions } = options;
  signal?.throwIfAborted();
  const kind =
    document && typeof document === 'object' && 'kind' in document ? document.kind : undefined;
  const create =
    kind === 'trace'
      ? (await import('./trace.js')).createTrace
      : kind === 'profile'
        ? (await import('./flame.js')).createFlame
        : (await import('./views/report-chart.js')).createReportChart;
  signal?.throwIfAborted();
  const view = await create(host, document, viewOptions, signal);
  const update = view.update.bind(view);
  return Object.assign(view, {
    async update(document: unknown) {
      await update(document);
    }
  });
}
