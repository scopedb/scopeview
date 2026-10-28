import { test, expect } from '@playwright/test';
import type { ChartRuntime } from '../../src/runtime.js';
import type { ChartScene } from '../../src/index.js';
import { pixel, settleRendering } from './scene.js';

declare global {
  interface Window {
    canvasFixture: {
      runtime: ChartRuntime<{ spanId: string }>;
      layouts: number;
      renders: number;
      dense: boolean;
      reuseScene: boolean;
      fail: boolean;
      errors: number;
      densityQueries: MediaQueryList[];
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/fixtures/blank.html');
  await page.evaluate(async () => {
    const entry = '/src/runtime.ts';
    const { ChartRuntime } = await import(entry);
    const fixtureEntry = '/tests/browser/fixtures/host.ts',
      { createCanvasHost } = await import(fixtureEntry),
      { canvas, decoration } = createCanvasHost({ id: 'runtime-fixture', width: 300, height: 160 });
    const fixture = {
      runtime: null as unknown as ChartRuntime<{ spanId: string }>,
      layouts: 0,
      renders: 0,
      dense: false,
      reuseScene: false,
      fail: false,
      errors: 0,
      densityQueries: [] as MediaQueryList[]
    };
    window.canvasFixture = fixture;
    const nativeMatchMedia = window.matchMedia;
    window.matchMedia = (query) => {
      const result = nativeMatchMedia.call(window, query);
      fixture.densityQueries.push(result);
      return result;
    };
    fixture.runtime = new ChartRuntime(canvas, decoration, {
      layout(width: number, height: number, measure: (text: string) => number) {
        fixture.layouts++;
        if (fixture.fail) throw new Error('Fixture layout failed');
        if (fixture.reuseScene && fixture.runtime.model) return fixture.runtime.model;
        const interactions = [
          {
            key: 'span',
            sources: [{ spanId: 'exact-span-id' }],
            anchor: { x: 75, y: 60 },
            points: [],
            tooltip: { title: 'Span', rows: [{ label: 'Duration', value: '0' }] }
          }
        ];
        const scene: ChartScene<{ spanId: string }> = {
          width,
          height,
          rect: { x: 0, y: 0, width, height },
          hitMode: 'item',
          xTicks: [],
          yTicks: [],
          ariaLabel: 'Generic source fixture',
          interactions,
          interactionByKey: new Map(interactions.map((value) => [value.key, value])),
          marks: [
            {
              kind: 'rect',
              key: 'span',
              x: 20,
              y: 20,
              width: 130,
              height: 90,
              fill: 'var(--color-text-brand)'
            },
            {
              kind: 'text',
              x: measure('label'),
              y: 40,
              text: 'Persistent label',
              fill: 'var(--color-text-primary)'
            }
          ]
        };
        if (fixture.dense) {
          const other = {
            key: 'other',
            sources: [{ spanId: 'another-span-id' }],
            anchor: { x: 210, y: 126 },
            points: [],
            tooltip: { title: 'Other span', rows: [{ label: 'Duration', value: '1' }] }
          };
          scene.interactions.push(other);
          scene.interactionByKey.set(other.key, other);
          scene.marks.push({
            kind: 'rect',
            key: 'other',
            x: 160,
            y: 112,
            width: 100,
            height: 32,
            fill: '#3280dd'
          });
          for (let i = 0; i < 600; i++)
            scene.marks.push({
              kind: 'rect',
              x: 200 + (i % 80),
              y: 20 + Math.floor(i / 80) * 8,
              width: 1,
              height: 6,
              fill: '#3280dd'
            });
        }
        return scene;
      },
      onRender() {
        fixture.renders++;
      },
      onError() {
        fixture.errors++;
      }
    });
    window.matchMedia = nativeMatchMedia;
  });
  await settleRendering(page);
  await expect(page.locator('#runtime-fixture canvas')).toBeVisible();
});

test('density-only events resize pixels without re-layout, rearm observation and preserve a pin', async ({
  page,
  context
}) => {
  const canvas = page.locator('#runtime-fixture .canvas');
  await canvas.press('Home');
  await canvas.press('Enter');
  const layouts = await page.evaluate(() => window.canvasFixture.layouts);
  const cdp = await context.newCDPSession(page);
  const notify = async () =>
    page.evaluate(() => {
      const fixture = window.canvasFixture,
        query = fixture.densityQueries.at(-1)!;
      const native = window.matchMedia;
      window.matchMedia = (value) => {
        const result = native.call(window, value);
        fixture.densityQueries.push(result);
        return result;
      };
      try {
        query.dispatchEvent(
          new MediaQueryListEvent('change', { matches: false, media: query.media })
        );
      } finally {
        window.matchMedia = native;
      }
    });
  for (const density of [2, 3]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1100,
      height: 900,
      deviceScaleFactor: density,
      mobile: false
    });
    // This event is an explicit browser-adapter input. CDP does not consistently emit it.
    await notify();
    await expect
      .poll(() =>
        canvas
          .locator('canvas[data-layer=marks]')
          .evaluate((c) => ({
            actual: (c as HTMLCanvasElement).width,
            expected: Math.round(c.getBoundingClientRect().width * devicePixelRatio)
          }))
          .then((value) => value.actual === value.expected)
      )
      .toBe(true);
    await expect(canvas).toHaveAttribute('aria-label', 'Span; Duration: 0');
    expect(await page.evaluate(() => window.canvasFixture.runtime.session.pinned)).toBe(true);
    expect(await page.evaluate(() => window.canvasFixture.layouts)).toBe(layouts);
  }
  expect(await page.evaluate(() => window.canvasFixture.densityQueries.at(-1)!.media)).toBe(
    '(resolution: 3dppx)'
  );
  const renders = await page.evaluate(() => {
    window.canvasFixture.runtime.dispose();
    return window.canvasFixture.renders;
  });
  await notify();
  await settleRendering(page);
  expect(await page.evaluate(() => window.canvasFixture.renders)).toBe(renders);
  await expect(canvas.locator('canvas')).toHaveCount(0);
});

