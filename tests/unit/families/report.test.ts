import { expect, it } from 'vitest';
import { compileChart, type ChartDocumentInput } from '../../../src/families/metrics/document.js';
import { layoutChart } from '../../../src/families/metrics/layout.js';
import { compileProfile, createProfileView } from '../../../src/families/profile.js';
import { compileTrace, createTraceView } from '../../../src/families/trace.js';
import { layoutHierarchy } from '../../../src/families/hierarchy/layout.js';
import { sparseTicks } from '../../../src/core/axes.js';
import sample from '../../../examples/requests.json';

const measure = (text: string) => text.length * 6;
const category: ChartDocumentInput = {
  version: 1,
  data: {
    fields: [
      { name: 'service', data_type: 'string' },
      { name: 'requests', data_type: 'number' }
    ],
    rows: [
      ['api', '120'],
      ['query', '80'],
      ['empty', '0']
    ]
  },
  spec: {
    visualization: 'bar',
    encoding: { x: 'service', y: ['requests'] }
  }
};

it('report category labels replace the value ruler only when every value fits', () => {
  const compiled = compileChart(category);
  const report = layoutChart(compiled, new Set(), 640, 240, measure, 'minimal');
  expect(report.axisStyle).toBe('minimal');
  expect(report.labels?.map((mark) => mark.kind === 'text' && mark.text)).toEqual([
    '120',
    '80',
    '0'
  ]);
  expect(report.yTicks).toEqual([]);
  expect(report.xTicks.map((tick) => tick.label)).toEqual(['api', 'query', 'empty']);
  expect(report.baseline).toBe(report.rect!.y + report.rect!.height);
  const narrow = layoutChart(compiled, new Set(), 100, 240, measure, 'minimal');
  expect(narrow.yTicks.length).toBeGreaterThan(0);
  expect(narrow.yTicks.length).toBeLessThanOrEqual(3);
  const full = layoutChart(compiled, new Set(), 640, 240, measure);
  expect(full.axisStyle).toBeUndefined();
  expect(full.yTicks.length).toBeGreaterThan(3);
});

it('sparse rulers retain zero between positive and negative references', () => {
  const ticks = [-20, -10, 0, 10, 20].map((value) => ({ position: value, label: String(value) }));
  expect(sparseTicks(ticks, 3, 0).map((tick) => tick.label)).toEqual(['-20', '0', '20']);
});

it('report time charts keep date context, exact sources and supplied gaps', () => {
  const compiled = compileChart(sample);
  const full = layoutChart(compiled, new Set(), 640, 240, measure);
  const report = layoutChart(compiled, new Set(), 640, 240, measure, 'minimal');
  expect(report.xTicks.length).toBeLessThanOrEqual(3);
  expect(report.yTicks.length).toBeLessThanOrEqual(3);
  expect(report.xTitle).toMatch(/2026/);
  expect(report.interactions.map((target) => target.sources)).toEqual(
    full.interactions.map((target) => target.sources)
  );
  const connections = (scene: typeof full) =>
    scene.marks
      .filter((mark) => mark.kind === 'path')
      .map((mark) => mark.kind === 'path' && mark.d.replace(/[-\d.,]+/g, ''));
  expect(connections(report)).toEqual(connections(full));
  const inline = layoutChart(compiled, new Set(), 160, 32, measure, 'none');
  expect(inline.xTicks).toEqual([]);
  expect(inline.yTicks).toEqual([]);
  expect(inline.xTitle).toBeUndefined();
  expect(inline.interactive).toBe(true);
});

it('report hierarchy fits every depth while preserving exact source weights and units', () => {
  const model = createProfileView(
    compileProfile({
      version: 1,
      kind: 'profile',
      unit: 'samples',
      frames: Array.from({ length: 150 }, (_, index) => ({
        id: String(index),
        ...(index ? { parentId: String(index - 1) } : {}),
        name: `frame ${index}`,
        selfWeight: index === 149 ? '9007199254740993' : '0'
      }))
    })
  );
  const report = layoutHierarchy(model, 640, 240, measure, undefined, 'minimal', true);
  expect(report.interactions).toHaveLength(150);
  expect(report.interactions.at(-1)!.sources[0].selfWeight).toBe('9007199254740993');
  expect(report.xTicks.length).toBeLessThanOrEqual(3);
  expect(report.xTicks.at(-1)!.label).toContain('samples');
  expect(report.xTitle).toBeUndefined();
  for (const mark of report.marks) {
    if (mark.kind !== 'rect') continue;
    expect(mark.height).toBeGreaterThan(0);
    expect(mark.y + mark.height).toBeLessThanOrEqual(report.rect!.y + report.rect!.height);
  }
  expect(layoutHierarchy(model, 640, 240, measure).interactions.length).toBeLessThan(150);
});

it('entity labels use readable type and omit fragments without losing intervals or exact names', () => {
  const model = createTraceView(
    compileTrace({
      version: 1,
      kind: 'trace',
      spans: [
        { id: 'root', name: 'Request', startTimeNs: '0', endTimeNs: '100' },
        { id: 'tiny', parentId: 'root', name: 'retry · timeout', startTimeNs: '0', endTimeNs: '8' },
        { id: 'micro', parentId: 'root', name: 'micro span', startTimeNs: '8', endTimeNs: '9' },
        { id: 'short', parentId: 'root', name: 'IO', startTimeNs: '10', endTimeNs: '16' },
        { id: 'long', parentId: 'root', name: 'decodeBatch', startTimeNs: '20', endTimeNs: '90' }
      ]
    })
  );
  for (const axes of ['full', 'minimal'] as const) {
    const scene = layoutHierarchy(model, 620, 240, measure, undefined, axes, axes === 'minimal');
    const labels = scene.marks.filter((mark) => mark.kind === 'text');
    expect(labels.map((mark) => mark.text)).toEqual(['Request', '…', 'IO', 'decodeBatch']);
    expect(labels.every((mark) => mark.fontSize === 12)).toBe(true);
    expect(scene.marks.filter((mark) => mark.kind === 'rect')).toHaveLength(5);
    const tiny = scene.interactions.find((target) => target.sources[0].id === 'tiny')!;
    expect(tiny.hitRect!.width).toBeCloseTo(scene.rect!.width * 0.08);
    expect(tiny.tooltip.title).toBe('retry · timeout');
    expect(tiny.sources[0].endTimeNs).toBe('8');
    for (const label of labels) {
      const mark = scene.marks.find(
        (mark) =>
          mark.kind === 'rect' &&
          mark.y < label.y &&
          mark.y + mark.height > label.y &&
          mark.x < label.x &&
          mark.x + mark.width > label.x
      )!;
      if (mark.kind !== 'rect') throw new Error('Label must remain within its source interval.');
      const textWidth = (measure(label.text) * 12) / 11;
      if (label.text === '…') {
        expect(label.x + textWidth / 2).toBeCloseTo(mark.x + mark.width / 2);
        expect(textWidth).toBeLessThanOrEqual(mark.width - 8);
      } else {
        expect(label.x - mark.x).toBe(8);
        expect(textWidth).toBeLessThanOrEqual(mark.width - 16);
      }
    }
  }
});
