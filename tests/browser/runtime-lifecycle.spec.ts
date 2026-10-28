import { test, expect, type Page } from '@playwright/test';
import type { ChartRuntime } from '../../src/runtime/chart-runtime.js';
import type { ReadingRuntime } from '../../src/runtime/reading-runtime.js';
import type { ChartScene } from '../../src/core/scene.js';
import type { PaintInvalidation } from '../../src/core/painter.js';
import { settleRendering } from './scene.js';

type Source = { value: string };
declare global {
  interface Window {
    lifecycleFixture: {
      runtime: ChartRuntime<Source> | ReadingRuntime<Source>;
      layouts: number;
      renders: number;
      invalidations: PaintInvalidation[];
    };
  }
}

async function mount(page: Page, kind: 'reading' | 'chart', delegated = false) {
  await page.goto('/tests/browser/fixtures/blank.html');
  await page.evaluate(
    async ({ kind, delegated }) => {
      const readingEntry = '/src/runtime/reading-runtime.ts',
        chartEntry = '/src/runtime/chart-runtime.ts',
        hostEntry = '/tests/browser/fixtures/host.ts';
      const [{ ReadingRuntime }, { ChartRuntime }, { createCanvasHost }] = await Promise.all([
        import(readingEntry),
        import(chartEntry),
        import(hostEntry)
      ]);
      const { canvas, decoration } = createCanvasHost({
        id: 'lifecycle-fixture',
        width: 300,
        height: 160
      });
      const fixture: Window['lifecycleFixture'] = {
        runtime: null!,
        layouts: 0,
        renders: 0,
        invalidations: []
      };
      window.lifecycleFixture = fixture;
      const options = {
        layout(width: number, height: number) {
          fixture.layouts++;
          const scene: ChartScene<Source> = {
            width,
            height,
            rect: { x: 0, y: 0, width, height },
            marks: [
              {
                kind: 'rect',
                x: 20,
                y: 20,
                width: 100,
                height: 60,
                fill: '#3280dd'
              }
            ],
            xTicks: [],
            yTicks: [],
            hitMode: 'item',
            interactions: [],
            interactionByKey: new Map(),
            ariaLabel: 'Lifecycle fixture'
          };
          return scene;
        },
        onRender() {
          fixture.renders++;
        }
      };
      fixture.runtime =
        kind === 'reading'
          ? new ReadingRuntime(canvas, decoration, options)
          : new ChartRuntime(canvas, decoration, {
              ...options,
              invalidate: delegated
                ? (reason: PaintInvalidation) => fixture.invalidations.push(reason)
                : undefined
            });
    },
    { kind, delegated }
  );
  await settleRendering(page);
  await expect(page.locator('#lifecycle-fixture canvas[data-layer=marks]')).toBeVisible();
}

