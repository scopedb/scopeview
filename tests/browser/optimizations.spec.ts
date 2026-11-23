import { expect, test } from '@playwright/test';
import type { ScopeChartElement, ScopeFlameElement, ScopeTraceElement } from '../../src/element.js';
import type { ChartDocumentInput, ChartScene } from '../../src/index.js';
import type { ChartRuntime } from '../../src/runtime.js';
import { moveToMark, pixel, settleRendering } from './scene.js';

function denseScatterDocument(count: number): ChartDocumentInput {
  const rows: [string, string, string][] = [
    ['5', '5', 'target'],
    ['95', '95', 'target'],
    ['50', '95', 'observer']
  ];
  for (let i = rows.length; i < count; i++) {
    const x = 15 + ((i * 17) % 65);
    const y = 12 + ((i * 29) % 58);
    rows.push([String(x), String(y), i % 2 === 0 ? 'alpha' : 'beta']);
  }
  return {
    version: 1,
    data: {
      fields: [
        { name: 'latency', data_type: 'number' },
        { name: 'throughput', data_type: 'number' },
        { name: 'service', data_type: 'string' }
      ],
      rows
    },
    spec: {
      visualization: 'scatter',
      encoding: { x: 'latency', y: 'throughput', color: 'service' }
    }
  };
}

function denseTimeLineDocument(count: number): ChartDocumentInput {
  const start = Date.parse('2026-09-29T00:00:00Z');
  const rows: [string, string][] = [];
  for (let i = 0; i < count; i++) {
    const timestamp = new Date(start + i * 60_000).toISOString();
    const value = String((10 + Math.sin(i * 0.2) * 4).toFixed(3));
    rows.push([timestamp, value]);
  }
  return {
    version: 1,
    data: {
      fields: [
        { name: 'ts', data_type: 'timestamp' },
        { name: 'rate', data_type: 'number' }
      ],
      rows
    },
    spec: { visualization: 'line', encoding: { x: 'ts', y: ['rate'] } }
  };
}

function hierarchyDoc(kind: 'trace' | 'profile', count: number) {
  if (kind === 'trace') {
    const spans = Array.from({ length: count }, (_, i) => ({
      id: `span-${i}`,
      ...(i > 0 ? { parentId: `span-${Math.floor((i - 1) / 3)}` } : {}),
      name: `operation-${i}`,
      startTimeNs: String(1_000_000 + i * 10_000),
      endTimeNs: String(1_000_000 + (i + 2) * 20_000)
    }));
    return { version: 1, kind: 'trace' as const, spans };
  }
  const frames = Array.from({ length: count }, (_, i) => ({
    id: `frame-${i}`,
    ...(i > 0 ? { parentId: `frame-${i - 1}` } : {}),
    name: `fn_${i}`,
    selfWeight: i === 0 ? '20' : String(10 + i)
  }));
  return { version: 1, kind: 'profile' as const, unit: 'samples', frames };
}

