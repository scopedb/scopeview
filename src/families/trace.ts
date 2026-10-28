import {
  hierarchy,
  documentHeader,
  entity,
  list,
  object,
  integer,
  text,
  fail,
  visibleSources,
  ratio,
  formatInteger,
  formatNanoseconds,
  type Entity,
  type EntityDocument,
  type Hierarchy,
  type HierarchyIssue
} from './hierarchy/model.js';
import {
  createView,
  layoutHierarchy,
  entityColor,
  type HierarchyItem,
  type HierarchyView
} from './hierarchy/layout.js';
import type { ChartScene, MeasureText, InspectionRow } from '../core/scene.js';
import type { ViewportState } from '../core/viewport.js';

export interface TraceSpan extends Entity {
  readonly startTimeNs: string;
  readonly endTimeNs: string;
  readonly service?: string;
  readonly status?: 'unset' | 'ok' | 'error';
}
export interface TraceDocument extends EntityDocument {
  kind: 'trace';
  spans: TraceSpan[];
  coverage?: 'complete' | 'partial' | 'unknown';
}
export interface TraceTiming {
  start: bigint;
  end: bigint;
  duration: bigint;
  coveredChildDuration: bigint;
  uncoveredDuration: bigint;
}
export interface CompiledTrace {
  kind: 'trace';
  document: TraceDocument;
  hierarchy: Hierarchy<TraceSpan>;
  timings: ReadonlyMap<string, TraceTiming>;
  startTimeNs: bigint;
  endTimeNs: bigint;
  durationNs: bigint;
  issues: readonly HierarchyIssue[];
}
export type TraceView = HierarchyView<TraceSpan>;

export function parseTraceDocument(value: unknown): TraceDocument {
  const input = object(value, 'document', [
    'version',
    'kind',
    'title',
    'description',
    'options',
    'spans',
    'coverage'
  ]);
  if (input.kind !== 'trace') fail('kind', 'Expected trace.');
  const spans = list(input.spans, 'spans').map((value, i) => {
    const path = `spans[${i}]`,
      input = object(value, path);
    const source: TraceSpan = {
      ...entity(value, path, ['startTimeNs', 'endTimeNs', 'service', 'status']),
      startTimeNs: integer(input.startTimeNs, `${path}.startTimeNs`, true),
      endTimeNs: integer(input.endTimeNs, `${path}.endTimeNs`, true),
      ...(input.service !== undefined ? { service: text(input.service, `${path}.service`) } : {})
    };
    if (BigInt(source.endTimeNs) < BigInt(source.startTimeNs))
      fail(`${path}.endTimeNs`, 'Must be at or after startTimeNs.');
    if (input.status !== undefined) {
      if (typeof input.status !== 'string' || !['unset', 'ok', 'error'].includes(input.status))
        fail(`${path}.status`, 'Expected unset, ok or error.');
      return { ...source, status: input.status as TraceSpan['status'] };
    }
    return source;
  });
  const result: TraceDocument = { ...documentHeader(input), kind: 'trace', spans };
  if (input.coverage !== undefined) {
    if (
      typeof input.coverage !== 'string' ||
      !['complete', 'partial', 'unknown'].includes(input.coverage)
    )
      fail('coverage', 'Expected complete, partial or unknown.');
    result.coverage = input.coverage as TraceDocument['coverage'];
  }
  return result;
}
export function compileTrace(input: unknown): CompiledTrace {
  const document = parseTraceDocument(input);
  const tree = hierarchy(document.spans, 'spans', (a, b) =>
    BigInt(a.startTimeNs) < BigInt(b.startTimeNs)
      ? -1
      : BigInt(a.startTimeNs) > BigInt(b.startTimeNs)
        ? 1
        : 0
  );
  const timings = new Map<string, TraceTiming>(),
    issues = [...tree.issues];
  let startTimeNs = 0n,
    endTimeNs = 0n;
  for (const [index, source] of document.spans.entries()) {
    const start = BigInt(source.startTimeNs),
      end = BigInt(source.endTimeNs);
    if (!index || start < startTimeNs) startTimeNs = start;
    if (!index || end > endTimeNs) endTimeNs = end;
    const intervals = (tree.children.get(source.id) ?? [])
      .map((child) => {
        const childStart = BigInt(child.startTimeNs),
          childEnd = BigInt(child.endTimeNs);
        if (childStart < start || childEnd > end)
          issues.push({ kind: 'outside-parent', id: child.id, parentId: source.id });
        return {
          start: childStart < start ? start : childStart,
          end: childEnd > end ? end : childEnd
        };
      })
      .filter((interval) => interval.start < interval.end)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    let coveredChildDuration = 0n,
      right = start;
    for (const interval of intervals) {
      const left = interval.start > right ? interval.start : right;
      if (interval.end > left) coveredChildDuration += interval.end - left;
      if (interval.end > right) right = interval.end;
    }
    timings.set(source.id, {
      start,
      end,
      duration: end - start,
      coveredChildDuration,
      uncoveredDuration: end - start - coveredChildDuration
    });
  }
  return {
    kind: 'trace',
    document,
    hierarchy: tree,
    timings,
    startTimeNs,
    endTimeNs,
    durationNs: endTimeNs - startTimeNs,
    issues
  };
}

