import type { CompiledChart } from './document.js';

export function metricLayoutKind(compiled: CompiledChart) {
  const { displayType, mapping } = compiled.config;
  if (displayType === 'treemap') return 'treemap';
  if (displayType === 'top-list' || compiled.document.options?.orientation === 'horizontal')
    return 'top-list';
  return mapping.kind === 'distribution' ? 'donut' : mapping.kind;
}
