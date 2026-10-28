import { describe, expect, it } from 'vitest';
import {
  buildChartDataset,
  compileChart,
  createChartSpec,
  fieldRef,
  layoutChart,
  type ResultSet,
  type ChartDocument
} from '../../../../src/index.js';
import { legendReadings } from '../../../../src/families/metrics/readings.js';
import { layoutDataLabels } from '../../../../src/core/labels.js';
import { markDocument } from '../../../../examples/mark-data.js';

const measure = (text: string) => text.length * 6;
function document(rows: (string | null)[][]): ChartDocument {
  const data: ResultSet = {
    fields: [
      { name: 'Time', data_type: 'timestamp' },
      { name: 'Count', data_type: 'number' }
    ],
    rows
  };
  const dataset = buildChartDataset(data);
  return {
    version: 1,
    data,
    spec: createChartSpec(dataset, {
      displayType: 'line',
      mapping: { kind: 'axis', x: 'result-column-0', y: ['result-column-1'] }
    })
  };
}

describe('source readings and label density', () => {
  it.each([
    'line',
    'area'
  ] as const)('retains exact decimal and timestamp sources in %s inspection', (family) => {
    const rows = [
      ['2026-10-23T08:00:00.123456789+08:00', '0.1234567890123456789'],
      ['2026-10-23T08:00:01.234567891+08:00', null],
      ['2026-10-23T08:00:02.345678912+08:00', '1.0000000000000000001']
    ];
    const doc = document(rows);
    doc.spec.visualization = family;
    const scene = layoutChart(compileChart(doc), new Set(), 640, 260, measure);
    expect(scene.interactions.map((target) => target.tooltip.rows[0].value)).toEqual([
      '0.1234567890123456789',
      'NULL',
      '1.0000000000000000001'
    ]);
    for (const [index, interaction] of scene.interactions.entries()) {
      expect(interaction.tooltip.context).toContain(rows[index][0]);
      expect(interaction.tooltip.title).not.toContain(rows[index][0]);
      expect(interaction.tooltip.presentation).toBe('sample');
      expect(interaction.time?.start).toBe(Date.parse(rows[index][0]!));
      expect(interaction.sources).toEqual([rows[index]]);
    }
    expect(scene.interactions[1].points).toEqual([]);
    expect(scene.marks.filter((mark) => mark.kind === 'circle')).toHaveLength(2);
    expect(
      scene.marks
        .filter((mark) => mark.kind === 'path')
        .filter((mark) => mark.stroke)
        .map((mark) => mark.d)
    ).toEqual(
      [0, 2].map((index) => {
        const point = scene.interactions[index].points[0];
        return `M${Number(point.x.toFixed(3))},${Number(point.y.toFixed(3))}`;
      })
    );
  });

  it('compacts temporal sample hover without hiding partial notices or changing source values', () => {
    for (const family of ['line', 'area'] as const) {
      const doc = markDocument(family),
        scene = layoutChart(compileChart(doc), new Set(), 640, 260, measure);
      expect(scene.interactions[0].tooltip.presentation).toBe('sample');
      expect(scene.interactions[0].tooltip.context).toContain('2026');
      expect(scene.interactions[0].tooltip.rows.map((row) => row.value)).toEqual(['24', '6', '0']);
      expect(scene.interactions.at(-1)!.time?.partial).toBe(true);
      expect(scene.interactions.at(-1)!.tooltip.presentation).toBeUndefined();
      expect(scene.interactions.at(-1)!.tooltip.context).toContain('Partial data');
    }
    const bar = layoutChart(compileChart(markDocument('bar')), new Set(), 640, 260, measure);
    expect(bar.interactions[0].tooltip.presentation).toBeUndefined();
  });

  it('retains integer precision in sum, extrema and averages while distinguishing NULL from zero', () => {
    const compiled = compileChart(
      document([
        ['2026-10-02T00:00:00Z', '9007199254740993'],
        ['2026-10-02T00:01:00Z', '3'],
        ['2026-10-02T00:02:00Z', null]
      ])
    );
    expect(legendReadings(compiled, ['last', 'avg', 'sum', 'min', 'max']).get('Count')).toEqual([
      'NULL',
      '4,503,599,627,370,498.00',
      '9,007,199,254,740,996',
      '3',
      '9,007,199,254,740,993'
    ]);
    const nulls = compileChart(document([['2026-10-02T00:00:00Z', null]]));
    expect(legendReadings(nulls, ['last', 'avg', 'sum']).get('Count')).toEqual([
      'NULL',
      'NULL',
      'NULL'
    ]);
    const zero = compileChart(document([['2026-10-02T00:00:00Z', '0']]));
    expect(legendReadings(zero, ['last', 'sum']).get('Count')).toEqual(['0', '0']);
  });

  it('finds the latest observation by time and formats summaries in the declared unit', () => {
    const doc = document([
      ['2026-10-02T00:02:00Z', '2000'],
      ['2026-10-02T00:00:00Z', '1000']
    ]);
    const dataset = buildChartDataset(doc.data);
    doc.options = {
      values: [
        { field: fieldRef(dataset, 'result-column-1'), divisor: '1000', unit: 's', decimals: 2 }
      ]
    };
    expect(legendReadings(compileChart(doc), ['last', 'avg', 'sum']).get('Count')).toEqual([
      '2.00 s',
      '1.50 s',
      '3.00 s'
    ]);
  });

  it('retains overflowing integer summaries even when plotted observations remain finite', () => {
    const value = `1${'0'.repeat(308)}`;
    const compiled = compileChart(
      document([
        ['2026-10-02T00:00:00Z', value],
        ['2026-10-02T00:01:00Z', value]
      ])
    );
    expect(legendReadings(compiled, ['sum']).get('Count')).toEqual([
      (BigInt(value) * 2n).toLocaleString('en-US')
    ]);
  });

  it('bounds disclosure without truncating values or permitting label collisions', () => {
    const marks = layoutDataLabels(
      [
        { text: '1,000', x: 10, y: 15, priority: 1 },
        { text: '2,000', x: 12, y: 15, priority: 2 },
        { text: '3', x: 80, y: 15 },
        { text: 'Does not fit', x: 90, y: 40 }
      ],
      { x: 0, y: 0, width: 100, height: 50 },
      measure
    );
    expect(marks.filter((mark) => mark.kind === 'text').map((mark) => mark.text)).toEqual([
      '2,000',
      '3'
    ]);
    const bar = layoutChart(compileChart(markDocument('bar')), new Set(), 640, 260, measure);
    expect(bar.labels?.filter((mark) => mark.kind === 'text').map((mark) => mark.text)).toContain(
      '428'
    );
    expect(bar.interactions.at(-1)?.tooltip.rows[0].value).toBe('0');
    expect(bar.marks.filter((mark) => mark.kind === 'rect')).toHaveLength(3);
  });

  it('keeps labels optional and never presents a previous valid sample as the latest NULL', () => {
    const doc = document([
      ['2026-10-02T00:00:00Z', '1'],
      ['2026-10-02T00:01:00Z', null]
    ]);
    doc.options = { labels: 'auto' };
    expect(layoutChart(compileChart(doc), new Set(), 640, 260, measure).labels).toEqual([]);
    doc.options.labels = 'none';
    expect(layoutChart(compileChart(doc), new Set(), 640, 260, measure).labels).toBeUndefined();
    expect(() => compileChart({ ...doc, options: { labels: 'always' } })).toThrow(/options.labels/);
  });

  for (const kind of ['points', 'buckets'] as const)
    it.each([
      'line',
      'area'
    ] as const)(`keeps straight %s connections and NULL gaps for ${kind}`, (family) => {
      const doc = document([
        ['2026-10-02T00:00:00Z', '1'],
        ['2026-10-02T00:01:00Z', '5'],
        ['2026-10-02T00:02:00Z', null],
        ['2026-10-02T00:03:00Z', '3'],
        ['2026-10-02T00:04:00Z', '0']
      ]);
      doc.spec.visualization = family;
      if (doc.spec.visualization !== 'line' && doc.spec.visualization !== 'area')
        throw new Error('Fixture');
      const field = doc.spec.encoding.x;
      doc.semantics = {
        time:
          kind === 'points'
            ? { kind, field }
            : {
                kind,
                field,
                intervalMs: 60_000,
                coverage: 'complete',
                window: {
                  start: Date.parse(doc.data.rows[0][0]!),
                  end: Date.parse(doc.data.rows[4][0]!) + 60_000
                }
              }
      };
      for (const width of [320, 640]) {
        const scene = layoutChart(compileChart(doc), new Set(), width, 260, measure);
        const outlines = scene.marks
          .filter((mark) => mark.kind === 'path')
          .filter((mark) => mark.stroke);
        const paths = [
          [0, 1],
          [3, 4]
        ].map((indices) =>
          indices
            .map((index, i) => {
              const point = scene.interactions[index].points[0];
              return `${i ? 'L' : 'M'}${Number(point.x.toFixed(3))},${Number(point.y.toFixed(3))}`;
            })
            .join('')
        );
        expect(outlines.map((mark) => mark.d)).toEqual(paths);
        expect(scene.interactions[2].points).toEqual([]);
        expect(scene.interactions[2].tooltip.rows[0].value).toBe('NULL');
        expect(scene.interactions[4].tooltip.rows[0].value).toBe('0');
      }
    });

  it.each([
    'line',
    'area'
  ] as const)('keeps continuous %s quiet and retains isolated sample visibility', (family) => {
    const continuous = layoutChart(
      compileChart(markDocument(family)),
      new Set(),
      640,
      260,
      measure
    );
    expect(continuous.marks.filter((mark) => mark.kind === 'circle')).toEqual([]);
    expect(continuous.interactions[1].points).toHaveLength(3);
    const doc = document([
      ['2026-10-02T00:00:00Z', '1'],
      ['2026-10-02T00:01:00Z', '4'],
      ['2026-10-02T00:02:00Z', null],
      ['2026-10-02T00:03:00Z', '0']
    ]);
    doc.spec.visualization = family;
    const scene = layoutChart(compileChart(doc), new Set(), 640, 260, measure);
    const isolated = scene.marks.filter((mark) => mark.kind === 'circle');
    expect(isolated).toHaveLength(1);
    const point = scene.interactions[3].points[0];
    expect(isolated[0]).toMatchObject({
      kind: 'circle',
      x: point.x,
      y: point.y,
      fill: point.color,
      radius: 2
    });
    expect(scene.interactions[2].points).toEqual([]);
    expect(scene.interactions[3].tooltip.rows[0].value).toBe('0');
  });

  it('connects stacked area sample centers directly with lighter fills and source-valued inspection', () => {
    const scene = layoutChart(compileChart(markDocument('area')), new Set(), 640, 260, measure);
    const fills = scene.marks
      .filter((mark) => mark.kind === 'path')
      .filter((mark) => mark.fill !== 'none');
    expect(fills).toHaveLength(3);
    expect(fills.every((mark) => mark.opacity! < 0.6)).toBe(true);
    const outlines = scene.marks
      .filter((mark) => mark.kind === 'path')
      .filter((mark) => mark.stroke);
    expect(outlines).toHaveLength(3);
    for (const [index, outline] of outlines.entries()) {
      const samplePath = scene.interactions
        .map((item, i) => {
          const point = item.points[index];
          return `${i ? 'L' : 'M'}${Number(point.x.toFixed(3))},${Number(point.y.toFixed(3))}`;
        })
        .join('');
      expect(outline.d).toBe(samplePath);
      expect(fills[index].d.startsWith(samplePath)).toBe(true);
    }
    const last = scene.interactions.at(-1)!;
    expect(last.tooltip.rows.map((row) => row.value)).toEqual(['9', '2', '1']);
    expect(last.points[1].y).toBeLessThan(last.points[0].y);
    expect(last.points[0].x).toBeLessThan(scene.rect!.x + scene.rect!.width);
  });

  it('exposes a declared partial interval without inventing data or relying on the local clock', () => {
    const doc = markDocument('area');
    const compiled = compileChart(doc);
    const scene = layoutChart(compiled, new Set(), 640, 260, measure);
    expect(scene.partial!.x + scene.partial!.width).toBeCloseTo(scene.rect!.x + scene.rect!.width);
    expect(scene.interactions.at(-1)?.time?.partial).toBe(true);
    expect(scene.interactions.at(-2)?.time?.partial).toBeUndefined();
    expect(scene.interactions.at(-1)?.tooltip.context).toContain('Partial data');
    const time = doc.semantics!.time!;
    if (time.kind !== 'buckets') throw new Error('Fixture');
    time.completeThrough = time.window!.end;
    const complete = layoutChart(compileChart(doc), new Set(), 640, 260, measure);
    expect(complete.partial).toBeUndefined();
    expect(complete.interactions.map((item) => item.sources)).toEqual(
      scene.interactions.map((item) => item.sources)
    );
    time.completeThrough = time.window!.start - 1;
    expect(() => compileChart(doc)).toThrow(/completeThrough/);
    time.completeThrough = Number.NaN;
    expect(() => compileChart(doc)).toThrow(/completeThrough/);
  });
});
