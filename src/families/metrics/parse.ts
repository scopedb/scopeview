import {
  fail,
  object,
  text as string,
  choice,
  boolean,
  TEXT_LIMIT
} from '../../data/validation.js';
import type { ChartColorStrategy } from '../../theme/colors.js';
import type { ChartSpec } from './spec.js';
import type { ChartFieldInput, ChartFieldRef, ResultField, ResultSet } from '../../data/result.js';
import { CHART_DATA_TYPES } from '../../data/result.js';
import type { ChartPresentation, QuantityDisplay, ResultSemantics } from '../../data/semantics.js';

import { parseResultTimestamp } from '../../data/time.js';
/**
 * Data and presentation travel together; queries, credentials and network access do not.
 * Parsed documents always contain full field references. Author with ChartDocumentInput to
 * refer to uniquely named fields by name.
 */
export interface ChartDocument<F = ChartFieldRef> {
  version: 1;
  /** Optional family discriminator shared with trace and profile documents. */
  kind?: 'metric';
  title?: string;
  description?: string;
  data: ResultSet;
  spec: ChartSpec<F>;
  semantics?: ResultSemantics<F>;
  options?: ChartOptions<F>;
}
/** Author with unique field names or unambiguous full references. */
export type ChartDocumentInput = ChartDocument<ChartFieldInput>;
export interface ChartOptions<F = ChartFieldRef> {
  interactive?: boolean;
  colorStrategy?: ChartColorStrategy;
  labels?: 'auto' | 'none';
  presentation?: ChartPresentation;
  orientation?: 'vertical' | 'horizontal';
  values?: QuantityDisplay<F>[];
  colors?: Record<string, string>;
  stack?: boolean;
}

export const DOCUMENT_LIMITS = Object.freeze({
  rows: 10_000,
  columns: 64,
  cells: 100_000,
  text: TEXT_LIMIT
});

function ref(value: unknown, path: string, fields: readonly ResultField[]): ChartFieldRef {
  if (typeof value === 'string') {
    const name = string(value, path),
      matches = fields.filter((field) => field.name === name);
    if (!matches.length) fail(path, `The chart field “${name}” is not available in this result.`);
    if (matches.length > 1)
      fail(
        path,
        `Several fields are named “${name}”. Use a field reference with data_type and occurrence.`
      );
    const dataType = matches[0].data_type;
    return { name, occurrence: 0, data_type: dataType };
  }
  const r = object(value, path, ['name', 'data_type', 'occurrence'], 'a field name or reference');
  if (!Number.isSafeInteger(r.occurrence) || (r.occurrence as number) < 0)
    fail(`${path}.occurrence`, 'Expected a non-negative integer.');
  return {
    name: string(r.name, `${path}.name`),
    data_type: choice(r.data_type, CHART_DATA_TYPES, `${path}.data_type`),
    occurrence: r.occurrence as number
  };
}
function refs(value: unknown, path: string, fields: readonly ResultField[]): ChartFieldRef[] {
  if (!Array.isArray(value) || !value.length || value.length > DOCUMENT_LIMITS.columns)
    fail(path, 'Expected a nonempty field list.');
  return value.map((v, i) => ref(v, `${path}[${i}]`, fields));
}

