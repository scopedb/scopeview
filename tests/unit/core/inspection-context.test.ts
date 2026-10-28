import { describe, expect, it } from 'vitest';
import {
  compileChart,
  layoutChart,
  compileTrace,
  createTraceView,
  compileProfile,
  createProfileView
} from '../../../src/index.js';
import { metricInspectionContext } from '../../../src/families/metrics/inspection-context.js';
import {
  traceInspectionContext,
  profileInspectionContext
} from '../../../src/families/hierarchy/inspection-context.js';
import type { ChartDocumentInput } from '../../../src/index.js';

const metric: ChartDocumentInput = {
  version: 1,
  title: 'Exact source readings',
  data: {
    fields: [
      { name: 'time', data_type: 'timestamp' },
      { name: 'value', data_type: 'number' },
      { name: 'series', data_type: 'string' },
      { name: 'value', data_type: 'number' }
    ],
    rows: [
      ['2026-10-27T00:00:00.123456789Z', '9007199254740993', 'peak', '1.234567890123456789'],
      ['2026-10-27T00:00:00.123456789Z', '0', 'zero', null],
      ['2026-10-27T00:00:00.123456789Z', null, 'missing', '0']
    ]
  },
  spec: {
    visualization: 'line',
    encoding: {
      x: 'time',
      y: [{ name: 'value', occurrence: 0, data_type: 'number' }],
      series: 'series'
    }
  },
  options: {
    values: [
      { field: { name: 'value', occurrence: 0, data_type: 'number' }, divisor: '1000', unit: 's' }
    ]
  },
  semantics: { time: { kind: 'points', field: 'time' } }
};

describe('inspection context', () => {
  it('preserves exact rows, duplicate fields, field roles, NULL and zero independently of display units', () => {
    const compiled = compileChart(metric);
    const target = layoutChart(compiled, new Set(), 600, 240, (text) => text.length * 6)
      .interactions[0];
    const context = metricInspectionContext(compiled, target, 'peak')!;
    expect(context).toMatchObject({
      version: 1,
      kind: 'metric',
      key: target.key,
      title: metric.title,
      fields: metric.data.fields,
      rows: metric.data.rows,
      rowIndices: [0, 1, 2],
      series: 'peak',
      spec: {
        encoding: {
          x: { name: 'time', data_type: 'timestamp', occurrence: 0 },
          y: [{ name: 'value', occurrence: 0, data_type: 'number' }]
        }
      },
      semantics: {
        time: { kind: 'points', field: { name: 'time', data_type: 'timestamp', occurrence: 0 } }
      },
      values: [{ divisor: '1000', unit: 's' }]
    });
    expect(JSON.parse(JSON.stringify(context))).toEqual(context);
    context.rows[0][1] = 'mutated';
    context.fields[0].name = 'mutated';
    context.values![0].unit = 'mutated';
    expect(metricInspectionContext(compiled, target, 'peak')!.rows).toEqual(metric.data.rows);
    expect(compiled.document.data.fields).toEqual(metric.data.fields);
    expect(compiled.document.options!.values![0].unit).toBe('s');
  });

  it('keeps snapshot identity across layouts, separates replacements and rejects stale sources', () => {
    const compiled = compileChart(metric);
    const target = layoutChart(compiled, new Set(), 600, 240, (text) => text.length * 6)
      .interactions[0];
    const first = metricInspectionContext(compiled, target, null)!;
    const resized = layoutChart(compiled, new Set(), 400, 200, (text) => text.length * 6)
      .interactions[0];
    expect(metricInspectionContext(compiled, resized, null)!.snapshotId).toBe(first.snapshotId);
    const next = compileChart(metric);
    const replacement = layoutChart(next, new Set(), 600, 240, (text) => text.length * 6)
      .interactions[0];
    expect(replacement.key).toBe(target.key);
    expect(metricInspectionContext(next, replacement, null)!.snapshotId).not.toBe(first.snapshotId);
    expect(metricInspectionContext(next, target, null)).toBeNull();
    expect(metricInspectionContext(next, null, null)).toBeNull();
  });

  it('keeps repeated equal source rows at their original positions', () => {
    const compiled = compileChart({
      version: 1,
      data: {
        fields: [
          { name: 'category', data_type: 'string' },
          { name: 'value', data_type: 'number' }
        ],
        rows: [
          ['api', '1'],
          ['api', '1'],
          ['other', '1']
        ]
      },
      spec: { visualization: 'pie', encoding: { category: 'category', value: 'value' } }
    });
    const target = layoutChart(compiled, new Set(), 600, 240, (text) => text.length * 6)
      .interactions[0];
    expect(metricInspectionContext(compiled, target, 'peak')!.rowIndices).toEqual([0, 1]);
  });

  it('includes exact span timing, supplied ancestors and coverage without inventing missing parents', () => {
    const compiled = compileTrace({
      version: 1,
      kind: 'trace',
      coverage: 'partial',
      spans: [
        {
          id: 'root',
          name: 'Request',
          startTimeNs: '1803600000000000000',
          endTimeNs: '1803600000020000000'
        },
        {
          id: 'leaf',
          parentId: 'root',
          name: 'Leaf',
          startTimeNs: '1803600000001000000',
          endTimeNs: '1803600000001000001',
          attributes: { service: 'storage' }
        },
        {
          id: 'zero',
          parentId: 'absent',
          name: 'Zero',
          startTimeNs: '1803600000001000000',
          endTimeNs: '1803600000001000000'
        }
      ]
    });
    const targets = createTraceView(compiled).navigation.interactionByKey;
    const context = traceInspectionContext(compiled, targets.get('trace:leaf')!)!;
    expect(context).toMatchObject({
      kind: 'trace',
      key: 'trace:leaf',
      span: compiled.document.spans[1],
      ancestors: [compiled.document.spans[0]],
      durationNs: '1',
      coverage: 'partial'
    });
    expect(traceInspectionContext(compiled, targets.get('trace:zero')!)).toMatchObject({
      ancestors: [],
      durationNs: '0'
    });
    expect(traceInspectionContext(compiled, null)).toBeNull();
    context.ancestors.length = 0;
    expect(traceInspectionContext(compiled, targets.get('trace:leaf')!)!.ancestors).toHaveLength(1);
  });

  it('uses exact compiled inclusive weights, units and ancestry for profiles', () => {
    const compiled = compileProfile({
      version: 1,
      kind: 'profile',
      unit: 'samples',
      frames: [
        { id: 'root', name: 'Root', selfWeight: '20' },
        {
          id: 'query',
          parentId: 'root',
          name: 'Query',
          selfWeight: '9007199254740993',
          file: 'example.ts',
          line: 12
        },
        { id: 'leaf', parentId: 'query', name: 'Leaf', selfWeight: '1' },
        { id: 'zero', parentId: 'root', name: 'Zero', selfWeight: '0' }
      ]
    });
    const targets = createProfileView(compiled).navigation.interactionByKey;
    const context = profileInspectionContext(compiled, targets.get('profile:query')!)!;
    expect(context).toMatchObject({
      kind: 'profile',
      key: 'profile:query',
      frame: compiled.document.frames[1],
      ancestors: [compiled.document.frames[0]],
      unit: 'samples',
      totalWeight: '9007199254740994',
      profileTotalWeight: '9007199254741014'
    });
    expect(profileInspectionContext(compiled, targets.get('profile:zero')!)!.totalWeight).toBe('0');
    expect(profileInspectionContext(compiled, null)).toBeNull();
    expect(JSON.parse(JSON.stringify(context))).toEqual(context);
  });
});
