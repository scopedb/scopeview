import type { ChartInteraction } from '../../core/scene.js';
import {
  copyInspectionContext,
  type MetricInspectionContext
} from '../../core/inspection-context.js';
import type { ResultRow } from '../../data/result.js';
import type { CompiledChart } from './document.js';

const indices = new WeakMap<CompiledChart, Map<ResultRow, number>>();

export function sourceRowIndices(
  compiled: CompiledChart | null,
  sources: readonly ResultRow[]
): number[] {
  if (!compiled || !sources.length) return [];
  let bySource = indices.get(compiled);
  if (!bySource) {
    bySource = new Map(compiled.document.data.rows.map((row, index) => [row, index]));
    indices.set(compiled, bySource);
  }
  return sources.map((row) => bySource.get(row) ?? -1);
}

export function metricInspectionContext(
  compiled: CompiledChart,
  target: ChartInteraction<ResultRow> | null,
  series: string | null
): MetricInspectionContext | null {
  if (!target?.sources.length) return null;
  const rowIndices = sourceRowIndices(compiled, target.sources);
  if (rowIndices.includes(-1)) return null;
  const document = compiled.document;
  return copyInspectionContext(
    document,
    target.key,
    {
      kind: 'metric',
      rowIndices,
      series
    },
    {
      fields: document.data.fields,
      spec: document.spec,
      get rows() {
        return [...target.sources];
      },
      ...(document.semantics ? { semantics: document.semantics } : {}),
      ...(document.options?.values ? { values: document.options.values } : {})
    }
  );
}
