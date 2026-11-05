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

for (const kind of ['reading', 'chart'] as const) {
  test(`${kind} keeps a retained disposed session independent of the next runtime on its Canvas`, async ({
    page
  }) => {
    await mount(page, kind);
    const result = await page.evaluate(async (kind) => {
      const old = window.lifecycleFixture.runtime;
      const oldSession = old.session;
      const root = document.getElementById('lifecycle-fixture')!.shadowRoot!;
      const canvas = root.querySelector<HTMLElement>('.canvas')!;
      const decoration = root.querySelector<HTMLElement>('.decoration')!;
      const frame = old.model!;
      const scene = (key: string): ChartScene<Source> => {
        const target = {
          key,
          sources: [{ value: key }],
          tooltip: { rows: [] },
          anchor: { x: 50, y: 50 },
          points: []
        };
        return {
          ...frame,
          marks: [],
          interactions: [target],
          interactionByKey: new Map([[key, target]])
        };
      };
      old.dispose();
      const module =
        kind === 'chart' ? '/src/runtime/chart-runtime.ts' : '/src/runtime/reading-runtime.ts';
      const api = await import(module);
      const next: ChartRuntime<Source> | ReadingRuntime<Source> =
        kind === 'chart'
          ? new api.ChartRuntime(canvas, decoration, { layout: () => scene('new') })
          : new api.ReadingRuntime(canvas, decoration, { layout: () => scene('new') });
      next.paint();
      next.session.inspect('new', true, true);
      oldSession.setModel(scene('old'));
      oldSession.inspect('old', true, true);
      const result = { current: next.session.selected?.key, retained: oldSession.selected?.key };
      next.dispose();
      return result;
    }, kind);
    expect(result).toEqual({ current: 'new', retained: 'old' });
  });

  for (const throws of [false, true]) {
    test(`${kind} discards a layout superseded by a semantic model command, throws=${throws}`, async ({
      page
    }) => {
      await mount(page, kind);
      const result = await page.evaluate((throws) => {
        const runtime = window.lifecycleFixture.runtime;
        const previous = runtime.model!;
        const scene = (key: string): ChartScene<Source> => {
          const target = {
            key,
            sources: [{ value: key }],
            tooltip: { rows: [] },
            anchor: { x: 50, y: 50 },
            points: []
          };
          return {
            ...previous,
            marks: [],
            ariaLabel: key,
            interactions: [target],
            interactionByKey: new Map([[key, target]])
          };
        };
        const latest = scene('latest');
        runtime.paint(() => {
          runtime.session.setModel(latest);
          runtime.session.inspect('latest', true, true);
          if (throws) throw new Error('Obsolete layout');
          return scene('obsolete');
        });
        const staleDiscarded = runtime.model === previous;
        runtime.paint(() => latest);
        return {
          staleDiscarded,
          selected: runtime.session.selected?.key,
          painted: runtime.model?.ariaLabel
        };
      }, throws);
      expect(result).toEqual({ staleDiscarded: true, selected: 'latest', painted: 'latest' });
    });
  }
}

for (const kind of ['reading', 'chart'] as const) {
  for (const key of ['Enter', 'End']) {
    test(`${kind} commits ${key} before navigation can paint and dismiss the reading`, async ({
      page
    }) => {
      await page.goto('/tests/browser/fixtures/blank.html');
      const result = await page.evaluate(
        async ({ kind, key }) => {
          const readingEntry = '/src/runtime/reading-runtime.ts',
            chartEntry = '/src/runtime/chart-runtime.ts',
            apiEntry = '/src/index.ts',
            hostEntry = '/tests/browser/fixtures/host.ts';
          const [
            { ReadingRuntime },
            { ChartRuntime },
            { compileChart, layoutChart },
            { createCanvasHost }
          ] = await Promise.all([
            import(readingEntry),
            import(chartEntry),
            import(apiEntry),
            import(hostEntry)
          ]);
          const { canvas, decoration } = createCanvasHost({
            id: 'navigation',
            width: 400,
            height: 200
          });
          const compiled = compileChart({
            version: 1,
            data: {
              fields: [
                { name: 'category', data_type: 'string' },
                { name: 'value', data_type: 'number' }
              ],
              rows: [
                ['a', '100'],
                ['b', '200']
              ]
            },
            spec: { visualization: 'bar', encoding: { x: 'category', y: ['value'] } }
          });
          let armed = false;
          let disposeOnRender = false;
          let activeDuringNavigation: string | null = null;
          let selectedDuringNavigation: string | null = null;
          const readings: (string | null)[] = [];
          let runtime: ReadingRuntime<unknown> | ChartRuntime<unknown>;
          const options = {
            layout: (width: number, height: number) =>
              layoutChart(compiled, new Set(), width, height, (text: string) => text.length * 7),
            onNavigate: () => runtime.paint(),
            onRender() {
              if (!armed) return;
              activeDuringNavigation = runtime.session.active?.key ?? null;
              selectedDuringNavigation = runtime.session.selected?.key ?? null;
              if (disposeOnRender) {
                runtime.dispose();
                return;
              }
              runtime.session.clearInspection();
              runtime.focus(null);
            },
            onInspect: (target: { key: string } | null) => readings.push(target?.key ?? null)
          };
          runtime =
            kind === 'reading'
              ? new ReadingRuntime(canvas, decoration, options)
              : new ChartRuntime(canvas, decoration, options);
          if (kind === 'reading') (runtime as ReadingRuntime<unknown>).selectable = true;
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
          runtime.session.inspect('category:a', false, true);
          armed = true;
          canvas.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
          const result = {
            activeDuringNavigation,
            selectedDuringNavigation,
            readings: [...readings],
            active: runtime.session.active?.key ?? null,
            selected: runtime.session.selected?.key ?? null
          };
          readings.length = 0;
          disposeOnRender = true;
          runtime.session.inspect('category:a', false, true);
          canvas.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
          return { ...result, disposedReadings: readings };
        },
        { kind, key }
      );
      expect(result.activeDuringNavigation).toBe(key === 'Enter' ? 'category:a' : 'category:b');
      expect(result.selectedDuringNavigation).toBe(key === 'Enter' ? 'category:a' : null);
      expect(result.active).toBeNull();
      expect(result.selected).toBeNull();
      expect(result.readings).toEqual([null]);
      expect(result.disposedReadings).toEqual([]);
    });
  }
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
