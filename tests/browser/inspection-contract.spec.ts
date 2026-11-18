import { test, expect } from '@playwright/test';
import type { InspectionContext } from '../../src/index.js';
import type { ScopeInspectionDetail } from '../../src/element.js';
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
          const anchor = renderer.anchor.bind(renderer);
          renderer.anchor = (...args) => {
            const position = anchor(...args);
            if (!cancelled) {
              cancelled = true;
              tooltip.style.left = '19px';
              tooltip.style.top = '23px';
              outside.focus();
            }
            return position;
          };
          return renderer;
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

for (const adapter of ['wrapped', 'legacy'] as const) {
  test(`${adapter} renderer can reuse a scene while retaining completed-frame source ownership`, async ({
    page
  }) => {
    await page.goto('/tests/browser/fixtures/blank.html');
    const result = await page.evaluate(async (adapter) => {
      const entry = '/src/element.ts';
      const { ScopeChartElement }: typeof import('../../src/element.js') = await import(entry);
      const fixture = '/tests/browser/fixtures/inspection-matrix.ts';
      const { inspectionDocument }: typeof import('./fixtures/inspection-matrix.js') = await import(
        fixture
      );
      let reused = false;
      class ReusingChart extends ScopeChartElement {
        protected override async renderer() {
          const create = await super.renderer();
          return (...args: Parameters<typeof create>) => {
            const renderer = create(...args);
            const update = renderer.update.bind(renderer);
            renderer.update = (...args) => {
              const previous = renderer.model;
              update(...args);
              if (previous && renderer.model && previous !== renderer.model) {
                Object.assign(previous, renderer.model);
                renderer.model = previous;
                reused = true;
              }
            };
            const facade = {
              get model() {
                return renderer.model;
              },
              update: renderer.update,
              anchor: renderer.anchor.bind(renderer),
              focus: renderer.focus.bind(renderer),
              dispose: renderer.dispose.bind(renderer),
              linkedHighlight: null
            };
            // Wrappers may forward own properties; legacy adapters need only the public contract.
            return adapter === 'wrapped' ? Object.assign(facade, renderer) : facade;
          };
        }
      }
      customElements.define('scope-reusing-chart', ReusingChart);
      const chart = new ReusingChart();
      chart.style.cssText = 'width:600px;--scope-chart-height:240px';
      const settle = async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      };
      const replace = (value: string) => {
        chart.document = inspectionDocument(
          { name: 'reusing', family: 'metric', surface: 'component' },
          value
        );
      };
      const initial = new Promise((resolve) =>
        chart.addEventListener('scope-ready', resolve, { once: true })
      );
      document.body.append(chart);
      replace('100');
      await initial;
      await settle();
      const readings: ScopeInspectionDetail[] = [];
      let ready = 0;
      chart.addEventListener('scope-ready', () => ready++);
      chart.addEventListener('scope-inspect', (event) => {
        if (event.detail.key) readings.push(event.detail);
      });
      const inspect = () =>
        chart
          .shadowRoot!.querySelector('.viewport')!
          .dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      inspect();
      replace('200');
      await settle();
      inspect();
      const visibleReady = ready;
      let hiddenReady: number | null = null;
      if (adapter === 'wrapped') {
        chart.style.display = 'none';
        await settle();
        ready = 0;
        replace('300');
        await settle();
        hiddenReady = ready;
        const shown = new Promise((resolve) =>
          chart.addEventListener('scope-ready', resolve, { once: true })
        );
        chart.style.display = '';
        await shown;
        inspect();
      }
      // Read retained contexts only after later updates, including reuse of the scene object.
      return {
        reused,
        visibleReady,
        hiddenReady,
        readings: readings.map(({ rows, rowIndices, context }) => ({
          rows,
          rowIndices,
          source: context?.rows,
          snapshot: context?.snapshotId
        }))
      };
    }, adapter);
    expect(result.reused).toBe(true);
    expect(result.visibleReady).toBeGreaterThan(0);
    expect(result.hiddenReady).toBe(adapter === 'wrapped' ? 0 : null);
    const values = adapter === 'wrapped' ? ['100', '200', '300'] : ['100', '200'];
    expect(result.readings.map((reading) => reading.rows)).toEqual(
      values.map((value) => [['a', value]])
    );
    for (const reading of result.readings) {
      expect(reading.rowIndices).toEqual([0]);
      expect(reading.source).toEqual(reading.rows);
    }
    expect(new Set(result.readings.map((reading) => reading.snapshot)).size).toBe(values.length);
  });
}

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
