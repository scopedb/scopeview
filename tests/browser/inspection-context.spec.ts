import { test, expect } from '@playwright/test';
import type { InspectionContext, ProfileInspectionContext, ChartScene } from '../../src/index.js';
import type { ChartView } from '../../src/headless.js';
import type { ScopeChartElement, ScopeTraceElement, ScopeFlameElement } from '../../src/element.js';
import type { HierarchyInspectionDetail } from '../../src/elements/hierarchy-element.js';
import trace from '../../examples/documents/trace.json' with { type: 'json' };
import profile from '../../examples/documents/profile.json' with { type: 'json' };
import { settleRendering } from './scene.js';

const metric = {
  version: 1,
  data: {
    fields: [
      { name: 'time', data_type: 'timestamp' },
      { name: 'value', data_type: 'number' },
      { name: 'series', data_type: 'string' }
    ],
    rows: [
      ['2026-10-27T00:00:00.123456789Z', '9007199254740993', 'peak'],
      ['2026-10-27T00:00:00.123456789Z', '0', 'zero'],
      ['2026-10-27T00:00:00.123456789Z', null, 'missing'],
      ['2026-10-27T00:01:00Z', '9007199254740992', 'peak']
    ]
  },
  spec: { visualization: 'line', encoding: { x: 'time', y: ['value'], series: 'series' } }
};