test('dense scatter hover and pinned + hovered states reuse cached base surface and dim non-active points', async ({
  page
}) => {
  await page.goto('/tests/browser/fixtures/blank.html');
  const points = await page.evaluate(async (doc) => {
    const runtimeEntry = '/src/runtime.ts',
      coreEntry = '/src/index.ts',
      hostEntry = '/tests/browser/fixtures/host.ts';
    const { ChartRuntime } = (await import(runtimeEntry)) as typeof import('../../src/runtime.js');
    const { compileChart, layoutChart } = (await import(
      coreEntry
    )) as typeof import('../../src/index.js');
    const { createCanvasHost } = (await import(hostEntry)) as typeof import('./fixtures/host.js');
    const { canvas, decoration } = createCanvasHost({
      id: 'scatter-fixture',
      width: 480,
      height: 280
    });
    const compiled = compileChart(doc);
    const runtime = new ChartRuntime(canvas, decoration, {
      layout: (width, height, measure, hidden) =>
        layoutChart(compiled, hidden, width, height, measure, 'full')
    });
    (window as unknown as { scatterRuntime: ChartRuntime }).scatterRuntime = runtime;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    const bounds = canvas.getBoundingClientRect();
    const interactions = runtime.model!.interactions;
    return {
      frame: { x: bounds.x, y: bounds.y },
      first: { key: interactions[0].key, ...interactions[0].anchor },
      second: { key: interactions[1].key, ...interactions[1].anchor },
      observer: { key: interactions[2].key, ...interactions[2].anchor }
    };
  }, denseScatterDocument(520));

  await expect(page.locator('#scatter-fixture .plot-canvas')).toHaveAttribute(
    'data-paint-strategy',
    'cached'
  );
  await settleRendering(page);

  const before = await page.evaluate(
    () => (window as unknown as { scatterRuntime: ChartRuntime }).scatterRuntime.diagnostics
  );
  const observerBase = await pixel(page, '#scatter-fixture', points.observer.x, points.observer.y);
  const firstBase = await pixel(page, '#scatter-fixture', points.first.x, points.first.y);
  expect(observerBase[3]).toBeGreaterThan(0);

  await page.mouse.move(points.frame.x + points.first.x, points.frame.y + points.first.y);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { scatterRuntime: ChartRuntime }).scatterRuntime.session.active?.key
      )
    )
    .toBe(points.first.key);
  await settleRendering(page);

  const mid = await page.evaluate(
    () => (window as unknown as { scatterRuntime: ChartRuntime }).scatterRuntime.diagnostics
  );
  expect(mid.basePaints).toBe(before.basePaints);
  expect(mid.frames).toBeGreaterThan(before.frames);

  const observerDimmed = await pixel(
    page,
    '#scatter-fixture',
    points.observer.x,
    points.observer.y
  );
  expect(observerDimmed[3]).toBeGreaterThan(0);
  expect(observerDimmed[3]).toBeLessThan(observerBase[3]);

  // Pin first point, then hover second point (freeze mode): both pinned and hovered points
  // render crisp overlays over the dimmed cached base without triggering extra base paints.
  await page.mouse.click(points.frame.x + points.first.x, points.frame.y + points.first.y);
  await page.mouse.move(points.frame.x + points.second.x, points.frame.y + points.second.y);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (window as unknown as { scatterRuntime: ChartRuntime }).scatterRuntime.session;
        return { selected: s.selected?.key ?? null, hovered: s.hovered?.key ?? null };
      })
    )
    .toEqual({ selected: points.first.key, hovered: points.second.key });
  await settleRendering(page);

  const pinnedAndHovered = await page.evaluate(
    () => (window as unknown as { scatterRuntime: ChartRuntime }).scatterRuntime.diagnostics
  );
  expect(pinnedAndHovered.basePaints).toBe(before.basePaints);
  expect(pinnedAndHovered.frames).toBeGreaterThan(mid.frames);

  const firstWhileHoveredOther = await pixel(
    page,
    '#scatter-fixture',
    points.first.x,
    points.first.y
  );
  const secondWhileHovered = await pixel(
    page,
    '#scatter-fixture',
    points.second.x,
    points.second.y
  );
  const observerWhilePinnedHover = await pixel(
    page,
    '#scatter-fixture',
    points.observer.x,
    points.observer.y
  );
  expect(firstWhileHoveredOther[3]).toBeGreaterThanOrEqual(firstBase[3]);
  expect(secondWhileHovered[3]).toBeGreaterThan(0);
  expect(observerWhilePinnedHover[3]).toBeLessThan(observerBase[3]);
});

