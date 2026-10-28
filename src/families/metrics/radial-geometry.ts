/** A ring sector in CSS pixels, including a complete single-category ring. */
export function ringSectorPath(
  cx: number,
  cy: number,
  start: number,
  end: number,
  outer: number,
  inner: number
): string {
  const at = (angle: number, radius: number) =>
    `${Number((cx + Math.cos(angle) * radius).toFixed(3))},${Number((cy + Math.sin(angle) * radius).toFixed(3))}`;
  const large = end - start > Math.PI ? 1 : 0;
  return end - start >= Math.PI * 2 - 1e-12
    ? `M${at(start, outer)}A${outer},${outer} 0 1 1 ${at(start + Math.PI, outer)}A${outer},${outer} 0 1 1 ${at(end, outer)}L${at(end, inner)}A${inner},${inner} 0 1 0 ${at(start + Math.PI, inner)}A${inner},${inner} 0 1 0 ${at(start, inner)}Z`
    : `M${at(start, outer)}A${outer},${outer} 0 ${large} 1 ${at(end, outer)}L${at(end, inner)}A${inner},${inner} 0 ${large} 0 ${at(start, inner)}Z`;
}
