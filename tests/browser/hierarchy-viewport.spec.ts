import { test, expect, type Page } from '@playwright/test';
import type { ViewportState } from '../../src/index.js';
import type { ScopeTraceElement, ScopeFlameElement } from '../../src/element.js';

type Family = 'trace' | 'profile';
type Hierarchy = ScopeTraceElement | ScopeFlameElement;
const first = { start: 0.1, end: 0.6, scrollOffset: 0 };
const latest = { start: 0.25, end: 0.75, scrollOffset: 0 };

async function deepHierarchy(page: Page, family: Family) {
  const nodes = Array.from({ length: 50 }, (_, i) => ({
    id: `node-${i}`,
    name: `node-${i}`,
    ...(i ? { parentId: `node-${i - 1}` } : {})
  }));
  const document =
    family === 'trace'
      ? {
          version: 1,
          kind: 'trace',
          spans: nodes.map((node) => ({ ...node, startTimeNs: '0', endTimeNs: '10000' }))
        }
      : {
          version: 1,
          kind: 'profile',
          unit: 'samples',
          frames: nodes.map((node) => ({ ...node, selfWeight: '1' }))
        };
  await page.evaluate(async (document) => {
    const f = window.notificationFixture;
    f.chart!.document = document;
    await f.settle();
  }, document);
}

