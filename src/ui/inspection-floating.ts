import type { PlotRect, Position } from '../core/scene.js';
import { placeChartTooltip } from './inspection-position.js';
const floatingObservers = new WeakMap<HTMLElement, ResizeObserver>();

/** Keep floating readings outside host clipping/transform contexts without reparenting. */
export function syncFloatingInspection(tooltip: HTMLElement) {
  if (tooltip.classList.contains('docked')) return true;
  if (tooltip.hidden || !tooltip.isConnected) {
    hideInspection(tooltip);
    return false;
  }
  const owner = (tooltip.getRootNode() as ShadowRoot).host ?? tooltip.parentElement;
  if (owner && typeof tooltip.showPopover === 'function' && !floatingObservers.has(tooltip)) {
    const observer = new ResizeObserver(() => syncFloatingInspection(tooltip));
    floatingObservers.set(tooltip, observer);
    observer.observe(owner);
  }
  const visible =
    tooltip.isConnected &&
    !!owner?.getClientRects().length &&
    getComputedStyle(owner).visibility !== 'hidden';
  if (!visible) {
    if (tooltip.popover && tooltip.matches(':popover-open')) tooltip.hidePopover();
    return false;
  }
  if (typeof tooltip.showPopover !== 'function') return true;
  tooltip.popover = 'manual';
  if (!tooltip.matches(':popover-open')) tooltip.showPopover();
  return true;
}

export function hideInspection(tooltip: HTMLElement) {
  floatingObservers.get(tooltip)?.disconnect();
  floatingObservers.delete(tooltip);
  if (tooltip.popover && tooltip.matches(':popover-open')) tooltip.hidePopover();
  tooltip.hidden = true;
}

/** Detail panels occupy their own flow area without guessing free viewport space. */
export function dockInspection(tooltip: HTMLElement, docked: boolean) {
  if (tooltip.classList.contains('docked') === docked) return;
  const hidden = tooltip.hidden;
  hideInspection(tooltip);
  tooltip.classList.toggle('docked', docked);
  if (docked) {
    tooltip.removeAttribute('popover');
    tooltip.style.removeProperty('left');
    tooltip.style.removeProperty('top');
    tooltip.style.removeProperty('max-height');
  }
  tooltip.hidden = hidden;
}

/** Apply shared floating placement to client coordinates supplied by each host. */
export function positionInspection(tooltip: HTMLElement, anchor: Position, avoid?: PlotRect) {
  if (tooltip.classList.contains('docked') || !syncFloatingInspection(tooltip)) return;
  const placement = placeChartTooltip(
    anchor,
    tooltip.getBoundingClientRect(),
    { width: innerWidth, height: innerHeight },
    avoid
  );
  tooltip.style.left = `${placement.left}px`;
  tooltip.style.top = `${placement.top}px`;
}
