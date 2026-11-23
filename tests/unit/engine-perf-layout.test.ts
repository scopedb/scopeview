import { describe, expect, it } from 'vitest';
import { fitLabel } from '../../src/core/labels.js';
import { SceneHitIndex } from '../../src/core/hit-test.js';
import type { ChartScene, PlotRect, SceneMark } from '../../src/core/scene.js';
import {
  DEFAULT_ROW_HEIGHT,
  hierarchyPadding,
  hierarchyViewportHeight,
  layoutHierarchy
} from '../../src/families/hierarchy/layout.js';
import { compileTrace, createTraceView } from '../../src/families/trace.js';
import { compileProfile, createProfileView } from '../../src/families/profile.js';
import { compileChart, type ChartDocumentInput } from '../../src/families/metrics/document.js';
import { compileAxis } from '../../src/families/metrics/compile-axis.js';
import { layoutChart } from '../../src/families/metrics/layout.js';
import { weightedRectangles } from '../../src/families/metrics/layout-treemap.js';
import { pointPinnedGrowth } from '../../src/theme/visual-tokens.js';

function referenceWeightedRectangles(
  values: readonly number[],
  bounds: PlotRect
): (PlotRect | null)[] {
  const result: (PlotRect | null)[] = values.map(() => null);
  const max = Math.max(0, ...values);
  if (!max) return result;
  const items = values.flatMap((value, index) =>
    value / max > 0 ? [{ index, weight: value / max }] : []
  );
  const split = (slice: { index: number; weight: number }[], r: PlotRect) => {
    if (slice.length === 1) {
      result[slice[0].index] = r;
      return;
    }
    const total = slice.reduce((sum, item) => sum + item.weight, 0);
    let partial = 0,
      index = 0;
    while (index < slice.length - 1 && partial < total / 2) partial += slice[index++].weight;
    const fraction = partial / total;
    if (r.width >= r.height) {
      const width = r.width * fraction;
      split(slice.slice(0, index), { ...r, width });
      split(slice.slice(index), { ...r, x: r.x + width, width: r.width - width });
    } else {
      const height = r.height * fraction;
      split(slice.slice(0, index), { ...r, height });
      split(slice.slice(index), { ...r, y: r.y + height, height: r.height - height });
    }
  };
  split(items, bounds);
  return result;
}

describe('treemap O(N log N) layout parity and scaling', () => {
  it('matches the reference split geometry across empty, single, zero, and skewed underflow inputs', () => {
    const bounds = { x: 8, y: 8, width: 624, height: 284 };
    const fixtures = [
      [],
      [42],
      [0, 0],
      [100, 50, 25, 12, 8, 5, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1e16, 1, 1, 1, 1, 1],
      [1e10, ...Array.from({ length: 16 }, () => 1)],
      [1e-9, 1e-9, 1e6, 1e-9, 1e-18, 1e-18],
      [0, 0, 42, 0]
    ];
    for (const values of fixtures) {
      const actual = weightedRectangles(values, bounds);
      const expected = referenceWeightedRectangles(values, bounds);
      expect(actual).toHaveLength(expected.length);
      for (let i = 0; i < expected.length; i++) {
        if (expected[i] === null) expect(actual[i]).toBeNull();
        else {
          expect(actual[i]).not.toBeNull();
          expect(actual[i]!.x).toBeCloseTo(expected[i]!.x, 10);
          expect(actual[i]!.y).toBeCloseTo(expected[i]!.y, 10);
          expect(actual[i]!.width).toBeCloseTo(expected[i]!.width, 10);
          expect(actual[i]!.height).toBeCloseTo(expected[i]!.height, 10);
        }
      }
    }
  });

  it('partitions 5,000 treemap items into positive non-overlapping cells covering bounds', () => {
    const bounds = { x: 0, y: 0, width: 1000, height: 600 };
    const values = Array.from({ length: 5000 }, (_, i) => (i === 0 ? 1e9 : 5000 - i));
    const cells = weightedRectangles(values, bounds);
    expect(cells).toHaveLength(5000);
    let area = 0;
    for (const cell of cells) {
      expect(cell).not.toBeNull();
      expect(cell!.width).toBeGreaterThan(0);
      expect(cell!.height).toBeGreaterThan(0);
      area += cell!.width * cell!.height;
    }
    expect(area).toBeCloseTo(bounds.width * bounds.height, 6);
  });
});

