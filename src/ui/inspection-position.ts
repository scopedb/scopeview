import {
  tooltipGap as tokenTooltipGap,
  tooltipInset as tokenTooltipInset,
  tooltipOffsetY as tokenTooltipOffsetY
} from '../theme/visual-tokens.js';

/** Fixed, viewport-bounded placement lets short charts expose their complete series list. */
export function placeChartTooltip(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  avoid?: { x: number; y: number; width: number; height: number }
) {
  const edge = tokenTooltipInset,
    gap = tokenTooltipGap;
  const clamp = (value: number, size: number, limit: number) =>
    Math.max(edge, Math.min(value, limit - size - edge));
  if (avoid) {
    const right = avoid.x + avoid.width + gap,
      left = avoid.x - size.width - gap;
    if (right + size.width <= viewport.width - edge || left >= edge)
      return {
        left: right + size.width <= viewport.width - edge ? right : left,
        top: clamp(avoid.y, size.height, viewport.height)
      };
    const below = avoid.y + avoid.height + gap,
      above = avoid.y - size.height - gap;
    return {
      left: clamp(avoid.x + avoid.width / 2 - size.width / 2, size.width, viewport.width),
      top: clamp(
        below + size.height <= viewport.height - edge ? below : above,
        size.height,
        viewport.height
      )
    };
  }
  const right = anchor.x + gap + size.width <= viewport.width - edge,
    left = anchor.x - size.width - gap >= edge;
  const preferred = right ? anchor.x + gap : anchor.x - size.width - gap;
  let top = anchor.y - tokenTooltipOffsetY;
  // When neither side fits, move below/above the inspected point instead of covering it.
  if (!right && !left) {
    if (anchor.y + gap + size.height <= viewport.height - edge) top = anchor.y + gap;
    else if (anchor.y - gap - size.height >= edge) top = anchor.y - gap - size.height;
  }
  return {
    left: clamp(preferred, size.width, viewport.width),
    top: clamp(top, size.height, viewport.height)
  };
}
