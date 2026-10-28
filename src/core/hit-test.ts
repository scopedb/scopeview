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

/** CSS-pixel item lookup, shared by SVG and Canvas. Later-painted items win. */
export class SceneHitIndex<Source> {
  #cells = new Map<string, Entry[]>();
  #global: Entry[] = [];
  constructor(private scene: ChartScene<Source>) {
    if (scene.hitMode !== 'item') return;
    scene.marks.forEach((mark, order) => {
      if (!mark.key || mark.kind === 'text') return;
      const entry: Entry = { mark, order };
      if (mark.kind === 'path') {
        this.#global.push(entry);
        return;
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
            const key = `${x}:${y}`,
              values = this.#cells.get(key) ?? [];
            values.push(entry);
            this.#cells.set(key, values);
          }
    });
  }
  hit(position: Position, pathHit?: PathHit): SceneInteraction<Source> | null {
    const scene = this.scene;
    if (
      scene.interactive === false ||
      !contains({ x: 0, y: 0, width: scene.width, height: scene.height }, position)
    )
      return null;
    if (scene.hitMode !== 'item') return nearestInteraction(scene, position);
    const clip = scene.clipRect ?? scene.rect;
    if (clip && !contains(clip, position)) return null;
    let winner: Entry | null = null;
    const values =
      this.#cells.get(`${Math.floor(position.x / 64)}:${Math.floor(position.y / 64)}`) ?? [];
    for (const candidates of [values, this.#global])
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
              ? Math.hypot(position.x - mark.x, position.y - mark.y) <= mark.radius + 0.75
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
    const scene = this.scene,
      clip = scene.clipRect ?? scene.rect;
    if (
      scene.interactive === false ||
      scene.emphasis !== 'point' ||
      !contains({ x: 0, y: 0, width: scene.width, height: scene.height }, position) ||
      (clip && !contains(clip, position))
    )
      return [];
    const entries = [
      ...(this.#cells.get(`${Math.floor(position.x / 64)}:${Math.floor(position.y / 64)}`) ?? []),
      ...this.#global
    ].filter(
      ({ mark }) =>
        mark.kind === 'circle' &&
        mark.radius > 0 &&
        Math.hypot(position.x - mark.x, position.y - mark.y) <= mark.radius + 0.75
    );
    const keys = new Set<string>();
    return entries
      .sort((a, b) => a.order - b.order)
      .flatMap(({ mark }) => {
        const value = scene.interactionByKey.get(mark.key!);
        if (!value || keys.has(value.key)) return [];
        keys.add(value.key);
        return [value];
      });
  }
}
