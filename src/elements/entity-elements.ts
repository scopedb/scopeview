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
import type {
  TraceInspectionContext,
  ProfileInspectionContext
} from '../core/inspection-context.js';
import {
  traceInspectionContext,
  profileInspectionContext
} from '../families/hierarchy/inspection-context.js';

export class ScopeTraceElement extends HierarchyElement<
  TraceSpan,
  TraceDocument,
  CompiledTrace,
  TraceInspectionContext
> {
  constructor() {
    super('trace', compileTrace, createTraceView, traceInspectionContext);
  }
}
export class ScopeFlameElement extends HierarchyElement<
  ProfileFrame,
  ProfileDocument,
  CompiledProfile,
  ProfileInspectionContext
> {
  constructor() {
    super('profile', compileProfile, createProfileView, profileInspectionContext);
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