test('linkedHighlight cursor updates paint on ChartRuntime and scope-chart without relayout or base repaints', async ({
  page
}) => {
  await page.goto('/tests/browser/fixtures/blank.html');
  const setup = await page.evaluate(async (lineDoc) => {
    const runtimeEntry = '/src/runtime.ts',
      registerEntry = '/src/register.ts',
      hostEntry = '/tests/browser/fixtures/host.ts';
    const { ChartRuntime } = (await import(runtimeEntry)) as typeof import('../../src/runtime.js');
    await import(registerEntry);
    const { createCanvasHost } = (await import(hostEntry)) as typeof import('./fixtures/host.js');
    const { canvas, decoration } = createCanvasHost({
      id: 'linked-runtime',
      width: 360,
      height: 180
    });
    let layouts = 0;
    const marks = Array.from({ length: 520 }, (_, i) => ({
      kind: 'rect' as const,
      key: `bar:${i}`,
      x: 40 + (i / 520) * 300,
      y: 120,
      width: 0.5,
      height: 30,
      fill: 'var(--color-chart-series-1)'
    }));
    const interactions = marks.map((mark) => ({
      key: mark.key,
      sources: [mark.key],
      anchor: { x: mark.x, y: mark.y },
      points: [],
      tooltip: { title: mark.key, rows: [{ label: 'v', value: '1' }] }
    }));
    const runtime = new ChartRuntime<string>(canvas, decoration, {
      layout(width, height): ChartScene<string> {
        layouts++;
        return {
          width,
          height,
          rect: { x: 40, y: 20, width: 300, height: 130 },
          hitMode: 'axis',
          xTicks: [],
          yTicks: [],
          ariaLabel: 'Linked runtime fixture',
          marks,
          interactions,
          interactionByKey: new Map(interactions.map((item) => [item.key, item]))
        };
      }
    });

    const chart = document.createElement('scope-chart') as ScopeChartElement;
    chart.id = 'linked-element';
    chart.style.cssText = 'display:block;width:640px;--scope-chart-height:220px';
    document.body.append(chart);
    chart.document = lineDoc;

    (
      window as unknown as {
        linkedFixture: {
          runtime: ChartRuntime<string>;
          getLayouts: () => number;
          chart: ScopeChartElement;
        };
      }
    ).linkedFixture = { runtime, getLayouts: () => layouts, chart };

    return {
      rect: { x: 40, y: 20, width: 300, height: 130 }
    };
  }, denseTimeLineDocument(750));

  await expect(page.locator('#linked-runtime .plot-canvas')).toHaveAttribute(
    'data-paint-strategy',
    'cached'
  );
  await expect(page.locator('#linked-element')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#linked-element .plot-canvas')).toHaveAttribute(
    'data-paint-strategy',
    'cached'
  );
  await settleRendering(page);

  const x1 = setup.rect.x + 0.25 * setup.rect.width;
  const x2 = setup.rect.x + 0.75 * setup.rect.width;
  const runtimeBefore = await page.evaluate(() => {
    const f = (
      window as unknown as {
        linkedFixture: { runtime: ChartRuntime<string>; getLayouts: () => number };
      }
    ).linkedFixture;
    return { layouts: f.getLayouts(), diagnostics: f.runtime.diagnostics };
  });

  const stripPainted = async (host: string, x: number, yStart: number, yEnd: number) => {
    for (let y = yStart; y <= yEnd; y++) {
      const rgba = await pixel(page, host, x, y);
      if (rgba[3] > 0) return true;
    }
    return false;
  };
  expect(await stripPainted('#linked-runtime', x1, 24, 34)).toBe(false);

  await page.evaluate(() => {
    (
      window as unknown as { linkedFixture: { runtime: ChartRuntime<string> } }
    ).linkedFixture.runtime.linkedHighlight = { inspectionKey: null, cursor: 0.25 };
  });
  await settleRendering(page);
  expect(await stripPainted('#linked-runtime', x1, 24, 34)).toBe(true);
  expect(await stripPainted('#linked-runtime', x2, 24, 34)).toBe(false);

  const runtimeMid = await page.evaluate(() => {
    const f = (
      window as unknown as {
        linkedFixture: { runtime: ChartRuntime<string>; getLayouts: () => number };
      }
    ).linkedFixture;
    return { layouts: f.getLayouts(), diagnostics: f.runtime.diagnostics };
  });
  expect(runtimeMid.layouts).toBe(runtimeBefore.layouts);
  expect(runtimeMid.diagnostics.basePaints).toBe(runtimeBefore.diagnostics.basePaints);
  expect(runtimeMid.diagnostics.frames).toBeGreaterThan(runtimeBefore.diagnostics.frames);

  await page.evaluate(() => {
    (
      window as unknown as { linkedFixture: { runtime: ChartRuntime<string> } }
    ).linkedFixture.runtime.linkedHighlight = { inspectionKey: null, cursor: 0.75 };
  });
  await settleRendering(page);
  expect(await stripPainted('#linked-runtime', x1, 24, 34)).toBe(false);
  expect(await stripPainted('#linked-runtime', x2, 24, 34)).toBe(true);

  const runtimeAfter = await page.evaluate(() => {
    const f = (
      window as unknown as {
        linkedFixture: { runtime: ChartRuntime<string>; getLayouts: () => number };
      }
    ).linkedFixture;
    return { layouts: f.getLayouts(), diagnostics: f.runtime.diagnostics };
  });
  expect(runtimeAfter.layouts).toBe(runtimeBefore.layouts);
  expect(runtimeAfter.diagnostics.basePaints).toBe(runtimeBefore.diagnostics.basePaints);
  expect(runtimeAfter.diagnostics.frames).toBeGreaterThan(runtimeMid.diagnostics.frames);

  const elementResult = await page.evaluate(async () => {
    const { chart } = (window as unknown as { linkedFixture: { chart: ScopeChartElement } })
      .linkedFixture;
    let measureCalls = 0;
    const origMeasure = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function (text) {
      measureCalls++;
      return origMeasure.call(this, text);
    };
    try {
      const canvas = chart.shadowRoot!.querySelector<HTMLCanvasElement>(
        'canvas[data-layer=marks]'
      )!;
      const beforeData = canvas.toDataURL();
      chart.linkedHighlight = { inspectionKey: null, cursor: 0.35 };
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      const midData = canvas.toDataURL();
      chart.linkedHighlight = { inspectionKey: null, cursor: 0.65 };
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      const afterData = canvas.toDataURL();
      return {
        measureCalls,
        changedFirst: midData !== beforeData,
        changedSecond: afterData !== midData
      };
    } finally {
      CanvasRenderingContext2D.prototype.measureText = origMeasure;
    }
  });
  expect(elementResult.measureCalls).toBe(0);
  expect(elementResult.changedFirst).toBe(true);
  expect(elementResult.changedSecond).toBe(true);
});

