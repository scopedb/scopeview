import type { ReadingSession } from '../core/reading-session.js';
import { interactionFor, readingPhase } from '../core/interaction.js';
import { readingState } from '../core/reading-state.js';
import type { ReadingOptions } from './types.js';

/** Commit reading keys before navigation; publish the resulting state after navigation settles. */
export function inspectKey<Source>(
  event: KeyboardEvent,
  session: ReadingSession<Source>,
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
    const intent = readingState(session).intent;
    interaction.effect(() => {
      if (!signal.aborted && intent === readingState(session).intent) options.onNavigate?.(target);
    });
  }
  interaction.effect(
    () => {
      if (!signal.aborted) report();
    },
    {},
    readingPhase
  );
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
