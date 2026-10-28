import { parseChartDocument } from './parse.js';
import { isAxisDisplayType } from './spec.js';
import { compileMetric } from './compile.js';
import { buildAxisSeriesInfo } from './series.js';
import { validateAxisConfig } from './validation.js';

/** Keep the same owned input and semantic checks with only axis data preparation. */
export function compileAxis(value: unknown) {
  const document = parseChartDocument(value);
  if (
    !isAxisDisplayType(document.spec.visualization) ||
    document.options?.orientation === 'horizontal'
  )
    throw new TypeError(
      'This chart entry supports axis layouts. Use /chart for all metric layouts.'
    );
  return compileMetric(document, validateAxisConfig, buildAxisSeriesInfo);
}