test('hierarchy configure({ axes }) aligns .tree-scroll top/bottom and auto-height with scene.rect', async ({
  page
}) => {
  await page.goto('/examples/families.html');
  await expect(
    page.locator('scope-trace[data-state=ready],scope-flame[data-state=ready]')
  ).toHaveCount(2);

  for (const [selector, kind] of [
    ['#trace', 'trace'],
    ['#flame', 'profile']
  ] as const) {
    const tallDoc = hierarchyDoc(kind, 20);
    await page.locator(selector).evaluate((node, doc) => {
      (node as ScopeTraceElement | ScopeFlameElement).document = doc;
    }, tallDoc);
    await expect(page.locator(selector)).toHaveAttribute('data-state', 'ready');

    for (const axes of ['full', 'minimal', 'none'] as const) {
      await page.locator(selector).evaluate((node, mode) => {
        (node as ScopeTraceElement | ScopeFlameElement).configure({ axes: mode });
      }, axes);
      await settleRendering(page);
      const railGeometry = await page.locator(selector).evaluate((node) => {
        const element = node as ScopeTraceElement | ScopeFlameElement;
        const scene = element.scene!;
        const rail = node.shadowRoot!.querySelector<HTMLElement>('.tree-scroll')!;
        const viewportRect = node.shadowRoot!.querySelector('.viewport')!.getBoundingClientRect();
        const railRect = rail.getBoundingClientRect();
        return {
          hidden: rail.hidden,
          topStyle: rail.style.top,
          bottomStyle: rail.style.bottom,
          expectedTop: `${scene.rect!.y}px`,
          expectedBottom: `${Math.max(0, scene.height - scene.rect!.y - scene.rect!.height)}px`,
          railTopDelta: Math.abs(railRect.top - viewportRect.top - scene.rect!.y),
          railHeightDelta: Math.abs(railRect.height - scene.rect!.height)
        };
      });
      expect(railGeometry.hidden).toBe(false);
      expect(railGeometry.topStyle).toBe(railGeometry.expectedTop);
      expect(railGeometry.bottomStyle).toBe(railGeometry.expectedBottom);
      expect(railGeometry.railTopDelta).toBeLessThanOrEqual(1);
      expect(railGeometry.railHeightDelta).toBeLessThanOrEqual(1);
    }

    const mediumDoc = hierarchyDoc(kind, 8);
    await page.locator(selector).evaluate((node, doc) => {
      (node as ScopeTraceElement | ScopeFlameElement).document = doc;
    }, mediumDoc);
    const heights: Record<string, number> = {};
    for (const axes of ['full', 'minimal', 'none'] as const) {
      await page.locator(selector).evaluate((node, mode) => {
        (node as ScopeTraceElement | ScopeFlameElement).configure({ axes: mode });
      }, axes);
      await settleRendering(page);
      const layout = await page.locator(selector).evaluate((node) => {
        const element = node as ScopeTraceElement | ScopeFlameElement;
        const viewport = node.shadowRoot!.querySelector<HTMLElement>('.viewport')!;
        return {
          contentHeight: parseFloat(
            viewport.style.getPropertyValue('--scope-chart-content-height')
          ),
          viewportHeight: parseFloat(getComputedStyle(viewport).height),
          sceneHeight: element.scene!.height,
          rectHeight: element.scene!.rect!.height
        };
      });
      expect(layout.viewportHeight).toBeCloseTo(layout.sceneHeight, 1);
      expect(layout.contentHeight).toBeGreaterThan(176);
      expect(layout.contentHeight).toBeLessThan(360);
      expect(layout.viewportHeight).toBeCloseTo(layout.contentHeight, 1);
      heights[axes] = layout.viewportHeight;
    }
    expect(heights.full).toBeGreaterThan(heights.minimal);
    expect(heights.minimal).toBeGreaterThan(heights.none);
  }
});