for (const family of ['trace', 'profile'] as const) {
  test.describe(`component/${family} viewport`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/tests/browser/fixtures/blank.html');
      await page.evaluate(async (family) => {
        const module = '/tests/browser/fixtures/inspection-matrix.ts';
        const { createInspectionFixture }: typeof import('./fixtures/inspection-matrix.js') =
          await import(module);
        window.notificationFixture = await createInspectionFixture({
          family,
          surface: 'component',
          name: 'viewport'
        });
      }, family);
    });

    for (const pin of [false, true]) {
      for (const height of [240, 120]) {
        test(`hidden focusNode remains visible after showing at ${height}px, pin=${pin}`, async ({
          page
        }) => {
          await deepHierarchy(page, family);
          const result = await page.evaluate(
            async ({ pin, height }) => {
              const f = window.notificationFixture;
              const chart = f.chart as Hierarchy;
              const snapshot = chart.scene;
              f.host.style.display = 'none';
              await f.settle();
              chart.focusNode('node-20', { pin });
              const hidden = {
                viewport: chart.viewport,
                pin: chart.viewState.pinnedKey,
                key: f.latest.inspect?.key
              };
              chart.style.setProperty('--scope-chart-height', `${height}px`);
              f.host.style.display = '';
              await f.settle();
              await f.settle();
              const scene = chart.scene!;
              const clip = scene.clipRect ?? scene.rect!;
              const key = `${f.entry.family}:node-20`;
              const mark = scene.marks.find((mark) => mark.kind === 'rect' && mark.key === key);
              const visible =
                mark?.kind === 'rect' &&
                Math.min(mark.y + mark.height, clip.y + clip.height) > Math.max(mark.y, clip.y) &&
                Math.min(mark.x + mark.width, clip.x + clip.width) > Math.max(mark.x, clip.x);
              return {
                hidden,
                visible,
                pin: chart.viewState.pinnedKey,
                key: f.latest.inspect?.key,
                snapshotPainted: scene !== snapshot
              };
            },
            { pin, height }
          );
          const key = `${family}:node-20`;
          expect(result.hidden).toEqual({
            viewport: { start: 0, end: 1, scrollOffset: 328 },
            pin: pin ? key : null,
            key
          });
          expect(result.snapshotPainted).toBe(true);
          expect(result.visible).toBe(true);
          expect(result.key).toBe(key);
          expect(result.pin).toBe(pin ? key : null);
        });
      }
    }

    for (const action of ['dismiss', 'viewport', 'restore', 'document'] as const) {
      test(`a newer ${action} cancels hidden focusNode positioning`, async ({ page }) => {
        await deepHierarchy(page, family);
        const result = await page.evaluate(async (action) => {
          const f = window.notificationFixture;
          const chart = f.chart as Hierarchy;
          f.host.style.display = 'none';
          await f.settle();
          chart.focusNode('node-20', { pin: true });
          if (action === 'dismiss') f.dismiss();
          else if (action === 'viewport') chart.viewport = { start: 0, end: 1, scrollOffset: 0 };
          else if (action === 'restore')
            chart.viewState = {
              ...chart.viewState,
              pinnedKey: null,
              viewport: { start: 0, end: 1, scrollOffset: 0 }
            };
          else chart.updateDocument(chart.document);
          const intended = chart.viewState.viewport;
          f.host.style.display = '';
          await f.settle();
          await f.settle();
          return { intended, viewport: chart.viewport, pin: chart.viewState.pinnedKey };
        }, action);
        expect(result.viewport).toEqual(result.intended);
        expect(result.pin).toBe(action === 'viewport' ? `${family}:node-20` : null);
      });
    }

    test('hidden focusNode supersedes a pin waiting for replacement paint', async ({ page }) => {
      await deepHierarchy(page, family);
      const result = await page.evaluate(async () => {
        const f = window.notificationFixture;
        const chart = f.chart as Hierarchy;
        chart.focusNode('node-0', { pin: true });
        const snapshot = f.latest.select?.snapshotId;
        f.host.style.display = 'none';
        await f.settle();
        chart.updateDocument(chart.document, { preserveViewState: true });
        chart.focusNode('node-20', { pin: true });
        const hidden = { pin: chart.viewState.pinnedKey, snapshot: f.latest.select?.snapshotId };
        chart.style.setProperty('--scope-chart-height', '120px');
        f.host.style.display = '';
        await f.settle();
        await f.settle();
        const scene = chart.scene!;
        const clip = scene.clipRect ?? scene.rect!;
        const key = `${f.entry.family}:node-20`;
        const mark = scene.marks.find((mark) => mark.kind === 'rect' && mark.key === key);
        const visible =
          mark?.kind === 'rect' && mark.y >= clip.y && mark.y + mark.height <= clip.y + clip.height;
        return {
          snapshot,
          hidden,
          visible,
          pin: chart.viewState.pinnedKey,
          selected: f.latest.select
        };
      });
      expect(result.hidden).toEqual({ pin: `${family}:node-20`, snapshot: result.snapshot });
      expect(result.visible).toBe(true);
      expect(result.pin).toBe(`${family}:node-20`);
      expect(result.selected?.key).toBe(`${family}:node-20`);
      expect(result.selected?.snapshotId).not.toBe(result.snapshot);
    });

    test('a viewport changed by the navigation reading callback is the last published window', async ({
      page
    }) => {
      const result = await page.evaluate(async (latest) => {
        const f = window.notificationFixture;
        const chart = f.chart as Hierarchy;
        const rootModule = '/src/index.ts';
        const elementModule = '/src/element.ts';
        const { ChartLinkGroup }: typeof import('../../src/index.js') = await import(rootModule);
        const { bindChartLinks }: typeof import('../../src/element.js') = await import(
          elementModule
        );
        f.pin();
        chart.viewport = {
          start: f.entry.family === 'trace' ? 0.5 : 0,
          end: f.entry.family === 'trace' ? 1 : 0.5,
          scrollOffset: 0
        };
        await f.settle();
        const events: ViewportState[] = [];
        chart.addEventListener('scope-viewport-change', (event) =>
          events.push({ ...(event as CustomEvent<ViewportState>).detail })
        );
        const group = new ChartLinkGroup();
        const binding = bindChartLinks(chart, group, {
          id: 'viewport',
          project: () => null,
          viewportWindow: (detail) => {
            const viewport = detail as ViewportState;
            return {
              startTimeNs: String(viewport.start * 1000),
              endTimeNs: String(viewport.end * 1000)
            };
          }
        });
        const previous = f.latest.select;
        let changed = false;
        f.hook = (notification) => {
          if (
            !changed &&
            notification.channel === 'inspect' &&
            notification.key?.endsWith(':child') &&
            notification.context?.snapshotId !== previous?.snapshotId
          ) {
            changed = true;
            chart.viewport = latest;
          }
        };
        await f.replace('200');
        f.key('End');
        await f.settle();
        const result = { changed, events, viewport: chart.viewport, window: group.state.window };
        binding.disconnect();
        return result;
      }, latest);
      expect(result.changed).toBe(true);
      expect(result.events).toEqual([latest]);
      expect(result.viewport).toEqual(latest);
      expect(result.window).toEqual({ startTimeNs: '250', endTimeNs: '750' });
    });

    test('a control callback supersedes a captured viewport notification', async ({ page }) => {
      const result = await page.evaluate(
        async ({ first, latest }) => {
          const f = window.notificationFixture;
          const chart = f.chart as Hierarchy;
          f.pin();
          const events: ViewportState[] = [];
          chart.addEventListener('scope-viewport-change', (event) =>
            events.push({ ...(event as CustomEvent<ViewportState>).detail })
          );
          let changed = false;
          chart.addEventListener('scope-controls-change', () => {
            if (!changed) {
              changed = true;
              chart.viewport = latest;
            }
          });
          chart.configure({ toolbar: { actions: ['inspect'] } });
          chart.viewport = first;
          await f.settle();
          return { changed, events, viewport: chart.viewport };
        },
        { first, latest }
      );
      expect(result.changed).toBe(true);
      expect(result.events).toEqual([latest]);
      expect(result.viewport).toEqual(latest);
    });

    test('a document replaced by a control callback cancels the old viewport report', async ({
      page
    }) => {
      const result = await page.evaluate(async (first) => {
        const f = window.notificationFixture;
        const chart = f.chart as Hierarchy;
        f.pin();
        const events: ViewportState[] = [];
        chart.addEventListener('scope-viewport-change', (event) =>
          events.push({ ...(event as CustomEvent<ViewportState>).detail })
        );
        let replaced = false;
        chart.addEventListener('scope-controls-change', () => {
          if (!replaced) {
            replaced = true;
            chart.updateDocument(chart.document);
          }
        });
        chart.configure({ toolbar: { actions: ['inspect'] } });
        chart.viewport = first;
        await f.settle();
        return { replaced, events, viewport: chart.viewport, pin: chart.viewState.pinnedKey };
      }, first);
      expect(result).toEqual({
        replaced: true,
        events: [],
        viewport: { start: 0, end: 1, scrollOffset: 0 },
        pin: null
      });
    });

    for (const throws of [false, true]) {
      test(`independent viewport observers receive nested changes in order, throws=${throws}`, async ({
        page
      }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const result = await page.evaluate(
          async ({ first, latest, throws }) => {
            const f = window.notificationFixture;
            const chart = f.chart as Hierarchy;
            f.pin();
            const early: ViewportState[] = [],
              late: ViewportState[] = [];
            let changed = false;
            chart.addEventListener('scope-viewport-change', (event) => {
              early.push({ ...(event as CustomEvent<ViewportState>).detail });
              if (!changed) {
                changed = true;
                chart.viewport = latest;
                if (throws) throw new Error('Viewport observer failure');
              }
            });
            f.host.addEventListener('scope-viewport-change', (event) =>
              late.push({ ...(event as CustomEvent<ViewportState>).detail })
            );
            chart.viewport = first;
            await f.settle();
            return { early, late, viewport: chart.viewport };
          },
          { first, latest, throws }
        );
        expect(result.early).toEqual([first, latest]);
        expect(result.late).toEqual(result.early);
        expect(result.viewport).toEqual(latest);
        expect(errors).toEqual(throws ? ['Viewport observer failure'] : []);
      });
    }

    test('nested viewport changes coalesce to the latest window', async ({ page }) => {
      const result = await page.evaluate(
        async ({ first, latest }) => {
          const f = window.notificationFixture;
          const chart = f.chart as Hierarchy;
          f.pin();
          const early: ViewportState[] = [],
            late: ViewportState[] = [];
          let changed = false;
          chart.addEventListener('scope-viewport-change', (event) => {
            early.push({ ...(event as CustomEvent<ViewportState>).detail });
            if (!changed) {
              changed = true;
              chart.viewport = { start: 0, end: 0.5, scrollOffset: 0 };
              chart.viewport = latest;
            }
          });
          f.host.addEventListener('scope-viewport-change', (event) =>
            late.push({ ...(event as CustomEvent<ViewportState>).detail })
          );
          chart.viewport = first;
          await f.settle();
          return { early, late, viewport: chart.viewport };
        },
        { first, latest }
      );
      expect(result.early).toEqual([first, latest]);
      expect(result.late).toEqual(result.early);
      expect(result.viewport).toEqual(latest);
    });
  });
}
