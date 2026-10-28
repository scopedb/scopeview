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
  type Entity,
  type EntityDocument,
  type Hierarchy
} from './hierarchy/model.js';
import {
  createView,
  layoutHierarchy,
  entityColor,
  type HierarchyView
} from './hierarchy/layout.js';
import type { ChartScene, InspectionRow, MeasureText } from '../core/scene.js';
import type { ViewportState } from '../core/viewport.js';

export interface ProfileFrame extends Entity {
  readonly selfWeight: string;
  readonly file?: string;
  readonly line?: number;
}
export interface ProfileDocument extends EntityDocument {
  kind: 'profile';
  unit: string;
  frames: ProfileFrame[];
}
export interface ProfileWeight {
  self: bigint;
  total: bigint;
  start: bigint;
  end: bigint;
}
export interface CompiledProfile {
  kind: 'profile';
  document: ProfileDocument;
  hierarchy: Hierarchy<ProfileFrame>;
  weights: ReadonlyMap<string, ProfileWeight>;
  totalWeight: bigint;
}
export type ProfileView = HierarchyView<ProfileFrame>;

/** Weights are explicitly self weights, never ambiguous inclusive values. */
export function parseProfileDocument(value: unknown): ProfileDocument {
  const input = object(value, 'document', [
    'version',
    'kind',
    'title',
    'description',
    'options',
    'frames',
    'unit'
  ]);
  if (input.kind !== 'profile') fail('kind', 'Expected profile.');
  return {
    ...documentHeader(input),
    kind: 'profile',
    unit: text(input.unit, 'unit', true),
    frames: list(input.frames, 'frames').map((value, i) => {
      const path = `frames[${i}]`,
        input = object(value, path);
      if (input.line !== undefined && (!Number.isSafeInteger(input.line) || Number(input.line) < 1))
        fail(`${path}.line`, 'Expected a positive line number.');
      return {
        ...entity(value, path, ['selfWeight', 'file', 'line']),
        selfWeight: integer(input.selfWeight, `${path}.selfWeight`),
        ...(input.file !== undefined ? { file: text(input.file, `${path}.file`) } : {}),
        ...(input.line !== undefined ? { line: Number(input.line) } : {})
      };
    })
  };
}
export function compileProfile(input: unknown): CompiledProfile {
  const document = parseProfileDocument(input),
    tree = hierarchy(document.frames, 'frames'),
    weights = new Map<string, ProfileWeight>();
  for (let i = tree.order.length - 1; i >= 0; i--) {
    const source = tree.order[i],
      self = BigInt(source.selfWeight);
    const total =
      self +
      (tree.children.get(source.id) ?? []).reduce(
        (sum, child) => sum + weights.get(child.id)!.total,
        0n
      );
    weights.set(source.id, { self, total, start: 0n, end: 0n });
  }
  let totalWeight = 0n;
  for (const root of tree.roots) {
    const weight = weights.get(root.id)!;
    weight.start = totalWeight;
    weight.end = totalWeight + weight.total;
    totalWeight = weight.end;
  }
  for (const source of tree.order) {
    const weight = weights.get(source.id)!;
    let left = weight.start + weight.self;
    for (const child of tree.children.get(source.id) ?? []) {
      const value = weights.get(child.id)!;
      value.start = left;
      value.end = left + value.total;
      left = value.end;
    }
  }
  return { kind: 'profile', document, hierarchy: tree, weights, totalWeight };
}
export function createProfileView(
  compiled: CompiledProfile,
  collapsed: ReadonlySet<string> = new Set()
): ProfileView {
  let rowCount = 0;
  const items = visibleSources(compiled.hierarchy, collapsed).map((source) => {
    const weight = compiled.weights.get(source.id)!,
      row = compiled.hierarchy.depth.get(source.id)!,
      color = entityColor(source.name);
    rowCount = Math.max(rowCount, row + 1);
    const percent = compiled.totalWeight ? (weight.total * 10000n) / compiled.totalWeight : 0n;
    const rows: InspectionRow[] = [
      {
        label: 'Self weight',
        format: 'number',
        value: `${formatInteger(weight.self)} ${compiled.document.unit}`
      },
      {
        label: 'Total weight',
        format: 'number',
        value: `${formatInteger(weight.total)} ${compiled.document.unit}`
      },
      {
        label: 'Share of supplied profile',
        format: 'number',
        value: `${percent / 100n}.${(percent % 100n).toString().padStart(2, '0')}%`
      },
      ...(source.parentId && !compiled.hierarchy.byId.has(source.parentId)
        ? [{ label: 'Relationships', value: 'Missing parent', tone: 'warning' as const }]
        : [])
    ];
    return {
      id: source.id,
      start: ratio(weight.start, compiled.totalWeight),
      end: ratio(weight.end, compiled.totalWeight),
      row,
      color,
      interaction: {
        key: `profile:${source.id}`,
        sources: [source],
        tooltip: {
          title: source.name,
          context: source.file
            ? `${source.file}${source.line ? `:${source.line}` : ''}`
            : undefined,
          color,
          previewRows: rows,
          rows
        }
      }
    };
  });
  return createView({
    kind: 'profile',
    document: compiled.document,
    items,
    collapsed: new Set(collapsed),
    rowCount,
    issues: compiled.hierarchy.issues,
    domainSize: compiled.totalWeight,
    formatValue: formatInteger,
    axisTitle: `Cumulative weight (${compiled.document.unit})`
  });
}
export function layoutProfile(
  view: ProfileView,
  width: number,
  height: number,
  measure: MeasureText,
  viewport?: ViewportState
): ChartScene<ProfileFrame> {
  return layoutHierarchy(view, width, height, measure, viewport);
}
