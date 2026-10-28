import { describe, expect, it } from 'vitest';
import { compileChart, type ChartDocument } from '../../../../src/families/metrics/document.js';
import { layoutChart } from '../../../../src/families/metrics/layout.js';
import { nearestInteraction } from '../../../../src/core/hit-test.js';
import { linear, numericAxis } from '../../../../src/families/metrics/scale.js';
import sample from '../../../../examples/requests.json';

const measure = (text: string) => text.length * 6;
const layout = (doc: unknown, hidden = new Set<string>()) =>
  layoutChart(compileChart(doc), hidden, 640, 300, measure);
const document = () => structuredClone(sample) as ChartDocument;
function axis(
  rows: (string | null)[][],
  visualization: 'line' | 'area' | 'bar' = 'bar'
): ChartDocument {
  return {
    version: 1,
    data: {
      fields: [
        { name: 'category', data_type: 'string' },
        { name: 'series', data_type: 'string' },
        { name: 'value', data_type: 'number' }
      ],
      rows
    },
    spec: {
      visualization,
      encoding: {
        x: { name: 'category', data_type: 'string', occurrence: 0 },
        series: { name: 'series', data_type: 'string', occurrence: 0 },
        y: [{ name: 'value', data_type: 'number', occurrence: 0 }]
      }
    }
  };
}

