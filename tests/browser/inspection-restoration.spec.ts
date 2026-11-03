import { expect, test } from '@playwright/test';
import type { ScopeTraceElement, ScopeFlameElement } from '../../src/element.js';

for (const family of ['metric', 'trace', 'profile'] as const) {
  test.describe(`${family} inspection restoration`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/tests/browser/fixtures/blank.html');
      await page.evaluate(async (family) => {
        const module = '/tests/browser/fixtures/inspection-matrix.ts';
        const { createInspectionFixture }: typeof import('./fixtures/inspection-matrix.js') =
          await import(module);
        window.notificationFixture = await createInspectionFixture({
          name: 'restoration',
          family,
          surface: 'component'
        });
      }, family);
    });

    const inputs = ['keyboard', 'pointer', 'dismiss', 'hover'] as const;
    for (const input of family === 'metric' ? inputs : ([...inputs, 'focus'] as const)) {
      test(`${input} and restoration respect command order before paint and during a callback`, async ({
        page
      }) => {
        const results = await page.evaluate(async (input) => {
          const f = window.notificationFixture;
          const chart = f.chart!;
          const point = await f.point();
          f.key('End');
          f.key('Enter');
          const saved = chart.viewState;
          const enter = () => {
            if (input === 'keyboard') {
              f.key('Home');
              f.key('Enter');
            } else if (input === 'dismiss') f.key('Escape');
            else if (input === 'focus')
              (chart as ScopeTraceElement | ScopeFlameElement).focusNode('a', { pin: true });
            else
              f.root.querySelector('.plot')!.dispatchEvent(
                new MouseEvent(input === 'pointer' ? 'click' : 'pointermove', {
                  clientX: point.x,
                  clientY: point.y,
                  bubbles: true
                })
              );
          };
          const results = [];
          for (const nested of [false, true]) {
            for (const restoreLast of [false, true]) {
              for (const pinnedKey of [saved.pinnedKey, null]) {
                f.key('Escape');
                let inside: string | null = null;
                const command = () => {
                  if (restoreLast) enter();
                  chart.viewState = { ...saved, pinnedKey };
                  if (!restoreLast) enter();
                  inside = chart.viewState.pinnedKey;
                };
                if (nested) {
                  f.hook = ({ channel, key }) => {
                    if (channel !== 'inspect' || !key) return;
                    f.hook = undefined;
                    command();
                  };
                  f.key('Home');
                } else command();
                const immediate = chart.viewState.pinnedKey;
                await f.settle();
                results.push({
                  nested,
                  restoreLast,
                  pinnedKey,
                  inside,
                  immediate,
                  settled: chart.viewState.pinnedKey,
                  selected: f.latest.select?.key ?? null
                });
              }
            }
          }
          return results;
        }, input);
        for (const result of results) {
          const key =
            result.restoreLast || input === 'hover'
              ? result.pinnedKey
              : input === 'dismiss'
                ? null
                : `${family === 'metric' ? 'category' : family}:a`;
          expect(result).toMatchObject({
            inside: key,
            immediate: key,
            settled: key,
            selected: key
          });
        }
      });
    }

    test('relative navigation starts at the restored target before paint', async ({ page }) => {
      const result = await page.evaluate(async () => {
        const f = window.notificationFixture;
        const chart = f.chart!;
        f.key('End');
        f.key('Enter');
        const saved = chart.viewState;
        f.key('Home');
        if ('tooltipLocked' in chart) chart.tooltipLocked = true;
        chart.viewState = saved;
        const locked = 'tooltipLocked' in chart && chart.tooltipLocked;
        f.key('ArrowRight');
        f.key('Enter');
        const immediate = chart.viewState.pinnedKey;
        await f.settle();
        return { locked, immediate, settled: chart.viewState.pinnedKey };
      });
      const key = `${family === 'metric' ? 'category' : family}:a`;
      expect(result).toEqual({ locked: false, immediate: key, settled: key });
    });

    for (const lifecycle of ['hidden', 'loading', 'remount'] as const) {
      test(`restores a new snapshot while ${lifecycle} without consuming its pin on the old frame`, async ({
        page
      }) => {
        const result = await page.evaluate(async (lifecycle) => {
          const f = window.notificationFixture;
          const chart = f.chart!;
          if (lifecycle === 'hidden') chart.style.display = 'none';
          else if (lifecycle === 'loading') chart.loading = true;
          else chart.remove();
          await f.settle();
          await f.replace('300', false, false, 'new');
          const key = `${f.entry.family === 'metric' ? 'category' : f.entry.family}:new`;
          chart.viewState = { ...chart.viewState, pinnedKey: key };
          await f.settle();
          const waiting = chart.viewState.pinnedKey;
          if (lifecycle === 'hidden') chart.style.display = '';
          else if (lifecycle === 'loading') chart.loading = false;
          else f.host.append(chart);
          await f.settle();
          const module = '/tests/browser/fixtures/inspection-matrix.ts';
          const { inspectionValue }: typeof import('./fixtures/inspection-matrix.js') =
            await import(module);
          return {
            waiting,
            settled: chart.viewState.pinnedKey,
            selected: f.latest.select?.key,
            value: inspectionValue(f.latest.select)
          };
        }, lifecycle);
        const key = `${family === 'metric' ? 'category' : family}:new`;
        expect(result).toEqual({ waiting: key, settled: key, selected: key, value: '300' });
      });
    }
  });
}
