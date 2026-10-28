import { describe, expect, it } from 'vitest';
import {
  compileChart,
  layoutChart,
  buildChartDataset,
  createChartSpec,
  fieldRef,
  dimensionTuple,
  RangeSelectionSession,
  snapTimeRange,
  type ResultSet,
  type ChartDocument
} from '../../../../src/index.js';
import { nearestInteraction } from '../../../../src/core/hit-test.js';
import { formatQuantity } from '../../../../src/data/semantics.js';
import { weightedRectangles } from '../../../../src/families/metrics/layout-treemap.js';

const measure = (text: string) => text.length * 6;
const hour = 3_600_000,
  start = Date.UTC(2026, 8, 29);
function buckets(
  rows: (string | null)[][] = [
    [new Date(start).toISOString(), '12'],
    [new Date(start + hour).toISOString(), '0'],
    [new Date(start + 2 * hour).toISOString(), null],
    [new Date(start + 4 * hour).toISOString(), '24']
  ]
): ChartDocument {
  const data: ResultSet = {
    fields: [
      { name: 'time', data_type: 'timestamp' },
      { name: 'count', data_type: 'number' }
    ],
    rows
  };
  const dataset = buildChartDataset(data);
  return {
    version: 1,
    data,
    spec: createChartSpec(dataset, {
      displayType: 'bar',
      mapping: { kind: 'axis', x: 'result-column-0', y: ['result-column-1'] }
    }),
    semantics: {
      time: {
        kind: 'buckets',
        field: fieldRef(dataset, 'result-column-0'),
        intervalMs: hour,
        coverage: 'limited',
        valueKind: 'count',
        window: { start: start + hour / 4, end: start + 6 * hour }
      }
    }
  };
}
const scene = (doc: ChartDocument, height = 144) =>
  layoutChart(compileChart(doc), new Set(), 640, height, measure);
function categories(
  values: (string | null)[][],
  type: 'treemap' | 'top-list' = 'top-list'
): ChartDocument {
  const data: ResultSet = {
    fields: [
      { name: 'status', data_type: 'string' },
      { name: 'value', data_type: 'number' }
    ],
    rows: values
  };
  return {
    version: 1,
    data,
    spec: createChartSpec(buildChartDataset(data), {
      displayType: type,
      mapping: { kind: 'distribution', category: 'result-column-0', value: 'result-column-1' }
    })
  };
}

