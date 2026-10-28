import type { Position, SceneInteraction } from './scene.js';

/** Read supplied segment/sample geometry, never interpolate a source value from pointer y. */
export function inspectionSeriesAt(
  value: SceneInteraction<unknown> | null,
  position: Position
): string | null {
  const bar = value?.bars?.find(
    (bar) =>
      position.x >= bar.x &&
      position.x <= bar.x + bar.width &&
      position.y >= bar.y &&
      position.y <= bar.y + bar.height
  );
  if (bar) return bar.series;
  const area = value?.points.find(
    (point) =>
      point.baseY !== undefined &&
      point.baseY !== point.y &&
      position.y >= Math.min(point.baseY, point.y) &&
      position.y < Math.max(point.baseY, point.y)
  );
  if (area) return area.series ?? null;
  const point = value?.points.reduce<(typeof value.points)[number] | null>(
    (best, point) =>
      !best ||
      Math.hypot(point.x - position.x, point.y - position.y) <
        Math.hypot(best.x - position.x, best.y - position.y)
        ? point
        : best,
    null
  );
  return point && Math.hypot(point.x - position.x, point.y - position.y) <= 12
    ? (point.series ?? null)
    : null;
}
