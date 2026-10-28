import type { ViewStateChangeDetail } from '../core/view-state.js';
import type { ScopeControlsChangeDetail } from './controls.js';

export interface ScopeErrorDetail {
  message: string;
}

/** Events every ScopeView element dispatches. All events bubble and cross shadow roots. */
export interface ScopeCommonEventDetails {
  'scope-error': ScopeErrorDetail;
  'scope-controls-change': ScopeControlsChangeDetail;
  'scope-view-state-change': ViewStateChangeDetail;
}

export type ScopeEventMap<Details> = HTMLElementEventMap & {
  [K in keyof Details]: CustomEvent<Details[K]>;
};

export type ScopeEventListener<Target, Event> = (this: Target, event: Event) => unknown;