describe('public snapshot semantics', () => {
  it('compiles explicit buckets once and preserves missing, NULL and zero', () => {
    const compiled = compileChart(buckets());
    expect(compiled.axisModel?.kind).toBe('time-series');
    if (compiled.axisModel?.kind !== 'time-series' || compiled.axisModel.sampling !== 'buckets')
      throw new Error('Fixture');
    expect(compiled.axisModel.coverage).toBe('limited');
    expect(compiled.axisModel.gaps).toEqual([
      { start: start + 3 * hour, end: start + 4 * hour, state: 'not-returned' }
    ]);
    const model = layoutChart(compiled, new Set(), 640, 144, measure);
    expect(model.interactions).toHaveLength(4);
    expect(model.interactions[2].tooltip.rows[0].value).toBe('NULL');
    expect(model.interactions[2].bars).toEqual([]);
    expect(model.interactions[2].sources[0]).toBe(compiled.document.data.rows[2]);
    expect(model.interactions[0].time).toEqual({ start: start + hour / 4, end: start + hour });
    expect(
      nearestInteraction(model, { x: model.interactions[1].band!.x, y: model.rect!.y + 4 })
    ).toBe(model.interactions[1]);
    expect(
      nearestInteraction(model, { x: model.rect!.x + model.rect!.width, y: model.rect!.y + 4 })
    ).toBeNull();
    expect(model.interactions[1].tooltip.rows[0].value).toBe('0');
    expect(model.marks.filter((mark) => mark.kind === 'rect')).toHaveLength(2);
    expect(model.time?.domain).toEqual(buckets().semantics!.time!.window);
    expect(model.time?.coverage).toBe('limited');
    expect(model.interactions[0].sources[0]).toBe(compiled.document.data.rows[0]);
    expect(model.interactions[0].tooltip.title).toContain('–');
  });
  it('uses duration geometry with a clipped partial bucket and compatible time domains', () => {
    const doc = buckets(),
      bar = scene(doc),
      r = bar.rect!;
    const first = bar.marks.find((mark) => mark.kind === 'rect')!;
    expect(first.kind === 'rect' && first.x).toBeGreaterThanOrEqual(r.x);
    const last = bar.marks.filter((mark) => mark.kind === 'rect').at(-1)!;
    expect(first.kind === 'rect' && last.kind === 'rect' && first.width).toBeLessThan(
      last.kind === 'rect' ? last.width : 0
    );
    expect(bar.clipRect).toEqual(r);
    doc.spec.visualization = 'line';
    const line = scene(doc);
    expect(line.time).toEqual(bar.time);
    expect(line.marks.filter((mark) => mark.kind === 'path')).toHaveLength(2);
  });
  it('retains an empty executed window without fabricating targets', () => {
    const model = scene(buckets([]));
    expect(model.rect!.width).toBeGreaterThan(0);
    expect(model.xTicks.length).toBeGreaterThan(0);
    expect(model.time?.window).toBeDefined();
    expect(model.interactions).toEqual([]);
    expect(model.marks).toEqual([]);
  });
  it('keeps tiny partial-edge buckets visible and hits the adjoining wider column', () => {
    const doc = buckets();
    doc.semantics!.time!.window!.start = start + hour * 0.99;
    const model = scene(doc),
      first = model.interactions[0],
      second = model.interactions[1];
    expect(first.band!.width).toBeGreaterThan(0);
    expect(first.band!.width).toBeLessThan(second.band!.width / 50);
    expect(nearestInteraction(model, { x: second.band!.x + 0.1, y: model.rect!.y + 4 })).toBe(
      second
    );
    doc.spec.visualization = 'line';
    expect(scene(doc).interactions.map((i) => i.anchor.x)).toEqual(
      model.interactions.map((i) => i.anchor.x)
    );
  });
  it.each([
    'interval',
    'field',
    'window',
    'alignment',
    'precision',
    'outside',
    'count'
  ])('rejects inconsistent %s metadata', (reason) => {
    const doc = buckets();
    const time = doc.semantics!.time!;
    if (time.kind !== 'buckets') throw new Error('Fixture');
    if (reason === 'interval') time.intervalMs = 0;
    if (reason === 'field')
      time.field = doc.spec.visualization === 'bar' ? doc.spec.encoding.y[0] : time.field;
    if (reason === 'window') time.window!.end = time.window!.start;
    if (reason === 'alignment') doc.data.rows[0][0] = new Date(start + 1).toISOString();
    if (reason === 'precision') doc.data.rows[0][0] = '2026-09-29T00:00:00.000001Z';
    if (reason === 'outside') doc.data.rows[0][0] = new Date(start - hour).toISOString();
    if (reason === 'count') doc.data.rows[0][1] = '-1';
    expect(() => compileChart(doc)).toThrow();
  });
  it('does not infer cadence for ordinary point documents', () => {
    const doc = buckets();
    delete doc.semantics;
    const model = compileChart(doc).axisModel;
    expect(model?.kind === 'time-series' && model.sampling).toBe('points');
  });
});

