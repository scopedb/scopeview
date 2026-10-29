import { test, expect } from '@playwright/test';
import { inspectionEntries, inspectionValue } from './fixtures/inspection-matrix.js';

for (const entry of inspectionEntries) {
  test.describe(entry.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/tests/browser/fixtures/blank.html');
      await page.evaluate(async (entry) => {
        const module = '/tests/browser/fixtures/inspection-matrix.ts';
        const { createInspectionFixture }: typeof import('./fixtures/inspection-matrix.js') =
          await import(module);
        window.notificationFixture = await createInspectionFixture(entry);
      }, entry);
    });

    test('pointer and keyboard deliver matching targets, exact snapshots and independent selections', async ({
      page
    }) => {
      const point = await page.evaluate(() => window.notificationFixture.point());
      await page.mouse.move(point.x, point.y);
      const hovered = await page.evaluate(() => window.notificationFixture.latest);
      expect(hovered.inspect?.key).toBe(point.key);
      expect(inspectionValue(hovered.inspect)).toBe('100');
      expect(hovered.select).toBeNull();
      await page.mouse.click(point.x, point.y);
      const previous = await page.evaluate(() => window.notificationFixture.latest.select);
      expect(previous).toEqual(hovered.inspect);
      const result = await page.evaluate(async () => {
        const f = window.notificationFixture;
        f.events.length = 0;
        f.repaint();
        await f.settle();
        const repaint = f.events.splice(0);
        // Keyboard selects the same first target before replacement, independent of pointer leave.
        f.key('Home');
        f.key('Enter');
        f.events.length = 0;
        await f.replace('9007199254740993');
        await f.settle();
        const selected = f.latest.select;
        f.key('End');
        const navigated = { ...f.latest };
        f.key('Escape');
        return { repaint, selected, navigated, cleared: f.latest, hidden: f.tooltipHidden };
      });
      expect(result.repaint).toEqual([]);
      expect(result.selected?.key).toBe(previous?.key);
      expect(result.selected?.snapshotId).not.toBe(previous?.snapshotId);
      expect(inspectionValue(result.selected)).toBe('9007199254740993');
      expect(result.navigated.select).toBeNull();
      expect(result.navigated.inspect?.key).not.toBe(previous?.key);
      expect(result.cleared).toEqual({ inspect: null, select: null });
      expect(result.hidden).toBe(true);
      expect(inspectionValue(previous)).toBe('100');
    });

    for (const channel of ['inspect', 'select'] as const) {
      test(`${channel} callback dismissal cancels pending notifications and tooltip work`, async ({
        page
      }) => {
        const result = await page.evaluate(async (channel) => {
          const f = window.notificationFixture;
          const module = '/tests/browser/fixtures/inspection-matrix.ts';
          const { inspectionValue }: typeof import('./fixtures/inspection-matrix.js') =
            await import(module);
          f.pin();
          f.events.length = 0;
          let handled = false;
          let dismissedAt = 0;
          f.hook = (notification) => {
            if (
              handled ||
              notification.channel !== channel ||
              inspectionValue(notification.context) !== '200'
            )
              return;
            handled = true;
            dismissedAt = f.events.length;
            f.dismiss();
          };
          await f.replace('200');
          await f.settle();
          await f.settle();
          const events = f.events.splice(0);
          f.repaint();
          await f.settle();
          return {
            handled,
            events: events.slice(dismissedAt),
            repeated: f.events,
            latest: f.latest,
            hidden: f.tooltipHidden
          };
        }, channel);
        expect(result.handled).toBe(true);
        expect(result.latest).toEqual({ inspect: null, select: null });
        expect(result.hidden).toBe(true);
        for (const name of ['inspect', 'select']) {
          const notifications = result.events.filter((event) => event.channel === name);
          const clear = notifications.findIndex((event) => event.context === null);
          if (clear !== -1)
            expect(notifications.slice(clear).every((event) => !event.context)).toBe(true);
        }
        expect(result.repeated).toEqual([]);
      });

      test(`${channel} callback replacement supersedes the earlier snapshot`, async ({ page }) => {
        const result = await page.evaluate(async (channel) => {
          const f = window.notificationFixture;
          const module = '/tests/browser/fixtures/inspection-matrix.ts';
          const { inspectionValue }: typeof import('./fixtures/inspection-matrix.js') =
            await import(module);
          f.pin();
          f.events.length = 0;
          let replacement: Promise<void> | undefined;
          f.hook = (notification) => {
            if (
              !replacement &&
              notification.channel === channel &&
              inspectionValue(notification.context) === '200'
            )
              replacement = f.replace('300');
          };
          await f.replace('200');
          await f.settle();
          await replacement;
          await f.settle();
          return {
            latest: f.latest,
            values: f.events.map((event) => ({
              channel: event.channel,
              value: inspectionValue(event.context)
            }))
          };
        }, channel);
        expect(inspectionValue(result.latest.select)).toBe('300');
        for (const name of ['inspect', 'select']) {
          const values = result.values
            .filter((event) => event.channel === name)
            .map((event) => event.value);
          const replacement = values.indexOf('300');
          expect(replacement).toBeGreaterThanOrEqual(0);
          expect(values.slice(replacement)).not.toContain('200');
        }
      });
    }

    test('refresh or pointer leave in a callback preserves a pending selection', async ({
      page
    }) => {
      const result = await page.evaluate(async () => {
        const f = window.notificationFixture;
        f.pin();
        const module = '/tests/browser/fixtures/inspection-matrix.ts';
        const { inspectionValue }: typeof import('./fixtures/inspection-matrix.js') = await import(
          module
        );
        const selections = [];
        for (const action of ['refresh', 'leave']) {
          let handled = false;
          f.hook = (notification) => {
            if (
              handled ||
              notification.channel !== 'inspect' ||
              inspectionValue(notification.context) !== (action === 'refresh' ? '200' : '300')
            )
              return;
            handled = true;
            if (action === 'refresh') f.repaint();
            else f.leave();
          };
          await f.replace(action === 'refresh' ? '200' : '300');
          await f.settle();
          selections.push({ handled, selected: f.latest.select });
        }
        return selections;
      });
      expect(result.map((state) => state.handled)).toEqual([true, true]);
      expect(result.map((state) => inspectionValue(state.selected))).toEqual(['200', '300']);
    });

    test('empty data clears once and disposal inside a callback cancels pending work', async ({
      page
    }) => {
      const result = await page.evaluate(async () => {
        const f = window.notificationFixture;
        const module = '/tests/browser/fixtures/inspection-matrix.ts';
        const { inspectionValue }: typeof import('./fixtures/inspection-matrix.js') = await import(
          module
        );
        f.pin();
        f.events.length = 0;
        await f.replace('0', true, true);
        await f.settle();
        const empty = f.events.splice(0);
        await f.replace('100');
        await f.settle();
        f.pin();
        f.events.length = 0;
        let disposed = false;
        f.hook = (notification) => {
          if (
            !disposed &&
            notification.context &&
            inspectionValue(notification.context) === '200'
          ) {
            disposed = true;
            f.dispose();
          }
        };
        await f.replace('200');
        await f.settle();
        const disposal = f.events.splice(0);
        f.key('Home');
        f.leave();
        await f.settle();
        return {
          empty,
          disposed,
          disposal,
          repeated: f.events,
          connected: !!f.host.querySelector('canvas')
        };
      });
      expect(
        result.empty.filter((event) => event.channel === 'select').map((event) => event.context)
      ).toEqual([null]);
      expect(result.empty.every((event) => event.context === null)).toBe(true);
      expect(result.disposed).toBe(true);
      expect(result.disposal.filter((event) => event.context !== null)).toHaveLength(1);
      expect(result.repeated).toEqual([]);
      expect(result.connected).toBe(false);
    });

    test('invalid updates preserve headless evidence and clear component evidence', async ({
      page
    }) => {
      const result = await page.evaluate(async () => {
        const f = window.notificationFixture;
        f.pin();
        const previous = f.latest.select;
        f.events.length = 0;
        let rejected = false;
        try {
          if (f.chart) f.chart.document = { version: 99 };
          else await f.view!.update({ version: 99 });
        } catch {
          rejected = true;
        }
        await f.settle();
        return { rejected, previous, latest: f.latest, events: f.events, hidden: f.tooltipHidden };
      });
      if (entry.surface === 'component') {
        expect(result.rejected).toBe(false);
        expect(result.latest).toEqual({ inspect: null, select: null });
        expect(result.events.map((event) => [event.channel, event.context])).toEqual([
          ['inspect', null],
          ['select', null]
        ]);
        expect(result.hidden).toBe(true);
      } else {
        expect(result.rejected).toBe(true);
        expect(result.latest.select).toEqual(result.previous);
        expect(result.events).toEqual([]);
      }
    });

    if (entry.family === 'metric' && !entry.layout) {
      test('HTML aggregate transitions clear once and respect a replacement from the clear callback', async ({
        page
      }) => {
        const result = await page.evaluate(async () => {
          const f = window.notificationFixture;
          const scalar = {
            version: 1,
            data: { fields: [{ name: 'value', data_type: 'number' }], rows: [['7']] },
            spec: { visualization: 'big-number', encoding: { values: ['value'] } }
          };
          const aggregate = async () => {
            if (f.chart) f.chart.document = scalar;
            else await f.view!.update(scalar);
            await f.settle();
          };
          f.pin();
          f.events.length = 0;
          await aggregate();
          const cleared = f.events.splice(0);
          const htmlOnly =
            !f.host.querySelector('.scopeview-view')?.shadowRoot?.querySelector('canvas') &&
            !f.chart?.shadowRoot?.querySelector('canvas');
          await f.replace('100');
          await f.settle();
          if (f.view) {
            const module = '/src/interactions.ts';
            const { enableInteractions } = await import(module);
            enableInteractions(f.view);
          }
          const key = (key: string) => {
            const root = f.chart?.shadowRoot ?? f.host.querySelector('.scopeview-view')!.shadowRoot;
            root!
              .querySelector(f.chart ? '.viewport' : '.canvas')!
              .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
          };
          key('Home');
          key('Enter');
          f.events.length = 0;
          let replacement: Promise<void> | undefined;
          let replacing = false;
          f.hook = (notification) => {
            if (!replacing && notification.context === null) {
              replacing = true;
              replacement = f.replace('300');
            }
          };
          await aggregate();
          await replacement;
          await f.settle();
          key('Home');
          return {
            htmlOnly,
            cleared,
            replaced: !!replacement,
            inspected: f.latest.inspect,
            events: f.events
          };
        });
        expect(result.htmlOnly).toBe(true);
        expect(
          result.cleared.filter((event) => event.channel === 'select').map((event) => event.context)
        ).toEqual([null]);
        expect(result.cleared.every((event) => event.context === null)).toBe(true);
        expect(result.replaced).toBe(true);
        expect(inspectionValue(result.inspected)).toBe('300');
        expect(
          result.events.every((event) => !event.context || inspectionValue(event.context) === '300')
        ).toBe(true);
      });
    }

    if (entry.surface === 'component') {
      for (const channel of ['inspect', 'select'] as const) {
        test(`independent ${channel} listeners receive a nested dismissal in broadcast order`, async ({
          page
        }) => {
          const result = await page.evaluate(async (channel) => {
            const f = window.notificationFixture;
            const module = '/tests/browser/fixtures/inspection-matrix.ts';
            const { inspectionValue }: typeof import('./fixtures/inspection-matrix.js') =
              await import(module);
            f.pin();
            const early: (string | null)[] = [];
            const late: (string | null)[] = [];
            let dismissed = false;
            f.chart!.addEventListener(`scope-${channel}`, (event) => {
              const context = (
                event as CustomEvent<{ context: Parameters<typeof inspectionValue>[0] }>
              ).detail.context;
              const value = inspectionValue(context);
              early.push(value);
              if (!dismissed && value === '200') {
                dismissed = true;
                f.dismiss();
              }
            });
            // A delegated host listener must observe the same order as the component listener.
            f.host.addEventListener(`scope-${channel}`, (event) => {
              const context = (
                event as CustomEvent<{ context: Parameters<typeof inspectionValue>[0] }>
              ).detail.context;
              late.push(inspectionValue(context));
            });
            await f.replace('200');
            await f.settle();
            f.repaint();
            await f.settle();
            return {
              dismissed,
              early,
              late,
              latest: f.latest,
              pin: f.chart!.viewState.pinnedKey,
              hidden: f.tooltipHidden
            };
          }, channel);
          expect(result.dismissed).toBe(true);
          expect(result.early).toEqual(['200', null]);
          expect(result.late).toEqual(result.early);
          expect(result.latest).toEqual({ inspect: null, select: null });
          expect(result.pin).toBeNull();
          expect(result.hidden).toBe(true);
        });
      }

      test('state restoration, host actions and immediate pin dismissal use the same notifications', async ({
        page
      }) => {
        const result = await page.evaluate(async () => {
          const f = window.notificationFixture;
          f.pin();
          const state = f.chart!.viewState;
          const previous = f.latest.select;
          f.key('Escape');
          f.chart!.viewState = state;
          await f.settle();
          const restored = f.latest.select;
          f.key('Escape');
          f.chart!.performAction('inspect');
          const action = f.latest.inspect;
          const selectedByAction = f.latest.select;
          f.events.length = 0;
          f.chart!.addEventListener('scope-inspect', (event) => {
            if ((event as CustomEvent<{ pinned: boolean }>).detail.pinned) f.dismiss();
          });
          f.key('Enter');
          await f.settle();
          return {
            previous,
            restored,
            action,
            selectedByAction,
            latest: f.latest,
            events: f.events,
            hidden: f.tooltipHidden
          };
        });
        expect(result.restored).toEqual(result.previous);
        expect(result.action?.key).toBe(result.previous?.key);
        expect(result.selectedByAction).toBeNull();
        expect(result.latest).toEqual({ inspect: null, select: null });
        expect(result.events.filter((event) => event.channel === 'select')).toEqual([]);
        expect(result.hidden).toBe(true);
      });

      test('controls callbacks can dismiss before delivery without restoring stale UI', async ({
        page
      }) => {
        const result = await page.evaluate(async () => {
          const f = window.notificationFixture;
          const module = '/tests/browser/fixtures/inspection-matrix.ts';
          const { inspectionValue }: typeof import('./fixtures/inspection-matrix.js') =
            await import(module);
          f.pin();
          f.events.length = 0;
          let armed = false;
          let controls = 0;
          f.chart!.addEventListener('scope-controls-change', () => {
            if (armed) {
              controls++;
              f.dismiss();
            }
          });
          f.hook = (notification) => {
            if (
              !armed &&
              notification.channel === 'inspect' &&
              inspectionValue(notification.context) === '200'
            ) {
              armed = true;
              f.chart!.configure({ toolbar: { actions: ['inspect'] } });
            }
          };
          await f.replace('200');
          await f.settle();
          await f.settle();
          return { controls, latest: f.latest, events: f.events, hidden: f.tooltipHidden };
        });
        expect(result.controls).toBeGreaterThan(0);
        expect(result.latest).toEqual({ inspect: null, select: null });
        expect(result.hidden).toBe(true);
        expect(result.events.at(-1)?.context).toBeNull();
      });

      test('loading retains reported state across updates and dismisses it exactly once', async ({
        page
      }) => {
        const result = await page.evaluate(async () => {
          const f = window.notificationFixture;
          f.pin();
          const cycle = async (change: () => void | Promise<void>) => {
            f.events.length = 0;
            f.chart!.loading = true;
            await f.settle();
            const loading = f.events.splice(0);
            await change();
            f.chart!.loading = false;
            await f.settle();
            return { loading, after: f.events.splice(0), latest: { ...f.latest } };
          };
          const unchanged = await cycle(() => {});
          const replaced = await cycle(() => f.replace('200'));
          const removed = await cycle(() => f.replace('300', true, false, 'removed'));
          await f.replace('100');
          await f.settle();
          f.pin();
          const reset = await cycle(() => f.replace('200', false));
          f.pin();
          const coalesced = await cycle(async () => {
            await f.replace('300', false);
            await f.replace('400', false);
          });
          f.pin();
          const empty = await cycle(() => f.replace('0', true, true));
          await f.replace('100');
          await f.settle();
          f.pin();
          const failed = await cycle(() => {
            f.chart!.document = { version: 99 };
          });
          await f.replace('100');
          await f.settle();
          f.pin();
          const dismissed = await cycle(() => f.dismiss());
          f.dismiss();
          await f.settle();
          return {
            unchanged,
            replaced,
            removed,
            reset,
            coalesced,
            empty,
            failed,
            dismissed,
            repeated: f.events
          };
        });
        expect(result.unchanged.loading).toEqual([]);
        expect(result.unchanged.after).toEqual([]);
        expect(result.replaced.loading).toEqual([]);
        expect(inspectionValue(result.replaced.latest.select)).toBe('200');
        for (const state of [
          result.removed,
          result.reset,
          result.coalesced,
          result.empty,
          result.failed,
          result.dismissed
        ]) {
          expect(state.loading).toEqual([]);
          expect(state.latest).toEqual({ inspect: null, select: null });
          expect(state.after.map((event) => [event.channel, event.context])).toEqual([
            ['inspect', null],
            ['select', null]
          ]);
        }
        expect(result.repeated).toEqual([]);
      });

      for (const action of ['error', 'disconnect'] as const) {
        test(`loading dismissal through ${action} clears reported state once`, async ({ page }) => {
          const result = await page.evaluate(async (action) => {
            const f = window.notificationFixture;
            f.pin();
            f.events.length = 0;
            f.chart!.loading = true;
            await f.settle();
            const loading = f.events.splice(0);
            if (action === 'error') f.chart!.error = 'Unavailable';
            else f.chart!.remove();
            await f.settle();
            const cleared = f.events.splice(0);
            f.dismiss();
            f.chart!.refresh();
            await f.settle();
            return {
              loading,
              cleared,
              repeated: f.events,
              latest: f.latest,
              hidden: f.tooltipHidden
            };
          }, action);
          expect(result.loading).toEqual([]);
          expect(result.cleared.map((event) => [event.channel, event.context])).toEqual([
            ['inspect', null],
            ['select', null]
          ]);
          expect(result.repeated).toEqual([]);
          expect(result.latest).toEqual({ inspect: null, select: null });
          expect(result.hidden).toBe(true);
        });
      }
    }

    if (entry.family !== 'metric' && entry.surface !== 'component') {
      for (const selected of [false, true]) {
        test(`Enter commits ${selected ? 'unpinning' : 'pinning'} before navigation paints pending data`, async ({
          page
        }) => {
          const result = await page.evaluate(async (selected) => {
            const f = window.notificationFixture;
            const module = '/tests/browser/fixtures/inspection-matrix.ts';
            const { inspectionValue }: typeof import('./fixtures/inspection-matrix.js') =
              await import(module);
            if (selected) f.pin();
            else f.key('Home');
            f.events.length = 0;
            let dismissed = false;
            f.hook = (notification) => {
              if (
                !dismissed &&
                notification.channel === (selected ? 'select' : 'inspect') &&
                inspectionValue(notification.context) === '200'
              ) {
                dismissed = true;
                f.dismiss();
              }
            };
            await f.replace('200');
            // No settle: Enter navigates and synchronously paints the queued replacement.
            f.key('Enter');
            await f.settle();
            const events = f.events.splice(0);
            f.repaint();
            await f.settle();
            return {
              dismissed,
              events,
              repeated: f.events,
              latest: f.latest,
              hidden: f.tooltipHidden
            };
          }, selected);
          expect(result.dismissed).toBe(!selected);
          expect(result.latest).toEqual({ inspect: null, select: null });
          expect(result.hidden).toBe(true);
          expect(
            result.events.filter((event) => event.channel === 'select').at(-1)?.context
          ).toBeNull();
          expect(result.repeated).toEqual([]);
        });
      }
    }
  });
}
