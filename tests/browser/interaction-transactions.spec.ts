import { test, expect } from '@playwright/test';
import type { ScopeTraceElement, ScopeFlameElement } from '../../src/element.js';
import type { ViewportState } from '../../src/index.js';

type Hierarchy = ScopeTraceElement | ScopeFlameElement;

for (const family of ['trace', 'profile'] as const) {
  test.describe(`${family} interaction transactions`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/tests/browser/fixtures/blank.html');
      await page.evaluate(async (family) => {
        const module = '/tests/browser/fixtures/inspection-matrix.ts';
        const {
          createInspectionFixture,
          hierarchyDocument
        }: typeof import('./fixtures/inspection-matrix.js') = await import(module);
        const f = await createInspectionFixture({
          name: 'transactions',
          family,
          surface: 'component'
        });
        window.notificationFixture = f;
        f.chart!.document = hierarchyDocument(family);
        await f.settle();
      }, family);
    });

    test('same-window acknowledgements quiesce without another notification', async ({ page }) => {
      const result = await page.evaluate(async () => {
        const f = window.notificationFixture;
        const chart = f.chart as Hierarchy;
        let notifications = 0;
        chart.addEventListener('scope-viewport-change', (event) => {
          notifications++;
          chart.viewport = { ...(event as CustomEvent<ViewportState>).detail };
        });
        chart.viewport = { start: 0.25, end: 0.75, scrollOffset: 50 };
        const immediate = notifications;
        await f.settle();
        return { immediate, notifications, viewport: chart.viewport };
      });
      expect(result).toEqual({
        immediate: 1,
        notifications: 1,
        viewport: { start: 0.25, end: 0.75, scrollOffset: 50 }
      });
    });

    test('changing-window feedback yields to the event loop', async ({ page }) => {
      const result = await page.evaluate(async () => {
        const chart = window.notificationFixture.chart as Hierarchy;
        let count = 0;
        chart.addEventListener('scope-viewport-change', () => {
          if (++count < 200)
            chart.viewport = {
              start: count % 2 ? 0.1 : 0.2,
              end: count % 2 ? 0.6 : 0.7,
              scrollOffset: 0
            };
        });
        chart.viewport = { start: 0.2, end: 0.7, scrollOffset: 0 };
        const immediate = count;
        await new Promise((resolve) => setTimeout(resolve, 0));
        const yielded = count;
        while (count < 200) await new Promise((resolve) => setTimeout(resolve, 5));
        return { immediate, yielded, settled: count };
      });
      expect(result.immediate).toBeGreaterThan(0);
      expect(result.immediate).toBeLessThan(200);
      expect(result.yielded).toBeLessThan(200);
      expect(result.settled).toBe(200);
    });

    test('collapse acknowledgements quiesce without another notification', async ({ page }) => {
      const result = await page.evaluate(async () => {
        const f = window.notificationFixture;
        const chart = f.chart as Hierarchy;
        let count = 0;
        chart.addEventListener('scope-collapse-change', (event) => {
          count++;
          chart.collapsed = (event as CustomEvent<{ collapsed: string[] }>).detail.collapsed;
        });
        chart.collapsed = ['node-0'];
        await f.settle();
        return { count, collapsed: chart.collapsed };
      });
      expect(result).toEqual({ count: 1, collapsed: ['node-0'] });
    });

    for (const cancelable of [false, true]) {
      test(`Canvas listeners can restore after the sole Escape handler, cancelable=${cancelable}`, async ({
        page
      }) => {
        const result = await page.evaluate(async (cancelable) => {
          const f = window.notificationFixture;
          const chart = f.chart as Hierarchy;
          chart.focusNode('node-0', { pin: true });
          const saved = chart.viewState;
          let observed = 0;
          f.canvas.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
              observed++;
              chart.viewState = saved;
            }
          });
          f.canvas.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable })
          );
          const immediate = chart.viewState.pinnedKey;
          await f.settle();
          return { observed, immediate, selected: f.latest.select?.key };
        }, cancelable);
        expect(result).toEqual({
          observed: 1,
          immediate: `${family}:node-0`,
          selected: `${family}:node-0`
        });
      });
    }

    for (const command of ['focusNode', 'keyboard'] as const) {
      test(`a nested ${command} owns selection and geometry before the outer call returns`, async ({
        page
      }) => {
        const result = await page.evaluate((command) => {
          const f = window.notificationFixture;
          const chart = f.chart as Hierarchy;
          const early: number[] = [];
          const delegated: number[] = [];
          let nested = false;
          let synchronous: string | null = null;
          chart.addEventListener('scope-viewport-change', (event) => {
            early.push((event as CustomEvent<ViewportState>).detail.scrollOffset);
            if (nested) return;
            nested = true;
            if (command === 'focusNode') chart.focusNode('node-30', { pin: true });
            else {
              f.key('End');
              f.key('Enter');
            }
            synchronous = chart.viewState.pinnedKey;
          });
          f.host.addEventListener('scope-viewport-change', (event) =>
            delegated.push((event as CustomEvent<ViewportState>).detail.scrollOffset)
          );
          chart.focusNode('node-20', { pin: true });
          const key = `${f.entry.family}:node-${command === 'focusNode' ? 30 : 49}`;
          return {
            key,
            synchronous,
            pin: chart.viewState.pinnedKey,
            selected: f.latest.select?.key,
            inspected: f.latest.inspect?.key,
            painted: chart.scene!.interactionByKey.has(key),
            early,
            delegated
          };
        }, command);
        expect(result.synchronous).toBe(result.key);
        expect(result.pin).toBe(result.key);
        expect(result.selected).toBe(result.key);
        expect(result.inspected).toBe(result.key);
        expect(result.painted).toBe(true);
        expect(result.early).toEqual([328, command === 'focusNode' ? 568 : 1024]);
        expect(result.delegated).toEqual(result.early);
      });
    }
  });
}

for (const family of ['metric', 'trace', 'profile'] as const) {
  test(`${family} discards ready when a controls observer disconnects the completed frame`, async ({
    page
  }) => {
    await page.goto('/tests/browser/fixtures/blank.html');
    const result = await page.evaluate(async (family) => {
      const module = '/tests/browser/fixtures/inspection-matrix.ts';
      const { createInspectionFixture }: typeof import('./fixtures/inspection-matrix.js') =
        await import(module);
      const f = await createInspectionFixture({ name: 'lifecycle', family, surface: 'component' });
      const chart = f.chart!;
      chart.loading = true;
      await f.settle();
      let ready = 0,
        removed = false;
      chart.addEventListener('scope-ready', () => ready++);
      chart.addEventListener('scope-controls-change', () => {
        if (chart.dataset.state === 'ready' && !removed) {
          removed = true;
          chart.remove();
        }
      });
      chart.loading = false;
      await f.settle();
      return { removed, connected: chart.isConnected, ready };
    }, family);
    expect(result).toEqual({ removed: true, connected: false, ready: 0 });
  });
}