test('headless view honors --scope-chart-tooltip-width, monospace .tooltip-context, and dark-mode tooltip shadow', async ({
  page
}) => {
  const source: ChartDocumentInput = {
    version: 1,
    data: {
      fields: [
        { name: 'service', data_type: 'string' },
        { name: 'requests', data_type: 'number' }
      ],
      rows: [
        ['api', '120'],
        ['worker', '80']
      ]
    },
    spec: { visualization: 'bar', encoding: { x: 'service', y: ['requests'] } }
  };

  await page.goto('/tests/browser/fixtures/blank.html');
  await page.evaluate(async (doc) => {
    const entry = '/src/chart.ts';
    const { createChart } = (await import(entry)) as typeof import('../../src/chart.js');
    const host = document.createElement('div');
    host.id = 'headless-tooltip';
    host.style.cssText =
      'width:480px;--scope-chart-height:240px;--scope-chart-tooltip-width:248px;';
    document.body.append(host);
    (window as unknown as { tooltipChart: ReturnType<typeof createChart> }).tooltipChart =
      createChart(host, doc, { theme: 'light' });
  }, source);

  const view = page.locator('#headless-tooltip .scopeview-view');
  await expect(view).toHaveAttribute('data-state', 'ready');
  await view.locator('.canvas').press('Home');

  const tooltip = view.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveCSS('width', '248px');

  const lightStyles = await tooltip.evaluate((node) => ({
    contextFont: getComputedStyle(node.querySelector('.tooltip-context')!).fontFamily,
    boxShadow: getComputedStyle(node).boxShadow
  }));
  expect(lightStyles.contextFont.toLowerCase()).toMatch(/mono|consolas/);

  await page.evaluate(() => {
    (window as unknown as { tooltipChart: { theme: string } }).tooltipChart.theme = 'dark';
  });
  await settleRendering(page);

  const darkShadow = await tooltip.evaluate((node) => getComputedStyle(node).boxShadow);
  expect(darkShadow).not.toBe(lightStyles.boxShadow);
  const alphas = [
    ...darkShadow.matchAll(/rgba?\(\s*0\s*,\s*0\s*,\s*0(?:\s*,\s*([\d.]+))?\s*\)/g)
  ].map((m) => (m[1] === undefined ? 1 : Number(m[1])));
  expect(alphas.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...alphas)).toBeGreaterThanOrEqual(0.35);
});