describe('native chart layout contracts', () => {
  it('shows totals for multiple bar segments without duplicating a lone visible quantity', () => {
    const doc = axis([
      ['a', 'one', '7'],
      ['a', 'two', '2'],
      ['b', 'one', '0'],
      ['b', 'two', '0']
    ]);
    doc.options = { labels: 'auto' };
    const multiple = layout(doc);
    expect(multiple.interactions[0].tooltip.summary?.value).toBe('9');
    expect(multiple.interactions[1].tooltip.summary?.value).toBe('0');

    const single = layout(doc, new Set(['two']));
    expect(single.interactions.map((value) => value.tooltip.summary)).toEqual([
      undefined,
      undefined
    ]);
    expect(single.interactions.map((value) => value.tooltip.rows[0].value)).toEqual(['7', '0']);
    expect(single.labels?.filter((mark) => mark.kind === 'text').map((mark) => mark.text)).toEqual([
      '7',
      '0'
    ]);
  });

  it.each([
    'bar',
    'line',
    'area'
  ] as const)('uses Console semantic category paints on native %s marks and inspection swatches', (type) => {
    const doc = axis([
      ['200', 'unused', '3'],
      ['404', 'unused', '2'],
      ['500', 'unused', '1']
    ]);
    doc.spec.visualization = type;
    doc.data.fields[0].name = 'status';
    if (
      doc.spec.visualization !== 'line' &&
      doc.spec.visualization !== 'bar' &&
      doc.spec.visualization !== 'area'
    )
      throw new Error('Fixture');
    doc.spec.encoding.x.name = 'status';
    delete doc.spec.encoding.series;
    const m = layout(doc);
    const paints = ['success', 'warning', 'error'].map(
      (name) => `var(--color-chart-semantic-${name}${type === 'line' ? '-line' : ''})`
    );
    expect(
      m.marks
        .filter((mark) => mark.kind === (type === 'bar' ? 'rect' : 'circle'))
        .map((mark) => mark.fill)
    ).toEqual(paints);
    expect(m.interactions.map((value) => value.tooltip.rows[0].color)).toEqual(paints);
  });

  it('splits explicit NULL runs and preserves the NULL reading and its source at that position', () => {
    const compiled = compileChart(sample);
    const model = layoutChart(compiled, new Set(), 640, 300, measure);
    expect(model.marks.filter((m) => m.kind === 'path')).toHaveLength(4);
    const missing = model.interactions[3];
    expect(missing.tooltip.rows.map((r) => r.label)).toEqual(['api', 'ingest', 'worker']);
    expect(missing.tooltip.rows[0].value).toBe('NULL');
    expect(missing.sources).toEqual([
      compiled.document.data.rows[9],
      compiled.document.data.rows[10],
      compiled.document.data.rows[11]
    ]);
    expect(missing.sources[0]).toBe(compiled.document.data.rows[9]);
  });

  it('uses the same temporal positions through style changes and legend filtering', () => {
    const doc = document();
    const before = layout(doc);
    for (const type of ['area', 'bar', 'line'] as const) {
      doc.spec.visualization = type;
      // Y label width may change; compare positions relative to the drawable range.
      const next = layout(doc, new Set(['api']));
      const normalized = (m: typeof next) =>
        m.interactions.map((v) => (v.anchor.x - m.rect!.x - 28) / (m.rect!.width - 56));
      expect(normalized(next)).toEqual(normalized(before));
      expect(next.interactions.map((v) => v.key)).toEqual(before.interactions.map((v) => v.key));
    }
  });

  it('keeps categorical NULL positions as gaps and does not invent unreturned observations', () => {
    const doc = axis(
      [
        ['a', 'api', '1'],
        ['b', 'api', null],
        ['c', 'api', '2']
      ],
      'line'
    );
    expect(layout(doc).marks.filter((m) => m.kind === 'path')).toHaveLength(2);
    doc.data.rows.splice(1, 1);
    expect(layout(doc).marks.filter((m) => m.kind === 'path')).toHaveLength(1);
  });

  it('stacks positive and negative values independently and supports explicit grouping', () => {
    const doc = axis([
      ['a', 'one', '2'],
      ['a', 'two', '3'],
      ['a', 'negative', '-4']
    ]);
    const stacked = layout(doc);
    const bars = stacked.marks.filter((m) => m.kind === 'rect');
    expect(bars).toHaveLength(3);
    expect(bars[1].y + bars[1].height).toBeCloseTo(bars[0].y);
    expect(bars[2].y).toBeCloseTo(stacked.baseline!);
    expect(bars[0].x).toBe(bars[1].x);
    doc.options = { stack: false };
    const grouped = layout(doc).marks.filter((m) => m.kind === 'rect');
    expect(grouped[0].x + grouped[0].width).toBeCloseTo(grouped[1].x);
    expect(grouped[0].y + grouped[0].height).toBeCloseTo(grouped[1].y + grouped[1].height);
  });

  it('inspects dense bars only inside their own column and does not create cumulative point markers', () => {
    const doc = document();
    doc.spec.visualization = 'bar';
    const compiled = compileChart(doc);
    const m = layoutChart(compiled, new Set(), 420, 300, measure);
    const first = m.interactions[0],
      second = m.interactions[1],
      y = m.rect!.y + m.rect!.height / 2;
    expect(m.hitMode).toBe('bar');
    expect(first.points).toEqual([]);
    expect(m.marks.filter((mark) => mark.key === first.key)).toHaveLength(3);
    expect(nearestInteraction(m, { x: first.band!.x + 1, y })).toBe(first);
    expect(nearestInteraction(m, { x: first.band!.x + first.band!.width - 1, y })).toBe(first);
    // Both positions are within the old 48px snap radius, but the gap is not a bar.
    expect(second.anchor.x - first.anchor.x).toBeLessThan(48);
    expect(nearestInteraction(m, { x: (first.anchor.x + second.anchor.x) / 2, y })).toBeNull();
    expect(first.tooltip.rows.map((row) => row.value)).toEqual(['120', '90', '30']);
    expect(first.sources).toEqual(compiled.document.data.rows.slice(0, 3));
  });

  it('keeps every signed, grouped bar in one inspection column with the original source values', () => {
    const doc = axis([
      ['a', 'one', '2'],
      ['a', 'two', '3'],
      ['a', 'negative', '-4']
    ]);
    doc.options = { stack: false };
    const m = layout(doc),
      value = m.interactions[0];
    for (const mark of m.marks) {
      if (mark.kind !== 'rect') throw new Error('Expected grouped bars');
      expect(mark.key).toBe(value.key);
      expect(
        nearestInteraction(m, { x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 })
      ).toBe(value);
    }
    expect(value.points).toEqual([]);
    expect(value.anchor.y).toBeLessThan(m.baseline!);
    expect(value.tooltip.rows.map((row) => row.value)).toEqual(['2', '3', '-4']);
    expect(value.bars?.map((bar) => bar.series)).toEqual(['one', 'two', 'negative']);
    const negative = layout(axis([['a', 'one', '-4']]));
    expect(negative.interactions[0].anchor.y).toBe(negative.baseline);
  });

  it('retains real zero inspection without painting a fabricated bar', () => {
    const m = layout(
      axis([
        ['a', 'api', '0'],
        ['b', 'api', null]
      ])
    );
    expect(m.marks).toEqual([]);
    expect(m.interactions).toHaveLength(1);
    expect(m.interactions[0].tooltip.rows[0].value).toBe('0');
    expect(m.interactions[0].points).toEqual([]);
    expect(nearestInteraction(m, m.interactions[0].anchor)).toBe(m.interactions[0]);
    expect(nearestInteraction(m, { x: m.xTicks[1].position, y: m.baseline! })).toBeNull();
  });

  it('reports an exact complete stack total and omits totals when a series is absent', () => {
    const doc = axis([
      ['a', 'one', '9007199254740993'],
      ['a', 'two', '3'],
      ['b', 'one', '2']
    ]);
    const model = layout(doc);
    expect(model.interactions[0].tooltip.summary?.value).toBe('9,007,199,254,740,996');
    expect(model.interactions[1].tooltip.rows.map((row) => row.value)).toEqual(['2', '—']);
    expect(model.interactions[1].tooltip.summary).toBeUndefined();
    doc.options = { stack: false };
    expect(layout(doc).interactions[0].tooltip.summary).toBeUndefined();
  });

  it('rejects an overflowing stack before creating invalid SVG geometry', () => {
    expect(() =>
      layout(
        axis([
          ['a', 'one', '1e308'],
          ['a', 'two', '1e308']
        ])
      )
    ).toThrow('stack total');
  });

  it('keeps labels and keys containing markup as plain data', () => {
    const label = '<script>alert(1)</script>',
      m = layout(axis([[label, 'api', '1']]));
    expect(m.xTicks[0].label).toBe('<script>alert(1)</scri…');
    expect(measure(m.xTicks[0].label)).toBeLessThanOrEqual(140);
    expect(m.interactions[0].tooltip.title).toBe(label);
    expect(m.interactions[0].sources[0][0]).toBe(label);
  });

  it('resolves narrow-axis label collisions in the scene without truncating source identity', () => {
    const labels = Array.from({ length: 6 }, (_, index) => `Service ${index} with a long name`),
      compiled = compileChart(axis(labels.map((label) => [label, 'api', '1']))),
      scene = layoutChart(compiled, new Set(), 320, 300, measure),
      r = scene.rect!;
    expect(scene.xTicks.length).toBeLessThan(labels.length);
    let previousRight = -Infinity;
    for (const tick of scene.xTicks) {
      const left = tick.labelPosition!,
        right = left + measure(tick.label);
      expect(left).toBeGreaterThanOrEqual(r.x);
      expect(left).toBeGreaterThanOrEqual(previousRight + 8);
      expect(right).toBeLessThanOrEqual(r.x + r.width);
      previousRight = right;
    }
    expect(scene.interactions.map((value) => value.tooltip.title)).toEqual(labels);
    expect(scene.interactions.map((value) => value.sources[0][0])).toEqual(labels);
  });

  it('uses bounded nearest-X inspection without snapping across distant gaps or outside axes', () => {
    const m = layout(sample),
      p = m.interactions[2].anchor;
    expect(nearestInteraction(m, p)?.key).toBe(m.interactions[2].key);
    expect(nearestInteraction(m, { ...p, y: -1 })).toBeNull();
    const doc = axis([
      ['a', 'api', '1'],
      ['z', 'api', '2']
    ]);
    const sparse = layout(doc),
      r = sparse.rect!;
    expect(nearestInteraction(sparse, { x: r.x + r.width / 2, y: r.y + r.height / 2 })).toBeNull();
  });

  it('preserves distribution aggregation and draws a complete single-category ring', () => {
    const doc = axis([
      ['api', 'unused', '2'],
      ['api', 'unused', '3'],
      ['worker', 'unused', '1']
    ]);
    if (
      doc.spec.visualization !== 'bar' &&
      doc.spec.visualization !== 'line' &&
      doc.spec.visualization !== 'area'
    )
      throw new Error('Fixture');
    const encoding = doc.spec.encoding;
    doc.spec = {
      visualization: 'pie',
      encoding: { category: encoding.x, value: encoding.y[0] }
    };
    const m = layout(doc, new Set(['worker']));
    expect(m.center?.value).toBe('5');
    expect(m.interactions[0].sources).toHaveLength(2);
    expect(m.interactions[0].tooltip.rows[1].value).toBe('100.0%');
    expect(m.marks[0].kind === 'path' && m.marks[0].d.match(/A/g)).toHaveLength(4);
    expect(layout(doc, new Set(['api', 'worker'])).marks).toEqual([]);
  });
});

describe('linear scales', () => {
  it.each([
    [0, 0],
    [1e308, 1.1e308],
    [-1e308, 1e308],
    [5e-324, 1e-323],
    [1e-12, 2e-12],
    [-8, -2]
  ])('keeps finite ordered geometry for %s to %s', (min, max) => {
    const axis = numericAxis([min, max], 5);
    expect(axis.domain[0]).toBeLessThan(axis.domain[1]);
    const scale = linear(axis.domain, [0, 500]);
    expect(Number.isFinite(scale(min))).toBe(true);
    expect(Number.isFinite(scale(max))).toBe(true);
    expect(scale(min)).toBeLessThanOrEqual(scale(max));
    expect(new Set(axis.labels).size).toBe(axis.labels.length);
  });
});