describe('label fitting and hierarchy measureText budget', () => {
  it('handles ASCII fast paths and non-ASCII graphemes identically with minimal measureText calls', () => {
    let calls = 0;
    const measure = (text: string) => {
      calls++;
      return [...text].length * 6;
    };

    calls = 0;
    expect(fitLabel('a_very_long_ascii_operation_identifier', 12, measure, 4)).toBe('');
    // Full-string check + single minimumPrefix check => 2 calls (no binary search).
    expect(calls).toBe(2);

    calls = 0;
    expect(fitLabel('👩🏽‍💻工作负载分析', 18, measure, 2)).toBe('');
    expect(calls).toBe(2);

    calls = 0;
    const fittedAscii = fitLabel('query_executor_worker_thread_01', 66, measure, 4);
    expect(fittedAscii).toBe('query_exec…');
    expect(calls).toBeLessThanOrEqual(7);

    expect(fitLabel('中文測試檢索序列', 30, measure)).toBe('中文測試…');
    expect(fitLabel('e\u0301clair_service', 30, measure, 3)).toBe('e\u0301cl…');
  });

  it('hoists ellipsis checks, skips fitLabel on narrow spans, and keeps short proportional labels narrower than ellipsis', () => {
    const doc = {
      version: 1,
      kind: 'trace' as const,
      spans: [
        { id: 'root', name: 'RootSpan', startTimeNs: '0', endTimeNs: '10000' },
        ...Array.from({ length: 100 }, (_, i) => ({
          id: `tiny-${i}`,
          parentId: 'root',
          name: `narrow_span_operation_${i}`,
          startTimeNs: String(i * 100),
          endTimeNs: String(i * 100 + 2)
        }))
      ]
    };
    const view = createTraceView(compileTrace(doc));
    let calls = 0;
    const measure = (text: string) => {
      calls++;
      return text.length * 6;
    };
    const scene = layoutHierarchy(view, 600, 200, measure);
    expect(scene.marks.some((mark) => mark.kind === 'text' && mark.text === 'RootSpan')).toBe(true);
    // 100 narrow spans (< 16px wide) must not trigger O(100 * log L) fitLabel probes.
    expect(calls).toBeLessThan(40);

    // Proportional font: 'I' and '1' (width 3) are narrower than '…' (width 9).
    // With spanWidth = 22 (rect x=12..588 => width 576; 22/576 of 1000 => ~38.2),
    // available = spanWidth - 16 = 6, so 3 <= 6 < 9: 'I' and '1' must still render in full.
    const propDoc = {
      version: 1,
      kind: 'trace' as const,
      spans: [
        { id: 'root', name: 'RootSpan', startTimeNs: '0', endTimeNs: '1000' },
        { id: 'narrow-i', parentId: 'root', name: 'I', startTimeNs: '0', endTimeNs: '38' },
        { id: 'narrow-1', parentId: 'root', name: '1', startTimeNs: '100', endTimeNs: '138' },
        {
          id: 'narrow-long',
          parentId: 'root',
          name: 'long_operation_name',
          startTimeNs: '200',
          endTimeNs: '238'
        }
      ]
    };
    const propView = createTraceView(compileTrace(propDoc));
    let propCalls = 0;
    const propMeasure = (text: string) => {
      propCalls++;
      if (text === '…') return 9;
      if (text === 'I' || text === '1') return 3;
      return text.length * 7;
    };
    const propScene = layoutHierarchy(propView, 600, 200, propMeasure);
    const texts = propScene.marks
      .filter((m): m is Extract<SceneMark, { kind: 'text' }> => m.kind === 'text')
      .map((m) => m.text);
    expect(texts).toContain('I');
    expect(texts).toContain('1');
    expect(texts).not.toContain('long_operation_name');
    expect(propCalls).toBeLessThan(20);
  });
});