test('docked scatter observation chooser aligns context, list, and pagination left edges with heading', async ({
  page
}) => {
  const overlapDoc: ChartDocumentInput = {
    version: 1,
    data: {
      fields: [
        { name: 'latency', data_type: 'number' },
        { name: 'throughput', data_type: 'number' },
        { name: 'service', data_type: 'string' }
      ],
      rows: Array.from({ length: 6 }, (_, i) => ['50', '50', `svc-${i}`])
    },
    spec: {
      visualization: 'scatter',
      encoding: { x: 'latency', y: 'throughput', color: 'service' }
    }
  };

  await page.goto('/tests/browser/fixtures/blank.html');
  await page.evaluate(async (doc) => {
    const registerEntry = '/src/register.ts';
    await import(registerEntry);
    const chart = document.createElement('scope-chart') as ScopeChartElement;
    chart.id = 'docked-observations';
    chart.style.cssText = 'display:block;width:480px;--scope-chart-height:240px;';
    document.body.append(chart);
    chart.document = doc;
  }, overlapDoc);

  const chart = page.locator('#docked-observations');
  await expect(chart).toHaveAttribute('data-state', 'ready');
  await settleRendering(page);

  await moveToMark(page, '#docked-observations', 0, true);
  await expect(chart.locator('.tooltip.docked')).toBeVisible();

  const alignment = await chart.evaluate((node) => {
    const tooltip = node.shadowRoot!.querySelector<HTMLElement>('.tooltip')!;
    const contentLeft = (el: Element) =>
      el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft);
    const heading = tooltip.querySelector('.tooltip-heading')!;
    const obsContext = tooltip.querySelector('.tooltip-observations > .tooltip-context')!;
    const obsItem = tooltip.querySelector('.tooltip-observation-list .tooltip-observation')!;
    const obsPagesButton = tooltip.querySelector('.tooltip-observation-pages button')!;
    return {
      docked: tooltip.classList.contains('docked'),
      hidden: tooltip.hidden,
      headingLeft: contentLeft(heading),
      obsContextLeft: obsContext.getBoundingClientRect().left,
      obsItemLeft: obsItem.getBoundingClientRect().left,
      obsPagesButtonLeft: obsPagesButton.getBoundingClientRect().left
    };
  });
  expect(alignment.hidden).toBe(false);
  expect(alignment.docked).toBe(true);
  expect(Math.abs(alignment.obsContextLeft - alignment.headingLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(alignment.obsItemLeft - alignment.headingLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(alignment.obsPagesButtonLeft - alignment.headingLeft)).toBeLessThanOrEqual(1);
});

test('big-number scales down cleanly at 320px via 12cqi without overflow while remaining 128px at fontSize 26 on standard widths', async ({
  page
}) => {
  const bigNumberDoc: ChartDocumentInput = {
    version: 1,
    data: {
      fields: [{ name: 'requests', data_type: 'number' }],
      rows: [['4200']]
    },
    spec: { visualization: 'big-number', encoding: { values: ['requests'] } }
  };

  await page.goto('/tests/browser/fixtures/blank.html');
  await page.evaluate(async (doc) => {
    const registerEntry = '/src/register.ts';
    await import(registerEntry);

    const standardHost = document.createElement('div');
    standardHost.style.width = '640px';
    const standardChart = document.createElement('scope-chart') as ScopeChartElement;
    standardChart.id = 'big-standard';
    standardChart.theme = { fontSize: 26 };
    standardChart.document = doc;
    standardHost.append(standardChart);
    document.body.append(standardHost);

    const narrowHost = document.createElement('div');
    narrowHost.style.width = '320px';
    const narrowChart = document.createElement('scope-chart') as ScopeChartElement;
    narrowChart.id = 'big-narrow';
    narrowChart.theme = { fontSize: 26 };
    narrowChart.document = doc;
    narrowHost.append(narrowChart);
    document.body.append(narrowHost);
  }, bigNumberDoc);

  await expect(page.locator('#big-standard')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#big-narrow')).toHaveAttribute('data-state', 'ready');

  const standardSize = await page
    .locator('#big-standard .metric-value')
    .evaluate((el) => getComputedStyle(el).fontSize);
  expect(standardSize).toBe('128px');

  const narrowMetrics = await page.locator('#big-narrow').evaluate((node) => {
    const metrics = node.shadowRoot!.querySelector<HTMLElement>('.metrics')!;
    const value = node.shadowRoot!.querySelector<HTMLElement>('.metric-value')!;
    const hostRect = node.getBoundingClientRect();
    const valueRect = value.getBoundingClientRect();
    return {
      fontSize: parseFloat(getComputedStyle(value).fontSize),
      scrollWidth: metrics.scrollWidth,
      clientWidth: metrics.clientWidth,
      hostRight: hostRect.right,
      valueRight: valueRect.right
    };
  });
  expect(narrowMetrics.fontSize).toBeGreaterThan(64);
  expect(narrowMetrics.fontSize).toBeLessThan(128);
  expect(narrowMetrics.scrollWidth).toBeLessThanOrEqual(narrowMetrics.clientWidth + 0.5);
  expect(narrowMetrics.valueRight).toBeLessThanOrEqual(narrowMetrics.hostRight + 0.5);
});