declare global {
  interface Window {
    inspectionFixture: {
      views: Record<string, ChartView>;
      inspected: Record<string, InspectionContext | null>;
      selected: Record<string, InspectionContext | null>;
      keys: Record<string, string | null>;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/fixtures/blank.html');
  await page.evaluate(
    async (documents) => {
      const entry = '/src/headless.ts',
        interactions = '/src/interactions.ts';
      const { createVisualization } = await import(entry);
      const { enableInteractions } = await import(interactions);
      const fixture: Window['inspectionFixture'] = {
        views: {},
        inspected: {},
        selected: {},
        keys: {}
      };
      window.inspectionFixture = fixture;
      for (const [id, source] of Object.entries(documents)) {
        const host = document.createElement('div');
        host.id = id;
        host.style.cssText = 'width:600px;--scope-chart-height:200px';
        document.body.append(host);
        fixture.views[id] = createVisualization(host, source, {
          tooltip: false,
          onInspect: (target: { key: string } | null, context: InspectionContext | null) => {
            fixture.keys[id] = target?.key ?? null;
            fixture.inspected[id] = context;
          },
          onSelect: (_target: unknown, context: InspectionContext | null) => {
            fixture.selected[id] = context;
          }
        });
        enableInteractions(fixture.views[id]);
      }
    },
    { metric, trace, profile }
  );
  await expect(page.locator('.scopeview-view[data-state=ready]')).toHaveCount(3);
});

test('inspect callbacks track series within the same target while selection keeps its context', async ({
  page
}) => {
  const positions = await page.locator('#metric .scopeview-view').evaluate(async (node, source) => {
    const entry = '/src/index.ts';
    const { compileChart, layoutChart } = await import(entry);
    const canvas = node.shadowRoot!.querySelector('.canvas')!;
    const bounds = canvas.getBoundingClientRect();
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = `11px ${getComputedStyle(canvas).fontFamily}`;
    const scene: ChartScene = layoutChart(
      compileChart(source),
      new Set(),
      bounds.width,
      bounds.height,
      (text: string) => measure.measureText(text).width,
      'minimal'
    );
    return scene.interactions[0].points.map((point: { x: number; y: number; series?: string }) => ({
      x: point.x + bounds.x,
      y: point.y + bounds.y,
      series: point.series
    }));
  }, metric);
  const peak = positions.find((point) => point.series === 'peak')!;
  const zero = positions.find((point) => point.series === 'zero')!;
  await page.mouse.move(peak.x, peak.y);
  const first = await page.evaluate(() => window.inspectionFixture.inspected.metric);
  expect(first).toMatchObject({
    kind: 'metric',
    series: 'peak',
    rowIndices: [0, 1, 2],
    rows: metric.data.rows.slice(0, 3)
  });
  expect(first?.key).toBe(await page.evaluate(() => window.inspectionFixture.keys.metric));
  await page.mouse.click(peak.x, peak.y);
  expect(await page.evaluate(() => window.inspectionFixture.selected.metric)).toEqual(first);
  await page.mouse.move(zero.x, zero.y);
  expect(await page.evaluate(() => window.inspectionFixture.inspected.metric)).toMatchObject({
    key: first!.key,
    snapshotId: first!.snapshotId,
    series: 'zero'
  });
  expect(await page.evaluate(() => window.inspectionFixture.selected.metric)).toEqual(first);
  await expect(page.locator('#metric .tooltip')).toBeHidden();
  await page.mouse.move(1, 1);
  expect(await page.evaluate(() => window.inspectionFixture.inspected.metric)).toBeNull();
  await page.locator('#metric .canvas').press('Escape');
  expect(await page.evaluate(() => window.inspectionFixture.selected.metric)).toBeNull();
});

for (const kind of ['trace', 'profile']) {
  test(`${kind} callbacks include exact hierarchy context and zero values`, async ({ page }) => {
    const canvas = page.locator(`#${kind} .canvas`);
    await canvas.press('Home');
    await canvas.press('ArrowRight');
    const context = await page.evaluate((kind) => window.inspectionFixture.inspected[kind], kind);
    expect(context).toMatchObject(
      kind === 'trace'
        ? {
            kind,
            key: 'trace:query',
            span: trace.spans[1],
            ancestors: [trace.spans[0]],
            durationNs: '14000000',
            coverage: 'complete'
          }
        : {
            kind,
            key: 'profile:query',
            frame: profile.frames[1],
            ancestors: [profile.frames[0]],
            unit: 'samples',
            totalWeight: '9007199254740993',
            profileTotalWeight: '9007199254741014'
          }
    );
    await canvas.press('Enter');
    expect(await page.evaluate((kind) => window.inspectionFixture.selected[kind], kind)).toEqual(
      context
    );
    await canvas.press('End');
    expect(
      await page.evaluate((kind) => window.inspectionFixture.inspected[kind], kind)
    ).toMatchObject({
      key: `${kind}:zero`,
      ...(kind === 'trace' ? { durationNs: '0' } : { totalWeight: '0' })
    });
  });
}

test('new snapshots replace callback context while layout and failed updates preserve identity', async ({
  page
}) => {
  const canvas = page.locator('#metric .canvas');
  await canvas.press('Home');
  await canvas.press('Enter');
  const previous = await page.evaluate(() => window.inspectionFixture.selected.metric);
  await page.evaluate(() => {
    window.inspectionFixture.views.metric.theme = 'dark';
  });
  await settleRendering(page);
  expect((await page.evaluate(() => window.inspectionFixture.selected.metric))?.snapshotId).toBe(
    previous?.snapshotId
  );
  await page.evaluate((source) => {
    source.data.rows[0][1] = '9007199254740995';
    window.inspectionFixture.views.metric.update(source);
  }, metric);
  await settleRendering(page);
  const next = await page.evaluate(() => window.inspectionFixture.selected.metric);
  expect(next?.key).toBe(previous?.key);
  expect(next?.snapshotId).not.toBe(previous?.snapshotId);
  expect(next).toMatchObject({
    kind: 'metric',
    rows: [
      ['2026-10-27T00:00:00.123456789Z', '9007199254740995', 'peak'],
      metric.data.rows[1],
      metric.data.rows[2]
    ]
  });
  await page.evaluate(() => {
    try {
      window.inspectionFixture.views.metric.update({ version: 99 });
    } catch {
      /* Previous snapshot remains valid. */
    }
  });
  expect(await page.evaluate(() => window.inspectionFixture.selected.metric)).toEqual(next);
});

test('component events expose the same context contract and clear it on dismissal', async ({
  page
}) => {
  await page.evaluate(
    async (documents) => {
      const entry = '/src/register.ts';
      await import(entry);
      for (const [id, source] of Object.entries(documents)) {
        const chart = document.createElement(
          id === 'metric' ? 'scope-chart' : id === 'trace' ? 'scope-trace' : 'scope-flame'
        );
        chart.id = `component-${id}`;
        chart.addEventListener('scope-inspect', (event) => {
          const detail = (event as CustomEvent<{ context: InspectionContext | null }>).detail;
          window.inspectionFixture.inspected[id] = detail.context;
        });
        chart.addEventListener('scope-select', (event) => {
          window.inspectionFixture.selected[id] = (
            event as CustomEvent<{ context: InspectionContext | null }>
          ).detail.context;
        });
        document.body.append(chart);
        (chart as ScopeChartElement | ScopeTraceElement | ScopeFlameElement).document = source;
      }
    },
    { metric, trace, profile }
  );
  for (const id of ['metric', 'trace', 'profile']) {
    await expect(page.locator(`#component-${id}`)).toHaveAttribute('data-state', 'ready');
    const input = page.locator(`#component-${id} ${id === 'metric' ? '.viewport' : '.canvas'}`);
    await input.press('Home');
    const context = await page.evaluate((id) => window.inspectionFixture.inspected[id], id);
    expect(context?.kind).toBe(id);
    expect(context?.snapshotId).toBeTruthy();
    await input.press('Enter');
    expect(await page.evaluate((id) => window.inspectionFixture.selected[id], id)).toEqual(context);
    await input.press('Escape');
    expect(await page.evaluate((id) => window.inspectionFixture.inspected[id], id)).toBeNull();
    expect(await page.evaluate((id) => window.inspectionFixture.selected[id], id)).toBeNull();
  }
});

test('headless callbacks defer deep source copies and retain their original snapshot', async ({
  page
}) => {
  const result = await page.evaluate(async () => {
    const entry = '/src/flame.ts',
      interactions = '/src/interactions.ts';
    const { createFlame } = await import(entry);
    const { enableInteractions } = await import(interactions);
    const host = document.createElement('div');
    host.style.cssText = 'width:600px;--scope-chart-height:200px';
    document.body.append(host);
    const count = 10_000;
    const retained: ProfileInspectionContext[] = [];
    const view = createFlame(
      host,
      {
        version: 1,
        kind: 'profile',
        unit: 'samples',
        frames: Array.from({ length: count }, (_, index) => ({
          id: `f${index}`,
          name: `Frame ${index}`,
          selfWeight: '1',
          ...(index ? { parentId: `f${index - 1}` } : {})
        }))
      },
      {
        tooltip: false,
        onInspect: (_target: unknown, context: ProfileInspectionContext | null) => {
          if (context) retained.push(context);
        },
        onSelect: (_target: unknown, context: ProfileInspectionContext | null) => {
          if (context) retained.push(context);
        }
      }
    );
    enableInteractions(view);
    const settle = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await settle();
    const clone = window.structuredClone;
    let copies = 0;
    window.structuredClone = (value, options) => {
      const candidate = value as { kind?: string } | null;
      if (candidate?.kind === 'profile' && Object.hasOwn(candidate, 'ancestors')) copies++;
      return clone(value, options);
    };
    try {
      const input = host.querySelector('.scopeview-view')!.shadowRoot!.querySelector('.canvas')!;
      for (const key of ['End', 'Enter', 'ArrowLeft', 'End'])
        input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      const unusedCopies = copies;
      const context = retained[0];
      const snapshotId = context.snapshotId;
      view.update({
        version: 1,
        kind: 'profile',
        unit: 'bytes',
        frames: [{ id: 'replacement', name: 'Replacement', selfWeight: '2' }]
      });
      await settle();
      Object.freeze(context);
      const ancestors = context.ancestors;
      const serialized = structuredClone(context);
      return {
        callbacks: retained.length,
        unusedCopies,
        copies,
        key: context.key,
        snapshotId: serialized.snapshotId === snapshotId,
        unit: serialized.unit,
        ancestors: ancestors.length,
        memoized: ancestors === context.ancestors,
        serializedAncestors: serialized.ancestors.length
      };
    } finally {
      window.structuredClone = clone;
      view.dispose();
    }
  });
  expect(result.callbacks).toBeGreaterThanOrEqual(4);
  expect(result).toMatchObject({
    unusedCopies: 0,
    // One source copy, plus the consumer's explicit structuredClone(context).
    copies: 2,
    key: 'profile:f9999',
    snapshotId: true,
    unit: 'samples',
    ancestors: 9999,
    memoized: true,
    serializedAncestors: 9999
  });
});

for (const kind of ['trace', 'profile'] as const) {
  test(`${kind} events retain the painted snapshot and refresh a pin when replacement paints`, async ({
    page
  }) => {
    const result = await page.evaluate(async (kind) => {
      const entry = '/src/register.ts';
      await import(entry);
      const chart = document.createElement(kind === 'trace' ? 'scope-trace' : 'scope-flame');
      chart.configure({ tooltip: false, inspector: false });
      document.body.append(chart);
      const documentFor = (value: string) =>
        kind === 'trace'
          ? {
              version: 1,
              kind,
              spans: [{ id: 'a', name: 'A', startTimeNs: '0', endTimeNs: value }]
            }
          : {
              version: 1,
              kind,
              unit: 'samples',
              frames: [{ id: 'a', name: 'A', selfWeight: value }]
            };
      chart.document = documentFor('100');
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const events: { type: string; detail: HierarchyInspectionDetail }[] = [];
      for (const type of ['scope-inspect', 'scope-select'])
        chart.addEventListener(type, (event) => {
          events.push({ type, detail: (event as CustomEvent<HierarchyInspectionDetail>).detail });
        });
      chart.focusNode('a');
      const previous = events.at(-1)!.detail.context!;
      events.length = 0;
      chart.document = documentFor('200');
      const canvas = chart.shadowRoot!.querySelector('.canvas')!;
      for (const key of ['Home', 'Enter'])
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      const beforePaint = events.slice();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const afterPaint = events.slice(beforePaint.length);
      events.length = 0;
      chart.refresh();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      // Read retained events only after the replacement has painted.
      return {
        previous,
        beforePaint,
        afterPaint,
        repaintEvents: events.length,
        pinned: chart.viewState.pinnedKey
      };
    }, kind);
    expect(result.beforePaint.length).toBeGreaterThan(0);
    for (const { detail } of result.beforePaint) {
      expect(detail.context).toMatchObject({
        key: `${kind}:a`,
        snapshotId: result.previous.snapshotId
      });
      expect(detail.context).toMatchObject(
        kind === 'trace'
          ? { span: { endTimeNs: '100' }, durationNs: '100' }
          : { frame: { selfWeight: '100' }, totalWeight: '100' }
      );
    }
    for (const type of ['scope-inspect', 'scope-select']) {
      const detail = result.afterPaint.find((event) => event.type === type)?.detail;
      expect(detail?.context?.snapshotId).not.toBe(result.previous.snapshotId);
      expect(detail?.context).toMatchObject(
        kind === 'trace'
          ? { key: 'trace:a', span: { endTimeNs: '200' }, durationNs: '200' }
          : { key: 'profile:a', frame: { selfWeight: '200' }, totalWeight: '200' }
      );
    }
    expect(result.pinned).toBe(`${kind}:a`);
    expect(result.repaintEvents).toBe(0);
  });
}

test('unused deep profile context is not cloned and retained events materialize once', async ({
  page
}) => {
  const result = await page.evaluate(async () => {
    const entry = '/src/register.ts';
    await import(entry);
    const chart = document.createElement('scope-flame');
    chart.style.cssText = 'width:600px;--scope-chart-height:200px';
    chart.configure({ tooltip: false, inspector: false });
    document.body.append(chart);
    const count = 10_000;
    chart.document = {
      version: 1,
      kind: 'profile',
      unit: 'samples',
      frames: Array.from({ length: count }, (_, index) => ({
        id: `f${index}`,
        name: `Frame ${index}`,
        selfWeight: '1',
        ...(index ? { parentId: `f${index - 1}` } : {})
      }))
    };
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const clone = window.structuredClone;
    let copies = 0;
    window.structuredClone = (value, options) => {
      const candidate = value as { kind?: unknown; ancestors?: unknown } | null;
      if (candidate?.kind === 'profile' && Array.isArray(candidate.ancestors)) copies++;
      return clone(value, options);
    };
    try {
      chart.focusNode(`f${count - 1}`);
      const target = chart.scene!.interactionByKey.get(`profile:f${count - 1}`)!;
      const plot = chart.shadowRoot!.querySelector('.plot')!;
      const bounds = plot.getBoundingClientRect();
      const move = () =>
        plot.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            clientX: bounds.x + target.anchor.x,
            clientY: bounds.y + target.anchor.y
          })
        );
      for (let i = 0; i < 5; i++) move();
      const unobservedCopies = copies;
      const retained: HierarchyInspectionDetail[] = [];
      chart.addEventListener('scope-inspect', (event) => retained.push(event.detail));
      move();
      move();
      const unreadCopies = copies;
      chart.document = {
        version: 1,
        kind: 'profile',
        unit: 'bytes',
        frames: [{ id: 'replacement', name: 'Replacement', selfWeight: '2' }]
      };
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      Object.freeze(retained[0]);
      const context = retained[0].context!;
      const sameObject = context === retained[0].context;
      const serialized = JSON.parse(JSON.stringify(retained[0]));
      const copiesAfterReads = copies;
      context.title = 'Local mutation';
      const independent = retained[1].context!;
      return {
        unobservedCopies,
        unreadCopies,
        copiesAfterReads,
        sameObject,
        key: context.key,
        kind: context.kind,
        ancestors: 'ancestors' in context ? context.ancestors.length : 0,
        unit: context.kind === 'profile' ? context.unit : null,
        serializedKey: serialized.context.key,
        isolated: independent.title === undefined && independent !== context
      };
    } finally {
      window.structuredClone = clone;
    }
  });
  expect(result).toEqual({
    unobservedCopies: 0,
    unreadCopies: 0,
    copiesAfterReads: 1,
    sameObject: true,
    key: 'profile:f9999',
    kind: 'profile',
    ancestors: 9999,
    unit: 'samples',
    serializedKey: 'profile:f9999',
    isolated: true
  });
});