describe('SceneHitIndex integer grid keys, bounds guards, and mark kinds', () => {
  function makeScene(
    marks: SceneMark[],
    overrides: Partial<ChartScene<{ id: string }>> = {}
  ): ChartScene<{ id: string }> {
    const interactions = [...new Set(marks.flatMap((mark) => (mark.key ? [mark.key] : [])))].map(
      (key) => ({
        key,
        sources: [{ id: key }],
        tooltip: { rows: [] },
        anchor: { x: 0, y: 0 },
        points: []
      })
    );
    return {
      width: 1024,
      height: 768,
      rect: { x: 0, y: 0, width: 1024, height: 768 },
      marks,
      hitMode: 'item',
      emphasis: 'point',
      xTicks: [],
      yTicks: [],
      interactions,
      interactionByKey: new Map(interactions.map((item) => [item.key, item])),
      ariaLabel: 'Point test',
      ...overrides
    };
  }

  it('indexes across 64px cell boundaries and preserves paint order in pointHits', () => {
    const scene = makeScene([
      { kind: 'circle', key: 'a', x: 640, y: 512, radius: 6, fill: '#111' },
      { kind: 'circle', key: 'b', x: 643, y: 512, radius: 6, fill: '#222' },
      { kind: 'circle', key: 'c', x: 640, y: 512, radius: 0, fill: '#333' },
      { kind: 'circle', key: 'far', x: 960, y: 700, radius: 5, fill: '#444' }
    ]);
    const index = new SceneHitIndex(scene);
    expect(index.hit({ x: 641, y: 512 })?.key).toBe('b');
    expect(index.pointHits({ x: 641, y: 512 }).map((item) => item.key)).toEqual(['a', 'b']);
    expect(index.pointHits({ x: 960, y: 700 }).map((item) => item.key)).toEqual(['far']);
    expect(index.pointHits({ x: 20, y: 20 })).toEqual([]);
  });

  it('rejects NaN, non-finite, negative, and out-of-bounds pointer coordinates even without clipRect/rect', () => {
    const scene = makeScene(
      [{ kind: 'rect', key: 'origin', x: 0, y: 0, width: 40, height: 40, fill: '#111' }],
      {
        rect: undefined,
        clipRect: undefined,
        emphasis: undefined
      }
    );
    const index = new SceneHitIndex(scene);
    expect(index.hit({ x: 10, y: 10 })?.key).toBe('origin');
    expect(index.hit({ x: Number.NaN, y: 10 })).toBeNull();
    expect(index.hit({ x: 10, y: Number.NaN })).toBeNull();
    expect(index.hit({ x: Number.POSITIVE_INFINITY, y: 10 })).toBeNull();
    expect(index.hit({ x: -1, y: 10 })).toBeNull();
    expect(index.hit({ x: 10, y: -0.01 })).toBeNull();
    expect(index.hit({ x: 1025, y: 10 })).toBeNull();

    const pointScene = makeScene(
      [{ kind: 'circle', key: 'p0', x: 0, y: 0, radius: 8, fill: '#111' }],
      { rect: undefined, clipRect: undefined }
    );
    const pointIndex = new SceneHitIndex(pointScene);
    expect(pointIndex.pointHits({ x: Number.NaN, y: 0 })).toEqual([]);
    expect(pointIndex.pointHits({ x: -1, y: 0 })).toEqual([]);
  });

  it('hits rect marks (skipping fill:none and zero-size) and path marks via pathHit', () => {
    const scene = makeScene(
      [
        { kind: 'rect', key: 'r1', x: 20, y: 20, width: 60, height: 30, fill: '#111' },
        { kind: 'rect', key: 'r-none', x: 20, y: 20, width: 60, height: 30, fill: 'none' },
        { kind: 'rect', key: 'r-zero', x: 20, y: 20, width: 0, height: 30, fill: '#222' },
        { kind: 'path', key: 'p1', d: 'M100 100 L150 150', fill: 'none', stroke: '#333' }
      ],
      { emphasis: undefined }
    );
    const index = new SceneHitIndex(scene);
    expect(index.hit({ x: 40, y: 30 })?.key).toBe('r1');
    expect(index.hit({ x: 120, y: 120 }, (mark, p) => mark.key === 'p1' && p.x === 120)?.key).toBe(
      'p1'
    );
    expect(index.hit({ x: 120, y: 120 }, () => false)).toBeNull();
  });
});

