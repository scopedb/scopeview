import type { ChartScene, Position, SceneInteraction, SceneMark, PlotRect } from './scene.js';

/** Ordered axis targets share one hit policy across painters and hosts. */
export function nearestInteraction<Source>(
  model: ChartScene<Source>,
  position: Position
): SceneInteraction<Source> | null {
  const r = model.rect,
    values = model.interactions;
  if (
    !r ||
    position.x < r.x ||
    position.x > r.x + r.width ||
    position.y < r.y ||
    position.y > r.y + r.height ||
    !values.length
  )
    return null;
  let left = 0,
    right = values.length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (values[mid].anchor.x < position.x) left = mid + 1;
    else right = mid;
  }
  const a = values[Math.max(0, left - 1)],
    b = values[Math.min(left, values.length - 1)];
  if (model.hitMode === 'bar' || (a.time?.end !== undefined && b.time?.end !== undefined)) {
    // Partial edge buckets have narrower bands. Check actual bounds before distance.
    return (
      [a, b].find(
        (value) =>
          value.band &&
          position.x >= value.band.x &&
          (value.time?.end !== undefined
            ? position.x < value.band.x + value.band.width
            : position.x <= value.band.x + value.band.width)
      ) ?? null
    );
  }
  const best = Math.abs(a.anchor.x - position.x) <= Math.abs(b.anchor.x - position.x) ? a : b;
  if (best.band)
    return position.x >= best.band.x && position.x <= best.band.x + best.band.width ? best : null;
  return Math.abs(best.anchor.x - position.x) <= 48 ? best : null;
}

type Entry = { mark: SceneMark; order: number; bounds?: PlotRect };
export type PathHit = (mark: Extract<SceneMark, { kind: 'path' }>, position: Position) => boolean;
function contains(rect: PlotRect, p: Position) {
  return (
    p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height
  );
}

function cellKey(x: number, y: number): number {
  return (x << 16) | (y & 0xffff);
}
function circleHit(mark: Extract<SceneMark, { kind: 'circle' }>, p: Position) {
  return Math.hypot(p.x - mark.x, p.y - mark.y) <= mark.radius + 0.75;
}

/** CSS-pixel item lookup, shared by SVG and Canvas. Later-painted items win. */
export class SceneHitIndex<Source> {
  #scene: ChartScene<Source>;
  #cells = new Map<number, Entry[]>();
  #global: Entry[] = [];
  constructor(scene: ChartScene<Source>) {
    this.#scene = scene;
    if (scene.hitMode !== 'item') return;
    let order = 0;
    for (const mark of scene.marks) {
      const entry: Entry = { mark, order: order++ };
      if (!mark.key || mark.kind === 'text') continue;
      if (mark.kind === 'path') {
        this.#global.push(entry);
        continue;
      }
      const radius = mark.kind === 'circle' ? mark.radius + 0.75 : 0;
      const bounds =
        mark.kind === 'rect'
          ? (scene.interactionByKey.get(mark.key)?.hitRect ?? mark)
          : {
              x: mark.x - radius,
              y: mark.y - radius,
              width: radius * 2,
              height: radius * 2
            };
      entry.bounds = bounds;
      const left = Math.floor(Math.max(0, bounds.x) / 64),
        right = Math.floor(Math.min(scene.width, bounds.x + bounds.width) / 64),
        top = Math.floor(Math.max(0, bounds.y) / 64),
        bottom = Math.floor(Math.min(scene.height, bounds.y + bounds.height) / 64);
      // Large primitives stay in a bounded fallback instead of filling every cell.
      if ((right - left + 1) * (bottom - top + 1) > 256) this.#global.push(entry);
      else
        for (let x = left; x <= right; x++)
          for (let y = top; y <= bottom; y++) {
            const key = cellKey(x, y);
            let values = this.#cells.get(key);
            if (!values) {
              values = [];
              this.#cells.set(key, values);
            }
            values.push(entry);
          }
    }
  }
  #cell(position: Position) {
    return this.#cells.get(cellKey(Math.floor(position.x / 64), Math.floor(position.y / 64)));
  }
  #outside(p: Position, checkClip: boolean) {
    const s = this.#scene,
      clip = checkClip ? (s.clipRect ?? s.rect) : null;
    return (
      s.interactive === false ||
      !(
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        p.x >= 0 &&
        p.x <= s.width &&
        p.y >= 0 &&
        p.y <= s.height
      ) ||
      (!!clip && !contains(clip, p))
    );
  }
  hit(position: Position, pathHit?: PathHit): SceneInteraction<Source> | null {
    const scene = this.#scene;
    if (this.#outside(position, false)) return null;
    if (scene.hitMode !== 'item') return nearestInteraction(scene, position);
    if (this.#outside(position, true)) return null;
    let winner: Entry | null = null;
    for (const candidates of [this.#cell(position), this.#global])
      if (candidates)
        for (let i = candidates.length - 1; i >= 0; i--) {
          const entry = candidates[i],
            mark = entry.mark;
          if (winner && entry.order <= winner.order) break;
          if (!scene.interactionByKey.has(mark.key!)) continue;
          const hit =
            mark.kind === 'rect'
              ? mark.fill !== 'none' &&
                mark.width > 0 &&
                mark.height > 0 &&
                contains(entry.bounds ?? mark, position)
              : mark.kind === 'circle'
                ? circleHit(mark, position)
                : mark.kind === 'path' && !!pathHit?.(mark, position);
          if (hit) {
            winner = entry;
            break;
          }
        }
    return winner ? (scene.interactionByKey.get(winner.mark.key!) ?? null) : null;
  }
  /** Disclose overlapping point targets without jitter or changing the single-hit policy. */
  pointHits(position: Position): SceneInteraction<Source>[] {
    const scene = this.#scene;
    if (scene.emphasis !== 'point' || this.#outside(position, true)) return [];
    const entries: Entry[] = [];
    for (const candidates of [this.#cell(position), this.#global])
      if (candidates)
        for (const entry of candidates) {
          const { mark } = entry;
          if (mark.kind === 'circle' && mark.radius > 0 && circleHit(mark, position))
            entries.push(entry);
        }
    if (!entries.length) return [];
    const keys = new Set<string>(),
      result: SceneInteraction<Source>[] = [];
    for (const { mark } of entries.sort((a, b) => a.order - b.order)) {
      const value = scene.interactionByKey.get(mark.key!);
      if (value && !keys.has(value.key)) {
        keys.add(value.key);
        result.push(value);
      }
    }
    return result;
  }
}
