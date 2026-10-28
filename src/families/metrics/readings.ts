import type { CompiledChart } from './document.js';
import type { LegendColumn } from '../component-options.js';
import { chartColumn } from './dataset.js';
import { groupSeriesName } from './prepared.js';
import { formatQuantity, type QuantityDisplay } from '../../data/semantics.js';

/** Source-domain summaries: NULLs are excluded from arithmetic, never converted to zero. */
export function legendReadings(compiled: CompiledChart, columns: readonly LegendColumn[]) {
  const { dataset, config } = compiled;
  if (!columns.length) return new Map<string, string[]>();
  const groups = new Map<
    string,
    { raw: string | null; order: number; display?: QuantityDisplay }[]
  >();
  const mapping = config.mapping;
  if (mapping.kind !== 'axis' && mapping.kind !== 'distribution')
    return new Map<string, string[]>();
  const dimension = mapping.kind === 'axis' ? mapping.groupBy : mapping.category;
  const category = dimension ? chartColumn(dataset, dimension)! : null;
  const metrics = (mapping.kind === 'axis' ? mapping.y : [mapping.value]).map(
    (id) => chartColumn(dataset, id)!
  );
  const x = mapping.kind === 'axis' ? chartColumn(dataset, mapping.x)! : null;
  for (const row of dataset.rows) {
    if (x && row.values[x.columnIndex] === null) continue;
    for (const metric of metrics) {
      const name = category ? groupSeriesName(row.source[category.columnIndex]) : metric.label;
      const values = groups.get(name) ?? [];
      const position = x ? row.values[x.columnIndex] : null;
      values.push({
        raw: row.source[metric.columnIndex],
        order: position instanceof Date ? Number(position) : values.length,
        display: compiled.displays.get(metric.id)
      });
      groups.set(name, values);
    }
  }
  return new Map(
    compiled.series.map((series) => {
      const returned = groups.get(series.name) ?? [];
      const samples = returned.filter((sample) => sample.raw !== null);
      const display = returned[0]?.display;
      const integers = samples.every((sample) => /^[+-]?\d+$/.test(sample.raw!));
      const sum = integers
        ? String(samples.reduce((total, sample) => total + BigInt(sample.raw!), 0n))
        : String(samples.reduce((total, sample) => total + Number(sample.raw), 0));
      const values = columns.map((column) => {
        if (!returned.length) return '—';
        if (column === 'last') {
          const last = returned.reduce((a, b) => (a.order > b.order ? a : b));
          return formatQuantity(last.raw, last.display);
        }
        if (!samples.length) return 'NULL';
        if (column === 'avg' && integers)
          return formatQuantity(sum, {
            divisor: String(BigInt(display?.divisor ?? '1') * BigInt(samples.length)),
            decimals: display?.decimals ?? 2,
            unit: display?.unit
          });
        if (column === 'min' || column === 'max') {
          const selected = samples.reduce((a, b) => {
            const smaller = integers
              ? BigInt(a.raw!) < BigInt(b.raw!)
              : Number(a.raw) < Number(b.raw);
            return (column === 'min' ? smaller : !smaller) ? a : b;
          });
          return formatQuantity(selected.raw, selected.display);
        }
        const raw = column === 'avg' ? String(Number(sum) / samples.length) : sum;
        return integers || Number.isFinite(Number(raw)) ? formatQuantity(raw, display) : '—';
      });
      return [series.name, values];
    })
  );
}
