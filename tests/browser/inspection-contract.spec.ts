import { test, expect } from '@playwright/test';
import type { InspectionContext } from '../../src/index.js';
import { inspectionEntries, inspectionValue } from './fixtures/inspection-matrix.js';

test('metric presentation rejects an anchor result after its callback dismisses the reading', async ({
  page
}) => {
  await page.goto('/tests/browser/fixtures/blank.html');
  const result = await page.evaluate(async () => {
    const entry = '/src/element.ts';
    const { ScopeChartElement }: typeof import('../../src/element.js') = await import(entry);
    const fixture = '/tests/browser/fixtures/inspection-matrix.ts';
    const { inspectionDocument }: typeof import('./fixtures/inspection-matrix.js') = await import(
      fixture
    );
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    let cancelled = false;
    let tooltip: HTMLElement;
    class ReentrantChart extends ScopeChartElement {
      protected override async renderer() {
        const create = await super.renderer();
        return (...args: Parameters<typeof create>) => {
          const renderer = create(...args);
          return new Proxy(renderer, {
            get(target, key) {
              if (key === 'anchor')
                return (...args: Parameters<typeof renderer.anchor>) => {
                  const anchor = target.anchor(...args);
                  if (!cancelled) {
                    cancelled = true;
                    tooltip.style.left = '19px';
                    tooltip.style.top = '23px';
                    outside.focus();
                  }
                  return anchor;
                };
              const value = Reflect.get(target, key, target);
              return typeof value === 'function' ? value.bind(target) : value;
            },
            set(target, key, value) {
              return Reflect.set(target, key, value, target);
            }
          });
        };
      }
    }
    customElements.define('scope-contract-chart', ReentrantChart);
    const chart = new ReentrantChart();
    chart.style.cssText = 'width:600px;--scope-chart-height:240px';
    document.body.append(outside, chart);
    const ready = new Promise((resolve, reject) => {
      chart.addEventListener('scope-ready', resolve, { once: true });
      chart.addEventListener('scope-error', (event) => reject(new Error(event.detail.message)), {
        once: true
      });
    });
    chart.document = inspectionDocument(
      { name: 'anchor', family: 'metric', surface: 'component' },
      '100'
    );
    await ready;
    const root = chart.shadowRoot!;
    tooltip = root.querySelector<HTMLElement>('.tooltip')!;
    let openings = 0;
    tooltip.addEventListener('beforetoggle', (event) => {
      if (cancelled && (event as ToggleEvent).newState === 'open') openings++;
    });
    const keys: (string | null)[] = [];
    chart.addEventListener('scope-inspect', (event) => keys.push(event.detail.key));
    root
      .querySelector('.viewport')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    return {
      cancelled,
      openings,
      hidden: tooltip.hidden,
      left: tooltip.style.left,
      top: tooltip.style.top,
      live: root.querySelector('.live')!.textContent,
      keys
    };
  });
  expect(result.cancelled).toBe(true);
  expect(result.openings).toBe(0);
  expect(result.hidden).toBe(true);
  expect(result.left).toBe('19px');
  expect(result.top).toBe('23px');
  expect(result.live).toBe('');
  expect(result.keys.every((key) => key === null)).toBe(true);
});

for (const entry of inspectionEntries.filter((entry) => entry.surface === 'component')) {
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
    test('waits for the replacement frame before reporting ready from a hidden container', async ({
      page
    }) => {
      const result = await page.evaluate(async () => {
        const f = window.notificationFixture;
        f.key('Home');
        const previous = f.latest.inspect?.snapshotId;
        f.host.style.display = 'none';
        await f.settle();
        let ready = 0;
        f.chart!.addEventListener('scope-ready', () => ready++);
        await f.replace('200', false);
        await f.settle();
        const hiddenReady = ready;
        const shown = new Promise((resolve) =>
          f.chart!.addEventListener('scope-ready', resolve, { once: true })
        );
        f.host.style.display = '';
        await shown;
        f.key('Home');
        return {
          hiddenReady,
          ready,
          context: f.latest.inspect,
          distinctSnapshot: previous !== f.latest.inspect?.snapshotId
        };
      });
      expect(result.hiddenReady).toBe(0);
      expect(result.ready).toBeGreaterThan(0);
      expect(inspectionValue(result.context)).toBe('200');
      expect(result.distinctSnapshot).toBe(true);
    });

    test('broadcasts one captured selection while getters expose the nested document', async ({
      page
    }) => {
      const result = await page.evaluate(async () => {
        const f = window.notificationFixture;
        const chart = f.chart!;
        const module = '/tests/browser/fixtures/inspection-matrix.ts';
        const { inspectionValue }: typeof import('./fixtures/inspection-matrix.js') = await import(
          module
        );
        const currentValue = () => {
          const doc = chart.document!;
          return 'data' in doc
            ? doc.data.rows[0][1]
            : 'spans' in doc
              ? doc.spans[0].endTimeNs
              : doc.frames[0].selfWeight;
        };
        const observed: { listener: number; value: string | null; current: string | null }[] = [];
        const afterSetter: (string | null)[] = [];
        let replacement: Promise<void> | undefined;
        for (const listener of [1, 2])
          chart.addEventListener('scope-select', (event) => {
            const { context } = (event as CustomEvent<{ context: InspectionContext | null }>)
              .detail;
            if (!context) return;
            const value = inspectionValue(context);
            observed.push({ listener, value, current: currentValue() });
            if (listener === 1 && value === '100') {
              replacement = f.replace('200');
              afterSetter.push(currentValue());
            }
          });
        f.pin();
        await replacement;
        await f.settle();
        return { observed, afterSetter };
      });
      expect(result).toEqual({
        observed: [
          { listener: 1, value: '100', current: '100' },
          { listener: 2, value: '100', current: '200' },
          { listener: 1, value: '200', current: '200' },
          { listener: 2, value: '200', current: '200' }
        ],
        afterSetter: ['200']
      });
    });
  });
}
