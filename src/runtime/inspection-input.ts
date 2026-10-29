import type { ReadingSession } from '../core/reading-session.js';
import type { ChartInteraction } from '../core/scene.js';

/** Accept common reading keys; undefined leaves an unrelated key to its owner. */
export function inspectKey<Source>(
  event: KeyboardEvent,
  session: ReadingSession<Source>,
  selectable: boolean
): ChartInteraction<Source> | null | undefined {
  const key = event.key;
  const direction =
    key === 'Home' || key === 'End'
      ? key
      : key === 'ArrowLeft' || key === 'ArrowUp'
        ? 'previous'
        : key === 'ArrowRight' || key === 'ArrowDown'
          ? 'next'
          : null;
  if (!direction && key !== 'Enter' && key !== ' ' && key !== 'Escape') return;
  event.preventDefault();
  if (key === 'Escape') {
    session.clearInspection();
    return null;
  }
  const target = direction ? session.next(direction) : (session.active ?? session.next('Home'));
  session.inspect(target?.key ?? null, !direction && selectable, true);
  return target;
}

const dismissalOwners = new WeakSet<HTMLElement>();

/** The shell owns Canvas Escape even without a paint runtime or a cancelable event. */
export function ownInspectionDismissal(canvas: HTMLElement, signal: AbortSignal) {
  dismissalOwners.add(canvas);
  signal.addEventListener('abort', () => dismissalOwners.delete(canvas), { once: true });
}

export function ownsInspectionDismissal(canvas: HTMLElement) {
  return dismissalOwners.has(canvas);
}
