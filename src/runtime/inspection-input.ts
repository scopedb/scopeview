import type { ChartSession } from '../core/session.js';
import { interactionFor, readingPhase } from '../core/interaction.js';
import { sessionRevision } from '../core/session.js';
import type { ReadingOptions } from './types.js';

/** Commit reading keys before navigation; publish the resulting state after navigation settles. */
export function inspectKey<Source>(
  event: KeyboardEvent,
  session: ChartSession<Source>,
  selectable: boolean,
  signal: AbortSignal,
  options: Pick<ReadingOptions<Source>, 'onNavigate'>,
  report: () => void
) {
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
  const target =
    key === 'Escape'
      ? null
      : direction
        ? session.next(direction)
        : (session.active ?? session.next('Home'));
  if (key === 'Escape') session.clearInspection();
  else session.inspect(target?.key ?? null, !direction && selectable, true);
  const interaction = interactionFor(session);
  if (target) {
    const revision = sessionRevision(session),
      intent = revision.intent;
    interaction.effect(
      () => options.onNavigate?.(target),
      {},
      0,
      () => !signal.aborted && intent === revision.intent
    );
  }
  interaction.effect(report, {}, readingPhase, () => !signal.aborted);
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