describe('hierarchyPadding, compiled interactive flag, and family layouts', () => {
  it('computes consistent hierarchy padding and viewport heights across all AxisModes', () => {
    expect(DEFAULT_ROW_HEIGHT).toBe(24);
    const trace = createTraceView(
      compileTrace({
        version: 1,
        kind: 'trace',
        spans: [{ id: 'a', name: 'span', startTimeNs: '0', endTimeNs: '100' }]
      })
    );
    expect(trace.interactive).toBe(true);
    const nonInteractive = createProfileView(
      compileProfile({
        version: 1,
        kind: 'profile',
        unit: 'samples',
        options: { interactive: false },
        frames: [{ id: 'a', name: 'fn', selfWeight: '10' }]
      })
    );
    expect(nonInteractive.interactive).toBe(false);

    for (const axes of ['full', 'minimal', 'none'] as const) {
      const padding = hierarchyPadding(axes);
      const scene = layoutHierarchy(trace, 400, 240, (t) => t.length * 6, undefined, axes);
      expect(scene.rect).toEqual({
        x: padding.left,
        y: padding.top,
        width: 400 - padding.left - padding.right,
        height: hierarchyViewportHeight(240, axes)
      });
    }
  });

  it('derives CompiledChart.interactive and scales scatter clipRect + miniature category layouts', () => {
    const scatterDoc: ChartDocumentInput = {
      version: 1,
      data: {
        fields: [
          { name: 'x', data_type: 'number' },
          { name: 'y', data_type: 'number' },
          { name: 'sz', data_type: 'number' }
        ],
        rows: [
          ['1', '2', '10'],
          ['5', '8', '40']
        ]
      },
      spec: { visualization: 'scatter', encoding: { x: 'x', y: 'y', size: 'sz' } }
    };
    const compiledScatter = compileChart(scatterDoc);
    expect(compiledScatter.interactive).toBe(true);
    const wide = layoutChart(compiledScatter, new Set(), 640, 300, (t) => t.length * 6);
    expect(wide.clipRect).toEqual({
      x: wide.rect!.x - (20 + pointPinnedGrowth),
      y: wide.rect!.y - (20 + pointPinnedGrowth),
      width: wide.rect!.width + (20 + pointPinnedGrowth) * 2,
      height: wide.rect!.height + (20 + pointPinnedGrowth) * 2
    });
    const narrow = layoutChart(compiledScatter, new Set(), 360, 200, (t) => t.length * 6);
    expect(narrow.clipRect).toEqual({
      x: narrow.rect!.x - (14 + pointPinnedGrowth),
      y: narrow.rect!.y - (14 + pointPinnedGrowth),
      width: narrow.rect!.width + (14 + pointPinnedGrowth) * 2,
      height: narrow.rect!.height + (14 + pointPinnedGrowth) * 2
    });

    const axisSpark = compileAxis({
      version: 1,
      data: {
        fields: [
          { name: 'k', data_type: 'string' },
          { name: 'v', data_type: 'number' }
        ],
        rows: [['a', '10']]
      },
      spec: { visualization: 'line', encoding: { x: 'k', y: ['v'] } },
      options: { presentation: 'sparkline' }
    });
    expect(axisSpark.interactive).toBe(false);

    const topList = compileChart({
      version: 1,
      data: {
        fields: [
          { name: 'k', data_type: 'string' },
          { name: 'v', data_type: 'number' }
        ],
        rows: [
          ['a', '10'],
          ['b', '20']
        ]
      },
      spec: { visualization: 'top-list', encoding: { category: 'k', value: 'v' } }
    });
    const miniatureTopList = layoutChart(topList, new Set(), 200, 40, (t) => t.length * 6, 'none');
    expect(miniatureTopList.rect).toEqual({ x: 1, y: 1, width: 198, height: 38 });
    expect(miniatureTopList.marks.some((mark) => mark.kind === 'text')).toBe(false);
  });
});