describe('source precision and presentation', () => {
  it('projects geometry without rewriting exact sources and applies explicit paint', () => {
    const doc = buckets([[new Date(start).toISOString(), '9007199254740993']]);
    const field = fieldRef(buildChartDataset(doc.data), 'result-column-1');
    doc.options = {
      values: [{ field, divisor: '1000', unit: 'ms', decimals: 2 }],
      colors: { count: '#42c2ad' }
    };
    const compiled = compileChart(doc),
      model = layoutChart(compiled, new Set(), 640, 200, measure, 'minimal');
    expect(compiled.document.data.rows[0][1]).toBe('9007199254740993');
    expect(compiled.dataset.rows[0].values[1]).toBe(Number('9007199254740993') / 1000);
    expect(model.interactions[0].tooltip.rows[0].value).toBe('9,007,199,254,740.99 ms');
    expect(model.interactions[0].tooltip.rows[0].color).toBe('#42c2ad');
    expect(model.axisStyle).toBe('minimal');
    expect(model.xTitle).toBe('Sep 29, 2026 · UTC');
    expect(model.yTitle).toBeUndefined();
  });
  it.each([
    ['9007199254740993', '1', 0, '9,007,199,254,740,993 B'],
    ['10', '1000', 2, '0.01 B'],
    ['1', '1000', 2, '<0.01 B'],
    ['0', '1000', 2, '0.00 B'],
    ['-1255', '1000', 2, '−1.26 B'],
    [null, '1000', 2, 'NULL']
  ] as const)('formats exact %s / %s quantities', (raw, divisor, decimals, expected) => {
    expect(formatQuantity(raw, { divisor, decimals, unit: 'B' })).toBe(expected);
  });
  it('fits a 24px static scene and carries bin provenance', () => {
    const doc = categories([
      ['[0, 10)', '12'],
      ['[10, 20]', '24']
    ]);
    doc.spec = createChartSpec(buildChartDataset(doc.data), {
      displayType: 'bar',
      mapping: { kind: 'axis', x: 'result-column-0', y: ['result-column-1'] }
    });
    doc.options = { presentation: 'sparkline' };
    doc.semantics = { provenance: { kind: 'bins', scope: 'sample', approximate: true } };
    const model = scene(doc, 24);
    expect(model.rect!.height).toBe(22);
    expect(model.xTicks).toEqual([]);
    expect(model.yTicks).toEqual([]);
    expect(model.interactive).toBe(false);
    expect(model.provenance).toEqual(doc.semantics.provenance);
  });
  it('applies the same exact display policy to donut and scatter inspection', () => {
    const doc = categories([
      ['API', '9007199254740993'],
      ['Worker', '10']
    ]);
    doc.spec.visualization = 'pie';
    doc.options = {
      values: [
        {
          field: fieldRef(buildChartDataset(doc.data), 'result-column-1'),
          divisor: '1000',
          unit: 'ms'
        }
      ]
    };
    expect(scene(doc).interactions[0].tooltip.rows[0].value).toBe('9,007,199,254,740.99 ms');
    const data: ResultSet = {
      fields: [
        { name: 'x', data_type: 'number' },
        { name: 'y', data_type: 'number' }
      ],
      rows: [['9007199254740993', '10']]
    };
    const dataset = buildChartDataset(data);
    const scatter: ChartDocument = {
      version: 1,
      data,
      spec: createChartSpec(dataset, {
        displayType: 'scatter',
        mapping: { kind: 'scatter', x: 'result-column-0', y: 'result-column-1' }
      }),
      options: {
        values: [{ field: fieldRef(dataset, 'result-column-0'), divisor: '1000', unit: 'ms' }]
      }
    };
    expect(scene(scatter).interactions[0].tooltip.rows[0].value).toBe('9,007,199,254,740.99 ms');
  });
  it('preserves distinct composite identities', () => {
    const values = [
      [null, ''],
      ['NULL', ''],
      ['', null],
      ['a / b', 'c'],
      ['a', 'b / c']
    ];
    expect(new Set(values.map((value) => dimensionTuple(value).key)).size).toBe(values.length);
  });
  it('rejects CSS URLs, duplicate display policies and unsupported orientations', () => {
    const doc = buckets();
    doc.options = { colors: { count: 'var(--color-chart-series-2)' } };
    expect(compileChart(doc).series[0].color).toBe('var(--color-chart-series-2)');
    doc.options = { colors: { count: 'url(https://example.com)' } };
    expect(() => compileChart(doc)).toThrow('hex color');
    const field = fieldRef(buildChartDataset(doc.data), 'result-column-1');
    doc.options = {
      values: [
        { field, divisor: '1000' },
        { field, divisor: '1000' }
      ]
    };
    expect(() => compileChart(doc)).toThrow('one display');
    doc.options = { orientation: 'horizontal' };
    expect(() => compileChart(doc)).toThrow('Horizontal frequency');
  });
});

