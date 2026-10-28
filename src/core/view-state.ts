import { ChartValidationError, object, choice } from '../data/validation.js';
import type { ViewportState } from './viewport.js';

export const VIEW_STATE_VERSION = 1 as const;
export interface MetricViewState {
  version: 1;
  kind: 'metric';
  pinnedKey: string | null;
  hiddenSeries: string[];
}
export interface HierarchyViewState {
  version: 1;
  kind: 'trace' | 'profile';
  pinnedKey: string | null;
  viewport: ViewportState;
  collapsed: string[];
}
/** Durable reading state. Hover, source objects, callbacks and queries are never serialized. */
export type ViewState = MetricViewState | HierarchyViewState;
export interface DocumentUpdateOptions {
  /** Opt in only when the new snapshot uses the same family-owned identities. */
  preserveViewState?: boolean;
}
export interface ViewStateChangeDetail {
  state: ViewState;
  reason: 'interaction' | 'restore' | 'document' | 'reconcile';
}

function fail(path: string, message: string): never {
  throw new ChartValidationError(`viewState.${path}`, message);
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > 16_384) fail(path, 'Expected bounded text.');
  return value;
}
function list(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > 100_000) fail(path, 'Expected a bounded list.');
  return [...new Set(value.map((item, i) => text(item, `${path}[${i}]`)))].sort();
}
/** Validate untrusted saved JSON and return an owned, canonical snapshot. */
export function parseViewState(value: unknown): ViewState {
  const input = object(value, 'viewState');
  object(input, 'viewState', [
    'version',
    'kind',
    'pinnedKey',
    ...(input.kind === 'metric' ? ['hiddenSeries'] : ['viewport', 'collapsed'])
  ]);
  if (input.version !== VIEW_STATE_VERSION) fail('version', 'Expected version 1.');
  const pinnedKey = input.pinnedKey === null ? null : text(input.pinnedKey, 'pinnedKey');
  if (input.kind === 'metric')
    return {
      version: 1,
      kind: 'metric',
      pinnedKey,
      hiddenSeries: list(input.hiddenSeries, 'hiddenSeries')
    };
  const kind = choice(input.kind, ['trace', 'profile'], 'viewState.kind');
  const viewport = object(input.viewport, 'viewState.viewport', [
    'start',
    'end',
    'scrollOffset'
  ]) as unknown as ViewportState;
  if (
    ![viewport.start, viewport.end, viewport.scrollOffset].every(Number.isFinite) ||
    viewport.start < 0 ||
    viewport.end > 1 ||
    viewport.start >= viewport.end ||
    viewport.scrollOffset < 0
  )
    fail('viewport', 'Expected 0 <= start < end <= 1 and scrollOffset >= 0.');
  return {
    version: 1,
    kind,
    pinnedKey,
    viewport: { start: viewport.start, end: viewport.end, scrollOffset: viewport.scrollOffset },
    collapsed: list(input.collapsed, 'collapsed')
  };
}

export interface ViewStateTargets {
  interactionKeys: ReadonlySet<string>;
  seriesNames?: ReadonlySet<string>;
  collapsibleIds?: ReadonlySet<string>;
}
/** Missing identities are removed, never reassigned to a neighbouring row or node. */
export function reconcileViewState<T extends ViewState>(state: T, targets: ViewStateTargets): T {
  const result = parseViewState(state);
  if (result.pinnedKey !== null && !targets.interactionKeys.has(result.pinnedKey))
    result.pinnedKey = null;
  if (result.kind === 'metric')
    result.hiddenSeries = result.hiddenSeries.filter((name) => targets.seriesNames?.has(name));
  else result.collapsed = result.collapsed.filter((id) => targets.collapsibleIds?.has(id));
  return result as T;
}