/** Decode untrusted JSON into an owned snapshot. No source object is retained. */
export function parseChartDocument(value: unknown): ChartDocument {
  const doc = object(value, 'document', [
    'version',
    'kind',
    'title',
    'description',
    'data',
    'spec',
    'semantics',
    'options'
  ]);
  if (doc.version !== 1) fail('version', 'Only document version 1 is supported.');
  if (doc.kind !== undefined) choice(doc.kind, ['metric'], 'kind');
  const input = object(doc.data, 'data', ['fields', 'rows']);
  if (
    !Array.isArray(input.fields) ||
    !input.fields.length ||
    input.fields.length > DOCUMENT_LIMITS.columns
  )
    fail('data.fields', `Expected 1–${DOCUMENT_LIMITS.columns} columns.`);
  const fields = input.fields.map((value, i) => {
    const path = `data.fields[${i}]`,
      field = object(value, path, ['name', 'data_type']);
    return {
      name: string(field.name, `${path}.name`),
      data_type: choice(field.data_type, CHART_DATA_TYPES, `${path}.data_type`)
    };
  });
  if (!Array.isArray(input.rows)) fail('data.rows', 'Expected an array; use [] for no data.');
  if (
    input.rows.length > DOCUMENT_LIMITS.rows ||
    input.rows.length * fields.length > DOCUMENT_LIMITS.cells
  )
    fail(
      'data.rows',
      `Expected at most ${DOCUMENT_LIMITS.rows} rows and ${DOCUMENT_LIMITS.cells} cells.`
    );
  const rows = input.rows.map((row, i) => {
    const path = `data.rows[${i}]`;
    if (!Array.isArray(row) || row.length !== fields.length)
      fail(path, 'Row width must match the fields.');
    return row.map((cell, j) => {
      if (cell === null) return null;
      const cellPath = `${path}[${j}]`;
      if (typeof cell !== 'string') fail(cellPath, 'Expected a string or null; quote numbers.');
      const text = string(cell, cellPath),
        type = fields[j].data_type;
      if (type === 'number' && (!text.trim() || !Number.isFinite(Number(text))))
        fail(cellPath, 'Expected a finite numeric string or null.');
      if (type === 'timestamp' && parseResultTimestamp(text) === null)
        fail(cellPath, 'Expected a valid timestamp/date or null.');
      return text;
    });
  });
  const s = object(doc.spec, 'spec', ['visualization', 'encoding']);
  const visualization = choice(
    s.visualization,
    ['line', 'area', 'bar', 'scatter', 'pie', 'big-number', 'top-list', 'treemap'],
    'spec.visualization'
  );
  const expected =
    visualization === 'scatter'
      ? 'scatter'
      : ['pie', 'top-list', 'treemap'].includes(visualization)
        ? 'distribution'
        : visualization === 'big-number'
          ? 'aggregate'
          : 'axis';
  const kind = expected;
  const roles = {
    axis: ['x', 'y', 'series'],
    scatter: ['x', 'y', 'size', 'color'],
    distribution: ['category', 'value'],
    aggregate: ['values']
  };
  const e = object(s.encoding, 'spec.encoding', roles[kind]);
  const field = (key: string) => ref(e[key], `spec.encoding.${key}`, fields);
  let encoding: ChartSpec['encoding'];
  switch (kind) {
    case 'axis':
      encoding = {
        x: field('x'),
        y: refs(e.y, 'spec.encoding.y', fields),
        ...(e.series === undefined ? {} : { series: field('series') })
      };
      break;
    case 'scatter':
      encoding = {
        x: field('x'),
        y: field('y'),
        ...(e.size === undefined ? {} : { size: field('size') }),
        ...(e.color === undefined ? {} : { color: field('color') })
      };
      break;
    case 'distribution':
      encoding = { category: field('category'), value: field('value') };
      break;
    case 'aggregate':
      encoding = { values: refs(e.values, 'spec.encoding.values', fields) };
      break;
  }
  const result: ChartDocument = {
    version: 1,
    ...(doc.kind === undefined ? {} : { kind: 'metric' as const }),
    data: { fields, rows },
    spec: { visualization, encoding } as ChartSpec
  };
  for (const key of ['title', 'description'] as const)
    if (doc[key] !== undefined) result[key] = string(doc[key], key);
  if (doc.options !== undefined) {
    const options = object(doc.options, 'options', [
      'interactive',
      'colorStrategy',
      'labels',
      'presentation',
      'orientation',
      'values',
      'colors',
      'stack'
    ]);
    result.options = {};
    if (options.interactive !== undefined)
      result.options.interactive = boolean(options.interactive, 'options.interactive');
    if (options.colorStrategy !== undefined)
      result.options.colorStrategy = choice(
        options.colorStrategy,
        ['auto', 'consistent', 'ranked', 'semantic'],
        'options.colorStrategy'
      );
    if (options.presentation !== undefined)
      result.options.presentation = choice(
        options.presentation,
        ['full', 'sparkline'],
        'options.presentation'
      );
    if (options.labels !== undefined)
      result.options.labels = choice(options.labels, ['auto', 'none'], 'options.labels');
    if (options.stack !== undefined) result.options.stack = boolean(options.stack, 'options.stack');
    if (options.orientation !== undefined)
      result.options.orientation = choice(
        options.orientation,
        ['vertical', 'horizontal'],
        'options.orientation'
      );
    if (options.values !== undefined) {
      if (!Array.isArray(options.values) || options.values.length > fields.length)
        fail('options.values', 'Expected a bounded display list.');
      result.options.values = options.values.map((value, i) => {
        const path = `options.values[${i}]`,
          item = object(value, path, ['field', 'divisor', 'unit', 'decimals']),
          divisor = string(item.divisor, `${path}.divisor`);
        if (!/^[1-9]\d*$/.test(divisor) || !Number.isFinite(Number(divisor)))
          fail(`${path}.divisor`, 'Expected a finite positive integer string.');
        if (
          item.decimals !== undefined &&
          (!Number.isInteger(item.decimals) ||
            Number(item.decimals) < 0 ||
            Number(item.decimals) > 8)
        )
          fail(`${path}.decimals`, 'Expected an integer between 0 and 8.');
        return {
          field: ref(item.field, `${path}.field`, fields),
          divisor,
          ...(item.unit === undefined ? {} : { unit: string(item.unit, `${path}.unit`) }),
          ...(item.decimals === undefined ? {} : { decimals: Number(item.decimals) })
        };
      });
    }
    if (options.colors !== undefined) {
      const colors = object(options.colors, 'options.colors');
      if (Object.keys(colors).length > DOCUMENT_LIMITS.rows)
        fail('options.colors', 'Too many colors.');
      result.options.colors = Object.fromEntries(
        Object.entries(colors).map(([name, value]) => {
          string(name, 'options.colors');
          const paint = string(value, `options.colors.${name}`);
          // JSON paints are colors, never URLs or arbitrary CSS fragments.
          const hex = /^#[\da-f]{3,8}$/i.test(paint) && [4, 5, 7, 9].includes(paint.length);
          const token =
            /^var\(--color-chart-(?:series-(?:[1-9]|10)|semantic-(?:info|success|warning|error|critical|debug|trace|unknown))(?:-line)?\)$/.test(
              paint
            );
          if (!hex && !token)
            fail(`options.colors.${name}`, 'Expected a hex color or a ScopeDB palette token.');
          return [name, paint];
        })
      );
    }
  }
  if (doc.semantics !== undefined) {
    const semantics = object(doc.semantics, 'semantics', ['time', 'provenance']);
    result.semantics = {};
    if (semantics.time !== undefined) {
      const kind = choice(
        object(semantics.time, 'semantics.time').kind,
        ['points', 'buckets'],
        'semantics.time.kind'
      );
      const t = object(
        semantics.time,
        'semantics.time',
        kind === 'points'
          ? ['kind', 'field', 'window']
          : ['kind', 'field', 'window', 'intervalMs', 'coverage', 'completeThrough', 'valueKind']
      );
      let window: { start: number; end: number } | undefined;
      if (t.window !== undefined) {
        const w = object(t.window, 'semantics.time.window', ['start', 'end']);
        if (
          !Number.isSafeInteger(w.start) ||
          !Number.isSafeInteger(w.end) ||
          Number(w.start) >= Number(w.end) ||
          Math.abs(Number(w.start)) > 8.64e15 ||
          Math.abs(Number(w.end)) > 8.64e15
        )
          fail('semantics.time.window', 'Expected an ordered epoch-millisecond window.');
        window = { start: Number(w.start), end: Number(w.end) };
      }
      const field = ref(t.field, 'semantics.time.field', fields);
      if (kind === 'buckets') {
        if (!Number.isSafeInteger(t.intervalMs) || Number(t.intervalMs) < 1)
          fail('semantics.time.intervalMs', 'Expected a positive integer interval.');
        if (
          t.completeThrough !== undefined &&
          (!Number.isSafeInteger(t.completeThrough) ||
            Math.abs(Number(t.completeThrough)) > 8.64e15 ||
            (window &&
              (Number(t.completeThrough) < window.start || Number(t.completeThrough) > window.end)))
        )
          fail('semantics.time.completeThrough', 'Expected a watermark inside the time window.');
        result.semantics.time = {
          kind,
          field,
          intervalMs: Number(t.intervalMs),
          coverage: choice(
            t.coverage,
            ['complete', 'limited', 'unknown'],
            'semantics.time.coverage'
          ),
          ...(t.completeThrough === undefined
            ? {}
            : { completeThrough: Number(t.completeThrough) }),
          ...(window ? { window } : {}),
          ...(t.valueKind === undefined
            ? {}
            : { valueKind: choice(t.valueKind, ['count', 'number'], 'semantics.time.valueKind') })
        };
      } else result.semantics.time = { kind, field, ...(window ? { window } : {}) };
    }
    if (semantics.provenance !== undefined) {
      const p = object(semantics.provenance, 'semantics.provenance', [
        'kind',
        'scope',
        'approximate',
        'description'
      ]);
      result.semantics.provenance = {
        kind: choice(p.kind, ['rows', 'bins', 'entities'], 'semantics.provenance.kind'),
        scope: choice(p.scope, ['returned', 'sample', 'matching'], 'semantics.provenance.scope'),
        ...(p.approximate === undefined
          ? {}
          : { approximate: boolean(p.approximate, 'semantics.provenance.approximate') }),
        ...(p.description === undefined
          ? {}
          : { description: string(p.description, 'semantics.provenance.description') })
      };
    }
  }
  return result;
}
