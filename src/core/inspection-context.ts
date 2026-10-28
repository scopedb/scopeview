import type { ResultField, ResultRow } from '../data/result.js';
import type { ChartDocument } from '../families/metrics/document.js';
import type { ChartSpec } from '../families/metrics/spec.js';
import type { EntityDocument } from '../families/hierarchy/model.js';
import type { TraceDocument, TraceSpan } from '../families/trace.js';
import type { ProfileFrame } from '../families/profile.js';

interface InspectionContextBase {
  version: 1;
  /** Opaque identity of this document snapshot, not a content hash or a query ID. */
  snapshotId: string;
  key: string;
  title?: string;
  description?: string;
}

export interface MetricInspectionContext extends InspectionContextBase {
  kind: 'metric';
  fields: ResultField[];
  spec: ChartSpec;
  /** Zero-based source positions; repeated equal rows remain distinct. */
  rowIndices: number[];
  rows: ResultRow[];
  /** The inspected or selected series, independent of other pointer readings. */
  series: string | null;
  semantics?: ChartDocument['semantics'];
  values?: NonNullable<ChartDocument['options']>['values'];
}

export interface TraceInspectionContext extends InspectionContextBase {
  kind: 'trace';
  span: TraceSpan;
  /** Supplied ancestors in root-to-parent order; missing parents are not invented. */
  ancestors: TraceSpan[];
  durationNs: string;
  coverage: NonNullable<TraceDocument['coverage']>;
}

export interface ProfileInspectionContext extends InspectionContextBase {
  kind: 'profile';
  frame: ProfileFrame;
  ancestors: ProfileFrame[];
  unit: string;
  /** Exact inclusive weight of the frame and total supplied profile weight. */
  totalWeight: string;
  profileTotalWeight: string;
}

export type HierarchyInspectionContext = TraceInspectionContext | ProfileInspectionContext;
export type InspectionContext = MetricInspectionContext | HierarchyInspectionContext;

/** Create an event's context once on first read, retaining its captured snapshot. */
export function withInspectionContext<Detail extends object, Context extends InspectionContext>(
  detail: Detail,
  create: (() => Context | null) | null
): Detail & { context: Context | null } {
  let value: Context | null = null;
  return Object.defineProperty(detail, 'context', {
    configurable: true,
    enumerable: true,
    get() {
      if (create) {
        value = create();
        create = null;
      }
      return value;
    },
    set(next: Context | null) {
      value = next;
      create = null;
    }
  }) as Detail & { context: Context | null };
}

const snapshots = new WeakMap<object, string>();

/** Capture snapshot metadata now; copy family data together on its first read. */
export function copyInspectionContext<Detail extends { kind: InspectionContext['kind'] }>(
  document: EntityDocument,
  key: string,
  detail: Detail
): Detail & InspectionContextBase {
  let snapshotId = snapshots.get(document);
  if (!snapshotId) {
    snapshotId = Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) =>
      part.toString(16).padStart(8, '0')
    ).join('');
    snapshots.set(document, snapshotId);
  }
  const context = {
    version: 1 as const,
    snapshotId,
    key,
    kind: detail.kind,
    ...(document.title !== undefined ? { title: document.title } : {}),
    ...(document.description !== undefined ? { description: document.description } : {})
  };
  let value = detail;
  let pending = true;
  const read = () => {
    if (pending) {
      value = structuredClone(value);
      pending = false;
    }
    return value;
  };
  for (const name of Object.keys(detail) as (keyof Detail)[]) {
    if (name === 'kind') continue;
    Object.defineProperty(context, name, {
      configurable: true,
      enumerable: true,
      get: () => read()[name],
      set: (next) => {
        read()[name] = next;
      }
    });
  }
  return context as Detail & InspectionContextBase;
}