test('auto caching bounds owned surfaces, reuses the base on inspection and releases it on demotion/disposal', async ({
  page
}) => {
  const host = '#runtime-fixture',
    canvas = page.locator(`${host} .canvas`);
  await expect(page.locator(`${host} .plot-canvas`)).toHaveAttribute('data-surface-count', '1');
  await page.evaluate(() => {
    window.canvasFixture.dense = true;
    window.canvasFixture.runtime.refresh();
  });
  await expect(page.locator(`${host} .plot-canvas`)).toHaveAttribute(
    'data-paint-strategy',
    'cached'
  );
  await expect(page.locator(`${host} canvas`)).toHaveCount(1);
  const before = await page.evaluate(() => window.canvasFixture.runtime.diagnostics);
  expect(before.surfaces).toBe(2);
  expect(before.backingBytes).toBe(300 * 160 * 4 * 2);
  await canvas.press('Home');
  await canvas.press('Enter');
  const after = await page.evaluate(() => ({
    diagnostics: window.canvasFixture.runtime.diagnostics,
    sources: window.canvasFixture.runtime.session.active!.sources
  }));
  expect(after.sources).toEqual([{ spanId: 'exact-span-id' }]);
  expect(after.diagnostics.basePaints).toBe(before.basePaints);
  expect(after.diagnostics.frames).toBeGreaterThan(before.frames);
  const frame = (await canvas.boundingBox())!,
    edge = await pixel(page, host, 210, 112.5),
    interior = await pixel(page, host, 210, 135);
  await page.mouse.move(frame.x + 210, frame.y + 126);
  expect(await pixel(page, host, 210, 112.5)).not.toEqual(edge);
  expect(await pixel(page, host, 210, 135)).toEqual(interior);
  expect(await page.evaluate(() => window.canvasFixture.runtime.session.active!.key)).toBe('span');
  expect(await page.evaluate(() => window.canvasFixture.runtime.session.hovered!.key)).toBe(
    'other'
  );
  expect((await page.evaluate(() => window.canvasFixture.runtime.diagnostics)).basePaints).toBe(
    before.basePaints
  );
  await page.mouse.move(frame.x + 290, frame.y + 150);
  expect(await pixel(page, host, 210, 112.5)).toEqual(edge);
  expect(await page.evaluate(() => window.canvasFixture.runtime.session.pinned)).toBe(true);
  const renders = await page.evaluate(() => window.canvasFixture.renders);
  await page.evaluate(() => window.canvasFixture.runtime.refresh('paint'));
  await expect.poll(() => page.evaluate(() => window.canvasFixture.renders)).toBe(renders + 1);
  expect((await page.evaluate(() => window.canvasFixture.runtime.diagnostics)).basePaints).toBe(
    before.basePaints
  );
  await page
    .locator(host)
    .evaluate((node) => (node as HTMLElement).style.setProperty('--color-text-brand', '#123456'));
  await page.evaluate(() => window.canvasFixture.runtime.refresh('paint'));
  await expect
    .poll(() => page.evaluate(() => window.canvasFixture.runtime.diagnostics.basePaints))
    .toBe(before.basePaints + 1);
  expect(await pixel(page, host, 75, 80)).toEqual([18, 52, 86, 255]);
  await page.evaluate(() => {
    window.canvasFixture.reuseScene = true;
    document.fonts.dispatchEvent(new Event('loadingdone'));
  });
  await expect
    .poll(() => page.evaluate(() => window.canvasFixture.runtime.diagnostics.basePaints))
    .toBe(before.basePaints + 2);
  await page.evaluate(() => {
    window.canvasFixture.reuseScene = false;
    window.canvasFixture.dense = false;
    window.canvasFixture.runtime.refresh();
  });
  await expect(page.locator(`${host} .plot-canvas`)).toHaveAttribute('data-surface-count', '1');
  await expect(canvas).toHaveAttribute('aria-label', 'Span; Duration: 0');
  expect(await page.evaluate(() => window.canvasFixture.runtime.session.pinned)).toBe(true);
  expect((await page.evaluate(() => window.canvasFixture.runtime.diagnostics)).backingBytes).toBe(
    300 * 160 * 4
  );
  await page.evaluate(() => {
    window.canvasFixture.runtime.dispose();
    window.canvasFixture.runtime.refresh();
  });
  await expect(page.locator(`${host} canvas`)).toHaveCount(0);
  expect(await page.evaluate(() => window.canvasFixture.runtime.diagnostics)).toMatchObject({
    surfaces: 0,
    backingBytes: 0
  });
});

