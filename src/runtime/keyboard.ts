import type { ChartInteraction } from '../core/scene.js';
import type { ChartSession, InspectionNavigation } from '../core/session.js';

export function inspectionDirection(key: string): InspectionNavigation | null {
  return key === 'Home' || key === 'End'
    ? key
    : key === 'ArrowLeft' || key === 'ArrowUp'
      ? 'previous'
      : key === 'ArrowRight' || key === 'ArrowDown'
        ? 'next'
        : null;
}

/** Shared keyboard inspection navigation for runtimes. */
export function handleInspectionKey<Source>(
  event: KeyboardEvent,
  session: ChartSession<Source>,
  interactive: boolean | undefined,
  selectable: boolean,
  onUpdate: () => void,
  onNavigate?: (target: ChartInteraction<Source>) => void,
  signal?: AbortSignal
): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || interactive === false) return false;
  const k = event.key,
    d = inspectionDirection(k);
  if (k === 'Escape') {
    event.preventDefault();
    session.clearInspection();
  } else if (d || k === 'Enter' || k === ' ') {
    event.preventDefault();
    const t = d ? session.next(d) : (session.active ?? session.next('Home'));
    session.inspect(t?.key ?? null, !d && selectable, true);
    if (t) onNavigate?.(t);
  } else return false;
  // Navigation may paint synchronously and let host callbacks dismiss or dispose this reading.
  if (signal?.aborted) return true;
  onUpdate();
  return true;
}
