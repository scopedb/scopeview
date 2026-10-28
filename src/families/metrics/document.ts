import { parseChartDocument } from './parse.js';
import { compileMetric } from './compile.js';
import { buildSeriesInfo } from './series.js';
import { validateChartConfig, validateMapping } from './validation.js';

export { parseChartDocument, DOCUMENT_LIMITS } from './parse.js';
export type { ChartDocument, ChartDocumentInput, ChartOptions } from './parse.js';
export type { CompiledChart } from './compile.js';

/** The DOM-free public boundary for all metric types. */
export function compileChart(value: unknown) {
  return compileMetric(
    parseChartDocument(value),
    (dataset, config) =>
      dataset.rows.length
        ? validateChartConfig(dataset, config)
        : validateMapping(dataset, config.mapping),
    buildSeriesInfo
  );
}
