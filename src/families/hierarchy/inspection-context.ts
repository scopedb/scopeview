import type { ChartInteraction } from '../../core/scene.js';
import {
  copyInspectionContext,
  type TraceInspectionContext,
  type ProfileInspectionContext
} from '../../core/inspection-context.js';
import type { CompiledTrace, TraceSpan } from '../trace.js';
import type { CompiledProfile, ProfileFrame } from '../profile.js';
import type { Entity, Hierarchy } from './model.js';

function ancestors<Source extends Entity>(source: Source, hierarchy: Hierarchy<Source>) {
  const result: Source[] = [];
  let parent = source.parentId ? hierarchy.byId.get(source.parentId) : undefined;
  while (parent) {
    result.push(parent);
    parent = parent.parentId ? hierarchy.byId.get(parent.parentId) : undefined;
  }
  return result.reverse();
}

export function traceInspectionContext(
  compiled: CompiledTrace,
  target: ChartInteraction<TraceSpan> | null
): TraceInspectionContext | null {
  const span = target?.sources[0];
  if (!target || !span || compiled.hierarchy.byId.get(span.id) !== span) return null;
  return copyInspectionContext(compiled.document, target.key, {
    kind: 'trace',
    span,
    get ancestors() {
      return ancestors(span, compiled.hierarchy);
    },
    durationNs: compiled.timings.get(span.id)!.duration.toString(),
    coverage: compiled.document.coverage ?? 'unknown'
  });
}

export function profileInspectionContext(
  compiled: CompiledProfile,
  target: ChartInteraction<ProfileFrame> | null
): ProfileInspectionContext | null {
  const frame = target?.sources[0];
  if (!target || !frame || compiled.hierarchy.byId.get(frame.id) !== frame) return null;
  return copyInspectionContext(compiled.document, target.key, {
    kind: 'profile',
    frame,
    get ancestors() {
      return ancestors(frame, compiled.hierarchy);
    },
    unit: compiled.document.unit,
    totalWeight: compiled.weights.get(frame.id)!.total.toString(),
    profileTotalWeight: compiled.totalWeight.toString()
  });
}