class Heap<T> {
  private values: T[] = [];
  constructor(private less: (a: T, b: T) => boolean) {}
  get first() {
    return this.values[0];
  }
  push(value: T) {
    let i = this.values.push(value) - 1;
    while (i) {
      const parent = (i - 1) >>> 1;
      if (!this.less(value, this.values[parent])) break;
      this.values[i] = this.values[parent];
      i = parent;
    }
    this.values[i] = value;
  }
  pop(): T | undefined {
    const first = this.values[0],
      value = this.values.pop();
    if (!this.values.length || value === undefined) return first;
    let i = 0;
    while (2 * i + 1 < this.values.length) {
      let child = 2 * i + 1;
      if (child + 1 < this.values.length && this.less(this.values[child + 1], this.values[child]))
        child++;
      if (!this.less(this.values[child], value)) break;
      this.values[i] = this.values[child];
      i = child;
    }
    this.values[i] = value;
    return first;
  }
}
/** Pack parallel intervals in independent lanes within each depth; never add sibling durations. */
export function createTraceView(
  compiled: CompiledTrace,
  collapsed: ReadonlySet<string> = new Set()
): TraceView {
  const sources = visibleSources(compiled.hierarchy, collapsed),
    levels = new Map<number, TraceSpan[]>(),
    rows = new Map<string, number>();
  for (const source of sources) {
    const depth = compiled.hierarchy.depth.get(source.id)!,
      values = levels.get(depth) ?? [];
    values.push(source);
    levels.set(depth, values);
  }
  let rowCount = 0;
  for (const [, values] of [...levels].sort(([a], [b]) => a - b)) {
    values.sort((a, b) =>
      compiled.timings.get(a.id)!.start < compiled.timings.get(b.id)!.start
        ? -1
        : compiled.timings.get(a.id)!.start > compiled.timings.get(b.id)!.start
          ? 1
          : 0
    );
    const active = new Heap<{ end: bigint; lane: number }>(
        (a, b) => a.end < b.end || (a.end === b.end && a.lane < b.lane)
      ),
      free = new Heap<number>((a, b) => a < b);
    let count = 0;
    for (const source of values) {
      const timing = compiled.timings.get(source.id)!;
      while (active.first && active.first.end <= timing.start) free.push(active.pop()!.lane);
      const lane = free.pop() ?? count++;
      rows.set(source.id, rowCount + lane);
      active.push({ end: timing.end, lane });
    }
    rowCount += count;
  }
  const issuesById = new Map<string, HierarchyIssue[]>();
  for (const issue of compiled.issues) {
    const values = issuesById.get(issue.id) ?? [];
    values.push(issue);
    issuesById.set(issue.id, values);
  }
  const items: HierarchyItem<TraceSpan>[] = sources.map((source) => {
    const timing = compiled.timings.get(source.id)!,
      color =
        source.status === 'error'
          ? 'var(--color-chart-semantic-error)'
          : entityColor(source.service ?? source.name);
    const sourceIssues = issuesById.get(source.id) ?? [];
    const annotations: InspectionRow[] = [
      ...(source.status
        ? [
            {
              label: 'Status',
              value: source.status,
              ...(source.status === 'error' ? { tone: 'danger' as const } : {})
            }
          ]
        : []),
      ...(sourceIssues.length
        ? [
            {
              label: 'Relationships',
              tone: 'warning' as const,
              value: sourceIssues
                .map((issue) =>
                  issue.kind === 'missing-parent' ? 'Missing parent' : 'Outside parent interval'
                )
                .join('; ')
            }
          ]
        : [])
    ];
    return {
      id: source.id,
      start: ratio(timing.start - compiled.startTimeNs, compiled.durationNs),
      end: ratio(timing.end - compiled.startTimeNs, compiled.durationNs),
      row: rows.get(source.id)!,
      color,
      interaction: {
        key: `trace:${source.id}`,
        sources: [source],
        tooltip: {
          title: source.name,
          context: source.service,
          color,
          previewRows: [
            { label: 'Duration', value: formatNanoseconds(timing.duration, 1n), format: 'number' },
            ...annotations.filter((row) => row.label !== 'Status' || row.value === 'error')
          ],
          rows: [
            {
              label: 'Duration',
              format: 'number',
              value: `${formatNanoseconds(timing.duration)} (${formatInteger(timing.duration)} ns)`
            },
            {
              label: 'Uncovered time (supplied children)',
              format: 'number',
              value: `${formatInteger(timing.uncoveredDuration)} ns`
            },
            { label: 'Start (ns)', value: source.startTimeNs, format: 'code' },
            { label: 'End (ns)', value: source.endTimeNs, format: 'code' },
            ...annotations
          ]
        }
      }
    };
  });
  return createView({
    kind: 'trace',
    document: compiled.document,
    items,
    collapsed: new Set(collapsed),
    rowCount,
    issues: compiled.issues,
    domainSize: compiled.durationNs,
    formatValue: formatNanoseconds,
    axisTitle: 'Elapsed time from earliest supplied span'
  });
}
export function layoutTrace(
  view: TraceView,
  width: number,
  height: number,
  measure: MeasureText,
  viewport?: ViewportState
): ChartScene<TraceSpan> {
  return layoutHierarchy(view, width, height, measure, viewport);
}