test.describe('reading lifecycle', () => {
  test.beforeEach(async ({ page }) => mount(page, 'reading'));

  test('coalesces refreshes and gives layout priority', async ({ page }) => {
    const before = await page.evaluate(() => {
      const fixture = window.lifecycleFixture;
      fixture.runtime.refresh('paint');
      fixture.runtime.refresh('paint');
      return { layouts: fixture.layouts, renders: fixture.renders };
    });
    await settleRendering(page);
    expect(await page.evaluate(() => window.lifecycleFixture.renders)).toBe(before.renders + 1);
    expect(await page.evaluate(() => window.lifecycleFixture.layouts)).toBe(before.layouts);
    await page.evaluate(() => {
      const { runtime } = window.lifecycleFixture;
      runtime.refresh('paint');
      runtime.refresh('layout');
      runtime.refresh('paint');
    });
    await settleRendering(page);
    expect(await page.evaluate(() => window.lifecycleFixture.layouts)).toBe(before.layouts + 1);
    expect(await page.evaluate(() => window.lifecycleFixture.renders)).toBe(before.renders + 2);
  });

  test('resumes a hidden layout and stops queued work and browser listeners on disposal', async ({
    page
  }) => {
    const before = await page.evaluate(() => ({
      layouts: window.lifecycleFixture.layouts,
      renders: window.lifecycleFixture.renders
    }));
    const viewport = page.locator('#lifecycle-fixture .viewport');
    await viewport.evaluate((node) => {
      (node as HTMLElement).style.display = 'none';
      window.lifecycleFixture.runtime.refresh();
    });
    await settleRendering(page);
    expect(await page.evaluate(() => window.lifecycleFixture.renders)).toBe(before.renders);
    await viewport.evaluate((node) => {
      (node as HTMLElement).style.display = '';
    });
    await expect
      .poll(() => page.evaluate(() => window.lifecycleFixture.layouts))
      .toBe(before.layouts + 1);
    await expect(page.locator('#lifecycle-fixture canvas')).toBeVisible();
    const stopped = await page.evaluate(() => {
      const fixture = window.lifecycleFixture;
      fixture.runtime.refresh();
      fixture.runtime.dispose();
      fixture.runtime.dispose();
      fixture.runtime.refresh();
      fixture.runtime.paint();
      document.fonts.dispatchEvent(new Event('loadingdone'));
      window.dispatchEvent(new Event('resize'));
      return {
        layouts: fixture.layouts,
        renders: fixture.renders
      };
    });
    await viewport.evaluate((node) => {
      (node as HTMLElement).style.width = '360px';
    });
    await settleRendering(page);
    expect(
      await page.evaluate(() => ({
        layouts: window.lifecycleFixture.layouts,
        renders: window.lifecycleFixture.renders
      }))
    ).toEqual(stopped);
    await expect(page.locator('#lifecycle-fixture canvas')).toHaveCount(0);
  });
});

test('chart lifecycle preserves host-owned invalidation and its pending layout reason', async ({
  page
}) => {
  await mount(page, 'chart', true);
  const before = await page.evaluate(() => {
    const fixture = window.lifecycleFixture;
    fixture.runtime.paint();
    fixture.invalidations = [];
    return { layouts: fixture.layouts, renders: fixture.renders };
  });
  await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
  await settleRendering(page);
  expect(await page.evaluate(() => window.lifecycleFixture.invalidations)).toEqual(['layout']);
  expect(await page.evaluate(() => window.lifecycleFixture.renders)).toBe(before.renders);
  await page.evaluate(() =>
    (window.lifecycleFixture.runtime as ChartRuntime<Source>).paint(undefined, 'paint')
  );
  expect(await page.evaluate(() => window.lifecycleFixture.layouts)).toBe(before.layouts + 1);
});

test('chart retains replacement layouts while hidden and between synchronous and scheduled paint', async ({
  page
}) => {
  await mount(page, 'chart');
  const viewport = page.locator('#lifecycle-fixture .viewport');
  await viewport.evaluate((node) => {
    (node as HTMLElement).style.display = 'none';
    const runtime = window.lifecycleFixture.runtime as ChartRuntime<Source>;
    const previous = runtime.model!;
    runtime.setLayout((width, height) => ({
      ...previous,
      width,
      height,
      ariaLabel: 'Replacement layout'
    }));
  });
  await settleRendering(page);
  await viewport.evaluate((node) => {
    (node as HTMLElement).style.display = '';
  });
  await expect(page.locator('#lifecycle-fixture .canvas')).toHaveAttribute(
    'aria-label',
    'Replacement layout'
  );
  await page.evaluate(() => {
    const runtime = window.lifecycleFixture.runtime as ChartRuntime<Source>;
    const previous = runtime.model!;
    runtime.paint((width, height) => ({
      ...previous,
      width,
      height,
      ariaLabel: 'Explicit layout'
    }));
    runtime.refresh();
  });
  await settleRendering(page);
  await expect(page.locator('#lifecycle-fixture .canvas')).toHaveAttribute(
    'aria-label',
    'Explicit layout'
  );
});
