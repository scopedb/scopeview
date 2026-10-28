import { test, expect, type Page } from '@playwright/test';
import type { ChartRuntime } from '../../src/runtime/chart-runtime.js';
import type { ReadingRuntime } from '../../src/runtime/reading-runtime.js';
import type { ChartScene, MeasureText } from '../../src/core/scene.js';
import type { PaintInvalidation } from '../../src/core/painter.js';
import { settleRendering } from './scene.js';

type Source = { value: string };
declare global {
  interface Window {
    lifecycleFixture: {
      runtime: ChartRuntime<Source> | ReadingRuntime<Source>;
      layouts: number;
      renders: number;
      errors: number;
      fail: boolean;
      measuredSize: number;
      measuredWidth: number;
      invalidations: PaintInvalidation[];
      densityQueries: MediaQueryList[];
      buffers: HTMLCanvasElement[];
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
        errors: 0,
        fail: false,
        measuredSize: 0,
        measuredWidth: 0,
        invalidations: [],
        densityQueries: [],
        buffers: []
      };
      window.lifecycleFixture = fixture;
      const nativeMatchMedia = window.matchMedia,
        nativeCreateElement = document.createElement;
      window.matchMedia = (query) => {
        const result = nativeMatchMedia.call(window, query);
        fixture.densityQueries.push(result);
        return result;
      };
      document.createElement = ((name: string, options?: ElementCreationOptions) => {
        const element = nativeCreateElement.call(document, name, options);
        if (element instanceof HTMLCanvasElement) fixture.buffers.push(element);
        return element;
      }) as typeof document.createElement;
      const options = {
        layout(width: number, height: number, measure: MeasureText) {
          fixture.layouts++;
          if (fixture.fail) throw new Error('Fixture layout failed');
          fixture.measuredSize = measure.fontSize!;
          fixture.measuredWidth = measure('MMMM');
          const target = {
            key: 'exact',
            sources: [{ value: '9007199254740993' }],
            anchor: { x: 70, y: 50 },
            points: [],
            tooltip: { title: 'Sample', rows: [{ label: 'Value', value: '9007199254740993' }] }
          };
          const scene: ChartScene<Source> = {
            width,
            height,
            rect: { x: 0, y: 0, width, height },
            marks: [
              {
                kind: 'rect',
                key: target.key,
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
            interactions: [target],
            interactionByKey: new Map([[target.key, target]]),
            ariaLabel: 'Lifecycle fixture'
          };
          return scene;
        },
        onRender() {
          fixture.renders++;
        },
        onError() {
          fixture.errors++;
        }
      };
      try {
        fixture.runtime =
          kind === 'reading'
            ? new ReadingRuntime(canvas, decoration, options)
            : new ChartRuntime(canvas, decoration, {
                ...options,
                invalidate: delegated
                  ? (reason: PaintInvalidation) => fixture.invalidations.push(reason)
                  : undefined
              });
      } finally {
        window.matchMedia = nativeMatchMedia;
        document.createElement = nativeCreateElement;
      }
    },
    { kind, delegated }
  );
  await settleRendering(page);
  await expect(page.locator('#lifecycle-fixture canvas[data-layer=marks]')).toBeVisible();
}

async function notifyDensity(page: Page) {
  await page.evaluate(() => {
    const fixture = window.lifecycleFixture,
      query = fixture.densityQueries.at(-1)!,
      native = window.matchMedia;
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
}

for (const kind of ['reading', 'chart'] as const) {
  test.describe(`${kind} lifecycle`, () => {
    test.beforeEach(async ({ page }) => mount(page, kind));

    test('coalesces refreshes, gives layout priority and remeasures fonts and host size', async ({
      page
    }) => {
      const before = await page.evaluate(() => {
        const fixture = window.lifecycleFixture;
        fixture.runtime.refresh('paint');
        fixture.runtime.refresh('paint');
        return { layouts: fixture.layouts, renders: fixture.renders, width: fixture.measuredWidth };
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
      await page.locator('#lifecycle-fixture .canvas').evaluate((node) => {
        (node as HTMLElement).style.setProperty('--scope-chart-font-scale', '2');
        window.lifecycleFixture.runtime.refresh('paint');
      });
      await settleRendering(page);
      expect(await page.evaluate(() => window.lifecycleFixture.layouts)).toBe(before.layouts + 2);
      expect(await page.evaluate(() => window.lifecycleFixture.measuredSize)).toBe(22);
      expect(await page.evaluate(() => window.lifecycleFixture.measuredWidth)).toBeGreaterThan(
        before.width
      );
      await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
      await settleRendering(page);
      expect(await page.evaluate(() => window.lifecycleFixture.layouts)).toBe(before.layouts + 3);
      await page.locator('#lifecycle-fixture .viewport').evaluate((node) => {
        (node as HTMLElement).style.width = '340px';
      });
      await expect
        .poll(() => page.evaluate(() => window.lifecycleFixture.runtime.model?.width))
        .toBe(340);
    });

    test('DPR changes resize buffers without layout and preserve exact selected sources', async ({
      page,
      context
    }) => {
      const before = await page.evaluate(() => {
        const fixture = window.lifecycleFixture;
        fixture.runtime.session.restorePin('exact');
        fixture.runtime.refresh('paint');
        return fixture.layouts;
      });
      await settleRendering(page);
      const cdp = await context.newCDPSession(page);
      for (const density of [2, 3]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: 1100,
          height: 900,
          deviceScaleFactor: density,
          mobile: false
        });
        await notifyDensity(page);
        await expect
          .poll(() =>
            page
              .locator('#lifecycle-fixture canvas[data-layer=marks]')
              .evaluate((node) => (node as HTMLCanvasElement).width)
          )
          .toBe(300 * density);
        expect(await page.evaluate(() => window.lifecycleFixture.layouts)).toBe(before);
        expect(
          await page.evaluate(() => window.lifecycleFixture.runtime.session.selected?.sources)
        ).toEqual([{ value: '9007199254740993' }]);
      }
      expect(await page.evaluate(() => window.lifecycleFixture.densityQueries.at(-1)!.media)).toBe(
        '(resolution: 3dppx)'
      );
      await expect(page.locator('#lifecycle-fixture .canvas')).toHaveAttribute(
        'aria-label',
        'Sample; Value: 9007199254740993'
      );
    });

    test('recovers hidden and failed layouts, then cancels queued work and releases all buffers', async ({
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
      await page.evaluate(() => {
        window.lifecycleFixture.fail = true;
        window.lifecycleFixture.runtime.refresh();
      });
      await expect(page.locator('#lifecycle-fixture .canvas')).toHaveAttribute(
        'aria-label',
        'Chart rendering failed.'
      );
      await expect(page.locator('#lifecycle-fixture canvas')).toHaveCount(0);
      expect(await page.evaluate(() => window.lifecycleFixture.errors)).toBe(1);
      await page.evaluate(() => {
        window.lifecycleFixture.fail = false;
        window.lifecycleFixture.runtime.refresh('paint');
      });
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
          renders: fixture.renders,
          queries: fixture.densityQueries.length
        };
      });
      await notifyDensity(page);
      await viewport.evaluate((node) => {
        (node as HTMLElement).style.width = '360px';
      });
      await settleRendering(page);
      expect(
        await page.evaluate(() => ({
          layouts: window.lifecycleFixture.layouts,
          renders: window.lifecycleFixture.renders,
          queries: window.lifecycleFixture.densityQueries.length
        }))
      ).toEqual(stopped);
      expect(await page.evaluate(() => window.lifecycleFixture.buffers.length)).toBeGreaterThan(0);
      expect(
        await page.evaluate(() =>
          window.lifecycleFixture.buffers.every(
            (buffer) => buffer.width === 0 && buffer.height === 0
          )
        )
      ).toBe(true);
      await expect(page.locator('#lifecycle-fixture canvas')).toHaveCount(0);
    });
  });
}

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
  await notifyDensity(page);
  expect(await page.evaluate(() => window.lifecycleFixture.invalidations)).toEqual([
    'layout',
    'paint'
  ]);
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