test('paint invalidation reuses layout; layout/font changes win and failed layouts recover', async ({
  page
}) => {
  const host = '#runtime-fixture';
  const counts = await page.evaluate(() => ({
    layouts: window.canvasFixture.layouts,
    renders: window.canvasFixture.renders
  }));
  await page
    .locator(host)
    .evaluate((node) => (node as HTMLElement).style.setProperty('--color-text-brand', '#123456'));
  await page.evaluate(() => {
    const r = window.canvasFixture.runtime;
    r.refresh('paint');
    r.refresh('paint');
  });
  await expect
    .poll(() => page.evaluate(() => window.canvasFixture.renders))
    .toBe(counts.renders + 1);
  expect(await page.evaluate(() => window.canvasFixture.layouts)).toBe(counts.layouts);
  expect(await pixel(page, host, 75, 80)).toEqual([18, 52, 86, 255]);
  await page.evaluate(() => {
    const r = window.canvasFixture.runtime;
    r.refresh('paint');
    r.refresh('layout');
    r.refresh('paint');
  });
  await expect
    .poll(() => page.evaluate(() => window.canvasFixture.layouts))
    .toBe(counts.layouts + 1);
  await page
    .locator(host)
    .evaluate((node) => (node as HTMLElement).style.setProperty('--font-sans', 'monospace'));
  await page.evaluate(() => window.canvasFixture.runtime.refresh('paint'));
  await expect
    .poll(() => page.evaluate(() => window.canvasFixture.layouts))
    .toBe(counts.layouts + 2);
  await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
  await expect
    .poll(() => page.evaluate(() => window.canvasFixture.layouts))
    .toBe(counts.layouts + 3);
  await page.evaluate(() => {
    window.canvasFixture.fail = true;
    window.canvasFixture.runtime.refresh();
  });
  await expect(page.locator(`${host} .canvas`)).toHaveAttribute(
    'aria-label',
    'Chart rendering failed.'
  );
  await expect(page.locator(`${host} canvas`)).toHaveCount(0);
  expect(await page.evaluate(() => window.canvasFixture.errors)).toBe(1);
  await page.evaluate(() => {
    window.canvasFixture.fail = false;
    window.canvasFixture.runtime.refresh('paint');
  });
  await expect(page.locator(`${host} canvas`)).toBeVisible();
  await page.locator(`${host} .canvas`).press('Home');
  await expect(page.locator(`${host} .canvas`)).toHaveAttribute('aria-label', 'Span; Duration: 0');
});
