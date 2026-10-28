import type { ChartInteraction } from '../../core/scene.js';
import {
  copyInspectionContext,
  type MetricInspectionContext
} from '../../core/inspection-context.js';
import type { ResultRow } from '../../data/result.js';
import type { CompiledChart } from './document.js';

const indices = new WeakMap<CompiledChart, Map<ResultRow, number>>();

export function metricInspectionContext(
  compiled: CompiledChart,
  target: ChartInteraction<ResultRow> | null,
  series: string | null
): MetricInspectionContext | null {
  if (!target?.sources.length) return null;
  let bySource = indices.get(compiled);
  if (!bySource) {
    bySource = new Map(compiled.document.data.rows.map((row, index) => [row, index]));
    indices.set(compiled, bySource);
  }
  const rowIndices = target.sources.map((row) => bySource.get(row) ?? -1);
  if (rowIndices.includes(-1)) return null;
  const document = compiled.document;
  return copyInspectionContext(document, target.key, {
    kind: 'metric',
    fields: document.data.fields,
    spec: document.spec,
    rowIndices,
    rows: [...target.sources],
    series,
    ...(document.semantics ? { semantics: document.semantics } : {}),
    ...(document.options?.values ? { values: document.options.values } : {})
  });
}
