import { expect, test } from '@playwright/test';
import type { ScopeChartElement, ScopeTraceElement, ScopeFlameElement } from '../../src/element.js';

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

    for (const restore of ['document', 'view-state', 'loading'] as const) {
      test(`Escape cancels a pending ${restore} pin restoration`, async ({ page }) => {
        const result = await page.evaluate(async (restore) => {
          const f = window.notificationFixture;
          f.pin();
          const state = f.chart!.viewState;
          f.events.length = 0;
          if (restore === 'document') await f.replace('200');
          else if (restore === 'view-state') f.chart!.viewState = state;
          else {
            f.chart!.loading = true;
            await f.settle();
          }
          f.key('Escape');
          const immediate = { ...f.latest, pin: f.chart!.viewState.pinnedKey };
          f.chart!.loading = false;
          await f.settle();
          return {
            immediate,
            latest: f.latest,
            pin: f.chart!.viewState.pinnedKey,
            events: f.events
          };
        }, restore);
        expect(result.immediate).toEqual({ inspect: null, select: null, pin: null });
        expect(result.latest).toEqual({ inspect: null, select: null });
        expect(result.pin).toBeNull();
        expect(result.events.map((event) => [event.channel, event.context])).toEqual([
          ['inspect', null],
          ['select', null]
        ]);
      });
    }

    if (family === 'metric') {
      for (const options of [
        { interactive: false },
        { presentation: 'sparkline' },
        { presentation: 'sparkline', interactive: true }
      ] as const) {
        for (const restore of ['view-state', 'document'] as const) {
          test(`${restore} restoration respects ${JSON.stringify(options)}`, async ({ page }) => {
            const enabled = 'interactive' in options && options.interactive === true;
            const result = await page.evaluate(
              async ({ options, restore }) => {
                const f = window.notificationFixture;
                const chart = f.chart as ScopeChartElement;
                f.pin();
                const saved = chart.viewState;
                const document = { ...chart.document!, options };
                f.events.length = 0;
                if (restore === 'view-state') {
                  chart.document = document;
                  await f.settle();
                  f.events.length = 0;
                  chart.viewState = saved;
                } else chart.updateDocument(document, { preserveViewState: true });
                // A host presentation call before paint must not expose a disabled reading.
                chart.tooltipLocked = true;
                const immediate = {
                  pin: chart.viewState.pinnedKey,
                  hidden: f.tooltipHidden,
                  locked: chart.tooltipLocked
                };
                await f.settle();
                const settled = {
                  pin: chart.viewState.pinnedKey,
                  selected: f.latest.select?.key ?? null,
                  hidden: f.tooltipHidden,
                  reported: f.events.filter((event) => event.key !== null).map((event) => event.key)
                };
                chart.updateDocument(
                  { ...document, options: { ...options, interactive: true } },
                  { preserveViewState: true }
                );
                await f.settle();
                return { immediate, settled, enabledAgain: chart.viewState.pinnedKey };
              },
              { options, restore }
            );
            const key = enabled ? 'category:a' : null;
            expect(result.settled).toMatchObject({ pin: key, selected: key, hidden: !enabled });
            expect(result.enabledAgain).toBe(key);
            if (!enabled) {
              expect(result.immediate).toEqual({ pin: null, hidden: true, locked: false });
              expect(result.settled.reported).toEqual([]);
            }
          });
        }
      }

      for (const restore of [false, true]) {
        test(`focused loading viewport handles Escape, nested restore=${restore}`, async ({
          page
        }) => {
          await page.evaluate(async (restore) => {
            const f = window.notificationFixture;
            const chart = f.chart as ScopeChartElement;
            chart.configure({ toolbar: false });
            await f.settle();
            f.input.focus();
            f.key('End');
            f.key('Enter');
            const saved = chart.viewState;
            f.pin();
            chart.loading = true;
            await f.settle();
            f.events.length = 0;
            if (restore)
              f.hook = ({ channel, key }) => {
                if (channel === 'inspect' && key === null) {
                  f.hook = undefined;
                  chart.viewState = saved;
                }
              };
          }, restore);
          expect(
            await page.evaluate(() => {
              const f = window.notificationFixture;
              return f.root.activeElement === f.input && !f.canvas.querySelector('canvas');
            })
          ).toBe(true);
          await page.keyboard.press('Escape');
          const result = await page.evaluate(async () => {
            const f = window.notificationFixture;
            const immediate = f.chart!.viewState.pinnedKey;
            f.chart!.loading = false;
            await f.settle();
            return {
              immediate,
              settled: f.chart!.viewState.pinnedKey,
              selected: f.latest.select?.key ?? null,
              events: f.events.map(({ channel, key }) => [channel, key])
            };
          });
          const key = restore ? 'category:b' : null;
          expect(result).toMatchObject({ immediate: key, settled: key, selected: key });
          if (!restore)
            expect(result.events).toEqual([
              ['inspect', null],
              ['select', null]
            ]);
        });
      }
    }

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
