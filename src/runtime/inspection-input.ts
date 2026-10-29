const dismissalOwners = new WeakSet<HTMLElement>();

/** The shell owns Canvas Escape even without a paint runtime or a cancelable event. */
export function ownInspectionDismissal(canvas: HTMLElement, signal: AbortSignal) {
  dismissalOwners.add(canvas);
  signal.addEventListener('abort', () => dismissalOwners.delete(canvas), { once: true });
}

export function ownsInspectionDismissal(canvas: HTMLElement) {
  return dismissalOwners.has(canvas);
}
