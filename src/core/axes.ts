import type { Tick } from './scene.js';

/** Keep domain references and zero without changing the underlying scale or geometry. */
export function sparseTicks(ticks: readonly Tick[], count: number, zero?: number): Tick[] {
  if (ticks.length <= count) return [...ticks];
  const indexes = new Set([0, ticks.length - 1]);
  const baseline = ticks.findIndex((tick) => tick.position === zero);
  if (baseline > 0 && baseline < ticks.length - 1) indexes.add(baseline);
  for (let i = 1; i < count - 1 && indexes.size < count; i++)
    indexes.add(Math.round((i * (ticks.length - 1)) / (count - 1)));
  return [...indexes].sort((a, b) => a - b).map((index) => ticks[index]);
}