describe('category families', () => {
  it('retains returned order, signed values and readable zero/NULL rows', () => {
    const model = scene(
      categories([
        ['200', '3'],
        ['500', '-4'],
        ['404', '0'],
        ['missing', null]
      ]),
      220
    );
    expect(model.interactions.map((item) => item.tooltip.title)).toEqual([
      '200',
      '500',
      '404',
      'missing'
    ]);
    expect(model.interactions.map((item) => item.tooltip.rows[0].value)).toEqual([
      '3',
      '-4',
      '0',
      'NULL'
    ]);
    expect(
      model.marks.filter((mark) => mark.kind === 'rect' && mark.fill !== 'transparent')
    ).toHaveLength(2);
    expect(model.ariaLabel).toContain('Top list');
    expect(model.interactions[2].tooltip.rows[0].color).toBe('var(--color-chart-semantic-warning)');
  });
  it('keeps NULL, empty and literal NULL category identities separate', () => {
    const compiled = compileChart(
      categories([
        [null, '0'],
        ['NULL', '0'],
        ['', '0']
      ])
    );
    expect(compiled.series.map((s) => s.name)).toEqual(['NULL', '"NULL"', '""']);
    expect(scene(compiled.document).interactions.map((item) => item.tooltip.title)).toEqual([
      'NULL',
      '"NULL"',
      '""'
    ]);
  });
  it('computes weighted rectangles without sum overflow and gives zero no area', () => {
    const bounds = { x: 0, y: 0, width: 400, height: 200 };
    const cells = weightedRectangles([1e308, 1e308, 0], bounds);
    expect(cells[0]!.width * cells[0]!.height).toBe(40_000);
    expect(cells[1]!.width * cells[1]!.height).toBe(40_000);
    expect(cells[2]).toBeNull();
    expect(weightedRectangles([1e308, 5e-324, 5e-324], bounds)[1]).toBeNull();
    const model = scene(
      categories(
        [
          ['a', '42'],
          ['b', '21'],
          ['zero', '0']
        ],
        'treemap'
      )
    );
    expect(model.interactions).toHaveLength(3);
    expect(model.marks.filter((mark) => mark.kind === 'rect')).toHaveLength(2);
    expect(model.ariaLabel).toContain('Treemap');
  });
  it.each([
    ['negative', '-1'],
    ['missing', null]
  ])('reports ineligible %s treemap weights', (_, value) => {
    expect(() => compileChart(categories([['a', value]], 'treemap'))).toThrow('Top list or Table');
  });
});

describe('controlled range session', () => {
  const window = { start: 250, end: 4750 },
    snapshot = {};
  it('snaps reverse drags outwards and clips partial boundaries', () => {
    expect(snapTimeRange(3200, 1100, window, 1000)).toEqual({ start: 1000, end: 4000 });
    expect(snapTimeRange(0, 5000, window, 1000)).toEqual(window);
    expect(snapTimeRange(1500, 1500, window, 1000)).toBeNull();
  });
  it('retains the controlled band on cancel and requires host acknowledgement on commit', () => {
    const session = new RangeSelectionSession(),
      original = { start: 1000, end: 2000 };
    session.configure({ snapshot, window, intervalMs: 1000 }, original);
    session.update(1100, 3500);
    session.cancel();
    expect(session.displayed).toEqual(original);
    session.update(1100, 3500);
    expect(session.commit(snapshot)).toEqual({ start: 1000, end: 4000 });
    expect(session.value).toEqual(original);
    expect(session.preview).toBeNull();
  });
  it('cancels stale/disabled previews and prevents stale commits', () => {
    const session = new RangeSelectionSession();
    session.configure({ snapshot, window, intervalMs: 1000 }, null);
    session.update(1100, 3500);
    session.configure({ snapshot: {}, window, intervalMs: 1000 }, null);
    expect(session.commit(snapshot)).toBeNull();
    session.update(1100, 3500);
    session.configure({ snapshot: {}, window, intervalMs: 1000, enabled: false }, null);
    expect(session.preview).toBeNull();
    expect(session.update(1100, 3500)).toBeNull();
  });
  it('retains preview through relayout and clips keyboard endpoints', () => {
    const session = new RangeSelectionSession();
    session.configure({ snapshot, window, intervalMs: 1000 }, null);
    session.adjust('end', 1);
    const pending = session.preview;
    session.configure({ snapshot, window, intervalMs: 1000 }, null);
    expect(session.preview).toEqual(pending);
    session.adjust('end', 'End');
    session.adjust('start', 'Home');
    expect(session.preview).toEqual(window);
  });
  it('rejects unsnapped controlled values rather than changing them silently', () => {
    const session = new RangeSelectionSession();
    expect(() =>
      session.configure({ snapshot, window, intervalMs: 1000 }, { start: 1100, end: 2000 })
    ).toThrow('snapped');
  });
  it('keeps the previous session usable after an invalid controlled update', () => {
    const session = new RangeSelectionSession();
    session.configure({ snapshot, window, intervalMs: 1000 }, null);
    session.update(1100, 3500);
    expect(() =>
      session.configure({ snapshot: {}, window, intervalMs: 1000 }, { start: 1100, end: 2000 })
    ).toThrow('snapped');
    expect(session.commit(snapshot)).toEqual({ start: 1000, end: 4000 });
  });
});
