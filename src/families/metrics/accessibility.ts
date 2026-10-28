import { type ChartDataset, chartColumnLabel } from './dataset.js';
import type { ChartConfig } from './spec.js';

export function chartAriaLabel(dataset: ChartDataset, config: ChartConfig): string {
  const { mapping, displayType } = config;
  if (mapping.kind === 'scatter') {
    const size = mapping.size ? `, sized by ${chartColumnLabel(dataset, mapping.size)}` : '';
    const color = mapping.color
      ? ` and colored by ${chartColumnLabel(dataset, mapping.color)}`
      : '';
    return `${chartColumnLabel(dataset, mapping.y)} by ${chartColumnLabel(dataset, mapping.x)} scatter plot${size}${color}`;
  }
  if (mapping.kind === 'axis') {
    const metrics = mapping.y.map((id) => chartColumnLabel(dataset, id)).join(', ');
    const series = mapping.groupBy ? ` by ${chartColumnLabel(dataset, mapping.groupBy)}` : '';
    return `${displayType} chart of ${metrics} over ${chartColumnLabel(dataset, mapping.x)}${series}`;
  }
  if (mapping.kind === 'distribution') {
    const family =
      displayType === 'pie' ? 'Donut' : displayType === 'treemap' ? 'Treemap' : 'Top list';
    return `${family} chart of ${chartColumnLabel(dataset, mapping.value)} by ${chartColumnLabel(dataset, mapping.category)}`;
  }
  return `Value summary for ${mapping.values.map((id) => chartColumnLabel(dataset, id)).join(', ')}`;
}

export function chartAriaDescription(dataset: ChartDataset): string {
  const rowLabel = dataset.rows.length === 1 ? 'row' : 'rows';
  return `${dataset.rows.length} result ${rowLabel}. Use arrow keys to inspect values.`;
}
