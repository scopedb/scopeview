import { describe, expect, it } from 'vitest';
import { compileChart, layoutChart, fieldRef, buildChartDataset } from '../../../../src/index.js';
import { inspectionSeriesAt } from '../../../../src/core/inspection-series.js';
import { markDocument } from '../../../../examples/mark-data.js';

const measure = (text: string) => text.length * 6;
const sceneFor = (family: Parameters<typeof markDocument>[0], width = 640, height = 260) =>
  layoutChart(compileChart(markDocument(family)), new Set(), width, height, measure);

describe('family emphasis and exact reading contracts', () => {
  it('distinguishes stack seams from the outer silhouette without changing straight paths', () => {
    const doc = markDocument('area'),
      compiled = compileChart(doc);
    const scene = layoutChart(compiled, new Set(), 640, 260, measure);
    const strokes = scene.marks.filter((mark) => mark.kind === 'path' && mark.stroke);
    expect(strokes.map((mark) => mark.kind === 'path' && mark.strokeWidth)).toEqual([1, 1, 2]);
    expect(strokes.every((mark) => mark.kind === 'path' && !/[CQHV]/.test(mark.d))).toBe(true);
    const single = layoutChart(compiled, new Set(['warning', 'error']), 640, 260, measure);
    expect(
      single.marks
        .filter((mark) => mark.kind === 'path' && mark.stroke)
        .map((mark) => mark.kind === 'path' && mark.strokeWidth)
    ).toEqual([2]);
  });
  it('names scatter coordinates and declared units on cards while fitting long axis names', () => {
    const doc = markDocument('scatter'),
      dataset = buildChartDataset(doc.data);
    doc.options!.values = [
      { field: fieldRef(dataset, 'result-column-0'), divisor: '1000', unit: 's', decimals: 3 }
    ];
    const scene = layoutChart(compileChart(doc), new Set(), 320, 240, measure);
    expect(scene.xTitle).toBe('Latency (s)');
    expect(scene.yTitle).toBe('CPU');
    expect(scene.interactions[0].tooltip.rows[0].value).toBe('0.018 s');
    doc.data.fields[0].name = 'A very long latency coordinate field';
    if (doc.spec.visualization !== 'scatter') throw new Error('Fixture');
    doc.spec.encoding.x.name = doc.data.fields[0].name;
    doc.options!.values![0].field.name = doc.data.fields[0].name;
    const narrow = layoutChart(compileChart(doc), new Set(), 320, 240, measure);
    expect(measure(narrow.xTitle!)).toBeLessThanOrEqual(narrow.rect!.width);
    expect(narrow.interactions[0].tooltip.rows[0].label).toBe(doc.data.fields[0].name);
  });
  it('discloses composition shares against visible totals without repeating them in resting labels', () => {
    const donut = sceneFor('donut');
    expect(donut.interactions[0].tooltip.context).toBe('Share of visible total');
    expect(donut.labels?.every((mark) => mark.kind !== 'text' || !mark.text.includes('%'))).toBe(
      true
    );
    const doc = markDocument('treemap'),
      compiled = compileChart(doc);
    const scene = layoutChart(compiled, new Set(['info']), 320, 200, measure);
    expect(scene.interactions.map((value) => value.tooltip.rows.map((row) => row.value))).toEqual([
      ['43', '50.0%'],
      ['43', '50.0%'],
      ['0', '0.0%']
    ]);
    doc.data.rows.forEach((row) => {
      row[1] = '0';
    });
    const zero = layoutChart(compileChart(doc), new Set(), 320, 200, measure);
    expect(zero.interactions.every((value) => value.tooltip.rows[1].value === '0.0%')).toBe(true);
    doc.data.rows[0][1] = null;
    expect(() => compileChart(doc)).toThrow(/non-NULL/);
  });
  it('assigns ranked rows their own paint policy and retains zero and NULL readings', () => {
    const doc = markDocument('treemap');
    doc.spec.visualization = 'top-list';
    doc.data.rows.push(['missing', null]);
    const scene = layoutChart(compileChart(doc), new Set(), 320, 200, measure);
    expect(scene.emphasis).toBe('row');
    expect(scene.interactions.slice(-2).map((value) => value.tooltip.rows[0].value)).toEqual([
      '0',
      'NULL'
    ]);
  });
  it('supplies radial hover geometry without changing the original hit path or center total', () => {
    const scene = sceneFor('donut'),
      first = scene.interactions[0];
    expect(scene.emphasis).toBe('radial');
    expect(first.radial?.expandedPath).not.toBe(scene.marks[0].kind === 'path' && scene.marks[0].d);
    expect(first.tooltip.rows.map((row) => row.value)).toEqual(['428', '83.3%']);
    expect(scene.center?.value).toBe('514');
    expect(scene.interactions).toHaveLength(3);
    const document = markDocument('donut');
    const empty = layoutChart(
      compileChart(document),
      new Set(['info', 'warning', 'error']),
      320,
      200,
      measure
    );
    expect(empty.marks).toEqual([]);
    expect(empty.center?.value).toBe('0');
    expect(empty.interactions).toEqual([]);
  });

  it('fits cell text by available space while retaining complete source values', () => {
    const scene = sceneFor('treemap'),
      text = scene.marks.filter((mark) => mark.kind === 'text');
    expect(scene.emphasis).toBe('cell');
    expect(text[0].fontSize).toBeGreaterThan(text.at(-1)!.fontSize!);
    for (const mark of text) {
      const cell = scene.marks.find(
        (cell) =>
          cell.kind === 'rect' &&
          mark.x >= cell.x &&
          mark.x <= cell.x + cell.width &&
          mark.y >= cell.y &&
          mark.y <= cell.y + cell.height
      );
      if (cell?.kind !== 'rect') throw new Error('Missing label cell');
      expect(measure(mark.text) * (mark.fontSize! / 11) * 1.08).toBeLessThanOrEqual(
        cell.width - 16
      );
      expect(mark.y + mark.fontSize! / 2).toBeLessThan(cell.y + cell.height);
    }
    const small = sceneFor('treemap', 160, 80);
    expect(small.interactions.map((value) => value.tooltip.rows[0].value)).toEqual([
      '428',
      '43',
      '43',
      '0'
    ]);
  });

  it('identifies a stacked area from sample geometry and reports its own quantity', () => {
    const scene = sceneFor('area'),
      value = scene.interactions[1];
    expect(scene.emphasis).toBe('series');
    expect(scene.marks.every((mark) => !!mark.series)).toBe(true);
    for (const point of value.points) {
      if (point.baseY === point.y) continue;
      expect(inspectionSeriesAt(value, { x: point.x, y: (point.baseY! + point.y) / 2 })).toBe(
        point.series
      );
    }
    expect(value.tooltip.rows.map((row) => row.value)).toEqual(['27', '7', '1']);
    expect(value.points[1].baseY).toBe(value.points[0].y);
    expect(value.points[2].baseY).toBe(value.points[1].y);
    expect(inspectionSeriesAt(value, { x: value.anchor.x, y: scene.rect!.y + 1 })).toBeNull();
    const document = markDocument('area');
    document.spec.visualization = 'line';
    const line = layoutChart(compileChart(document), new Set(), 640, 260, measure);
    expect(line.interactions[1].points.every((point) => point.baseY === undefined)).toBe(true);
    expect(
      inspectionSeriesAt(line.interactions[1], { x: value.anchor.x, y: scene.rect!.y + 1 })
    ).toBeNull();
  });

  it('keeps scatter source coordinates and semantic colors through its point policy', () => {
    const scene = sceneFor('scatter');
    expect(scene.emphasis).toBe('point');
    expect(scene.interactions[2].tooltip.rows.map((row) => row.value)).toEqual(['26', '32']);
    const mark = scene.marks[2];
    expect(mark.fill).toBe('var(--color-chart-semantic-error)');
    expect(mark.kind === 'circle' && mark.opacity).toBe(1);
    expect(mark.kind === 'circle' && mark.radius).toBe(5);
    expect(scene.interactions[2].sources[0]).toEqual(['26', '32', 'error']);
  });

  it('keeps signed area geometry separate and gives NULL no inspectable segment', () => {
    const document = markDocument('area');
    if (document.semantics?.time?.kind !== 'buckets') throw new Error('Fixture');
    document.semantics.time.valueKind = 'number';
    document.data.rows[3][2] = '-27';
    document.data.rows[4][2] = null;
    const scene = layoutChart(compileChart(document), new Set(), 640, 260, measure),
      value = scene.interactions[1],
      negative = value.points.find((point) => point.series === 'info')!;
    expect(value.tooltip.rows.map((row) => row.value)).toEqual(['-27', 'NULL', '1']);
    expect(value.points.some((point) => point.series === 'warning')).toBe(false);
    expect(negative.y).toBeGreaterThan(negative.baseY!);
    expect(
      inspectionSeriesAt(value, { x: negative.x, y: (negative.y + negative.baseY!) / 2 })
    ).toBe('info');
    expect(value.points.find((point) => point.series === 'error')!.baseY).toBe(negative.baseY);
  });
});
