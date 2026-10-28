import { fail, object, text, TEXT_LIMIT } from '../../data/validation.js';
export { fail, object, text } from '../../data/validation.js';
import { boolean } from '../../data/validation.js';

export const ENTITY_LIMITS = Object.freeze({
  nodes: 100_000,
  text: TEXT_LIMIT,
  integerDigits: 40,
  attributes: 64
});
export interface Entity {
  readonly id: string;
  readonly parentId?: string | null;
  readonly name: string;
  readonly attributes?: Readonly<Record<string, string | number | boolean | null>>;
}
export interface HierarchyIssue {
  kind: 'missing-parent' | 'outside-parent';
  id: string;
  parentId: string;
}
export interface EntityDocument {
  version: 1;
  title?: string;
  description?: string;
  options?: EntityOptions;
}
export interface EntityOptions {
  interactive?: boolean;
  rowHeight?: number;
}
export function integer(value: unknown, path: string, signed = false): string {
  const result = text(value, path, true);
  if (
    !(signed ? /^-?\d+$/ : /^\d+$/).test(result) ||
    result.replace('-', '').length > ENTITY_LIMITS.integerDigits
  )
    fail(
      path,
      `Expected an ${signed ? '' : 'unsigned '}integer string of at most ${ENTITY_LIMITS.integerDigits} digits.`
    );
  return result;
}
export function entity(value: unknown, path: string, extra: readonly string[]): Entity {
  const input = object(value, path, ['id', 'name', 'parentId', 'attributes', ...extra]);
  let attributes: Entity['attributes'];
  if (input.attributes !== undefined) {
    const pairs = Object.entries(object(input.attributes, `${path}.attributes`));
    if (pairs.length > ENTITY_LIMITS.attributes) fail(`${path}.attributes`, 'Too many attributes.');
    attributes = Object.fromEntries(
      pairs.map(([key, value]) => {
        text(key, `${path}.attributes key`);
        if (typeof value === 'string') text(value, `${path}.attributes.${key}`);
        else if (
          value !== null &&
          typeof value !== 'boolean' &&
          !(typeof value === 'number' && Number.isFinite(value))
        )
          fail(`${path}.attributes.${key}`, 'Expected text, a finite number, boolean or null.');
        return [key, value as string | number | boolean | null];
      })
    );
  }
  return {
    id: text(input.id, `${path}.id`, true),
    name: text(input.name, `${path}.name`, true),
    ...(input.parentId !== undefined
      ? {
          parentId: input.parentId === null ? null : text(input.parentId, `${path}.parentId`, true)
        }
      : {}),
    ...(attributes ? { attributes } : {})
  };
}
export function documentHeader(input: Record<string, unknown>): EntityDocument {
  if (input.version !== 1) fail('version', 'Only document version 1 is supported.');
  const result: EntityDocument = { version: 1 };
  if (input.title !== undefined) result.title = text(input.title, 'title');
  if (input.description !== undefined) result.description = text(input.description, 'description');
  if (input.options !== undefined) {
    const options = object(input.options, 'options', ['interactive', 'rowHeight']);
    result.options = {};
    if (options.interactive !== undefined)
      result.options.interactive = boolean(options.interactive, 'options.interactive');
    if (options.rowHeight !== undefined) {
      if (
        !Number.isFinite(options.rowHeight) ||
        Number(options.rowHeight) < 18 ||
        Number(options.rowHeight) > 64
      )
        fail('options.rowHeight', 'Expected 18–64 CSS pixels.');
      result.options.rowHeight = Number(options.rowHeight);
    }
  }
  return result;
}
export function list(input: unknown, path: string): unknown[] {
  if (!Array.isArray(input) || input.length > ENTITY_LIMITS.nodes)
    fail(path, `Expected at most ${ENTITY_LIMITS.nodes} nodes.`);
  return input;
}

export interface Hierarchy<Source extends Entity> {
  sources: readonly Source[];
  byId: ReadonlyMap<string, Source>;
  children: ReadonlyMap<string, readonly Source[]>;
  roots: readonly Source[];
  order: readonly Source[];
  depth: ReadonlyMap<string, number>;
  issues: readonly HierarchyIssue[];
}
/** Iterative forest validation handles deep stacks without recursion or repaired cycles. */
export function hierarchy<Source extends Entity>(
  sources: readonly Source[],
  path: string,
  compare?: (a: Source, b: Source) => number
): Hierarchy<Source> {
  const byId = new Map<string, Source>(),
    indices = new Map<string, number>();
  sources.forEach((source, index) => {
    if (byId.has(source.id)) fail(`${path}[${index}].id`, 'Duplicate identity.');
    byId.set(source.id, source);
    indices.set(source.id, index);
  });
  const children = new Map<string, Source[]>(),
    roots: Source[] = [],
    issues: HierarchyIssue[] = [];
  for (const source of sources) {
    if (source.parentId && byId.has(source.parentId)) {
      const values = children.get(source.parentId) ?? [];
      values.push(source);
      children.set(source.parentId, values);
    } else {
      roots.push(source);
      if (source.parentId)
        issues.push({ kind: 'missing-parent', id: source.id, parentId: source.parentId });
    }
  }
  if (compare) {
    roots.sort(compare);
    for (const values of children.values()) values.sort(compare);
  }
  const order: Source[] = [],
    depth = new Map<string, number>();
  const stack = roots.map((source) => ({ source, level: 0 })).reverse();
  while (stack.length) {
    const { source, level } = stack.pop()!;
    order.push(source);
    depth.set(source.id, level);
    const values = children.get(source.id) ?? [];
    for (let i = values.length - 1; i >= 0; i--)
      stack.push({ source: values[i], level: level + 1 });
  }
  if (order.length !== sources.length) {
    const cyclic = sources.find((source) => !depth.has(source.id))!;
    fail(`${path}[${indices.get(cyclic.id)}].parentId`, 'Parent relationships contain a cycle.');
  }
  return { sources, byId, children, roots, order, depth, issues };
}
export function visibleSources<Source extends Entity>(
  tree: Hierarchy<Source>,
  collapsed: ReadonlySet<string>
) {
  const included = new Set<string>();
  return tree.order.filter((source) => {
    const parent = source.parentId && tree.byId.get(source.parentId);
    if (parent && (!included.has(parent.id) || collapsed.has(parent.id))) return false;
    included.add(source.id);
    return true;
  });
}
/** Normalize relative integers only; absolute timestamps never pass through Number. */
export function ratio(value: bigint, total: bigint): number {
  if (!total) return 0;
  return Number(value) / Number(total);
}
export function formatInteger(value: bigint): string {
  return value.toLocaleString('en-US');
}
export function formatNanoseconds(value: bigint, resolution?: bigint): string {
  const magnitude = value < 0n ? -value : value;
  const [divisor, unit] =
    magnitude >= 1_000_000_000n
      ? [1_000_000_000n, 's']
      : magnitude >= 1_000_000n
        ? [1_000_000n, 'ms']
        : magnitude >= 1000n
          ? [1000n, 'µs']
          : [1n, 'ns'];
  const digits =
    resolution !== undefined && resolution < divisor / 1000n ? divisor.toString().length - 1 : 3;
  const scale = 10n ** BigInt(digits);
  const whole = magnitude / divisor,
    fraction = (((magnitude % divisor) * scale) / divisor)
      .toString()
      .padStart(digits, '0')
      .replace(/0+$/, '');
  return `${value < 0n ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''} ${unit}`;
}
