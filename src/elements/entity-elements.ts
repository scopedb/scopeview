import {
  compileTrace,
  createTraceView,
  type TraceSpan,
  type TraceDocument,
  type CompiledTrace
} from '../families/trace.js';
import {
  compileProfile,
  createProfileView,
  type ProfileFrame,
  type ProfileDocument,
  type CompiledProfile
} from '../families/profile.js';
import { HierarchyElement } from './hierarchy-element.js';

export class ScopeTraceElement extends HierarchyElement<TraceSpan, TraceDocument, CompiledTrace> {
  constructor() {
    super('trace', compileTrace, createTraceView);
  }
}
export class ScopeFlameElement extends HierarchyElement<
  ProfileFrame,
  ProfileDocument,
  CompiledProfile
> {
  constructor() {
    super('profile', compileProfile, createProfileView);
  }
}
export function defineScopeTrace() {
  if (!customElements.get('scope-trace')) customElements.define('scope-trace', ScopeTraceElement);
}
export function defineScopeFlame() {
  if (!customElements.get('scope-flame')) customElements.define('scope-flame', ScopeFlameElement);
}
declare global {
  interface HTMLElementTagNameMap {
    'scope-trace': ScopeTraceElement;
    'scope-flame': ScopeFlameElement;
  }
}
