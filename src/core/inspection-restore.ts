import { type ChartSession, sessionRevision } from './session.js';

/** Commit now; replay on a later model only while no newer reading command has won. */
export function restoreInspection<Source>(
  session: ChartSession<Source> | null,
  key: string | null
) {
  session?.restorePin(key);
  const revision = session && sessionRevision(session);
  const intent = revision?.intent;
  return () => (revision?.intent === intent ? key : undefined);
}
