import { test, expect } from '@playwright/test';
import type { ScopeChartElement } from '../../src/element.js';
import { inspectionEntries } from './fixtures/inspection-matrix.js';

for (const entry of inspectionEntries) {
  test(`${entry.name} commits data before a popover effect can request a newer snapshot`, async ({
    page
  }) => {
    await page.goto('/tests/browser/fixtures/blank.html');
    const result = await page.evaluate(async (entry) => {
      const module = '/tests/browser/fixtures/inspection-matrix.ts';
      const {
        createInspectionFixture,
        inspectionValue
      }: typeof import('./fixtures/inspection-matrix.js') = await import(module);
      const f = await createInspectionFixture(entry);
      f.key('Home');
      const tooltip = f.root.querySelector<HTMLElement>('.tooltip')!;
      const floating = tooltip.matches(':popover-open');
      const previous = f.latest.inspect;
      let replaced = false;
      tooltip.addEventListener('beforetoggle', (event) => {
        if (replaced || (event as ToggleEvent).newState !== 'closed') return;
        replaced = true;
        void f.replace('300', false);
      });
      f.events.length = 0;
      await f.replace('200', false);
      await f.settle();
      f.key('Home');
      return {
        floating,
        replaced,
        current: inspectionValue(f.latest.inspect),
        changedSnapshot: previous?.snapshotId !== f.latest.inspect?.snapshotId,
        values: f.events.map((event) => inspectionValue(event.context))
      };
    }, entry);
    expect(result.floating).toBe(true);
    expect(result.replaced).toBe(true);
    expect(result.current).toBe('300');
    expect(result.changedSnapshot).toBe(true);
    expect(result.values).not.toContain('200');
  });
}

test('metric document cleanup observes committed data and cannot overwrite a nested replacement', async ({
  page
}) => {
  await page.goto('/tests/browser/fixtures/blank.html');
  const result = await page.evaluate(async () => {
    const module = '/tests/browser/fixtures/inspection-matrix.ts';
    const {
      createInspectionFixture,
      inspectionValue
    }: typeof import('./fixtures/inspection-matrix.js') = await import(module);
    const f = await createInspectionFixture({
      name: 'range cleanup',
      family: 'metric',
      surface: 'component'
    });
    const chart = f.chart as ScopeChartElement;
    let armed = false,
      observed: unknown;
    chart.rangeSelection = {
      snapshot: {},
      value: null,
      onCommit() {},
      onPreview() {
        if (!armed) return;
        armed = false;
        observed = {
          value: chart.document?.data.rows[0][1],
          cleared: chart.rangeSelection === null
        };
        void f.replace('300', false);
      }
    };
    armed = true;
    f.events.length = 0;
    await f.replace('200', false);
    await f.settle();
    f.key('Home');
    return {
      observed,
      current: inspectionValue(f.latest.inspect),
      values: f.events.map((event) => inspectionValue(event.context))
    };
  });
  expect(result.observed).toEqual({ value: '200', cleared: true });
  expect(result.current).toBe('300');
  expect(result.values).not.toContain('200');
});

for (const action of ['dispose', 'throw'] as const) {
  test(`pending HTML replacement respects ${action} during its notification handoff`, async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/tests/browser/fixtures/blank.html');
    const result = await page.evaluate(async (action) => {
      const module = '/tests/browser/fixtures/inspection-matrix.ts';
      const {
        createInspectionFixture,
        inspectionValue
      }: typeof import('./fixtures/inspection-matrix.js') = await import(module);
      const f = await createInspectionFixture({
        name: 'retirement',
        family: 'metric',
        surface: 'direct',
        module: 'chart'
      });
      f.pin();
      let retiring = false;
      f.hook = (notification) => {
        if (notification.channel !== 'select') return;
        if (!retiring && inspectionValue(notification.context) === '200') {
          retiring = true;
          f.view!.update({
            version: 1,
            data: { fields: [{ name: 'value', data_type: 'number' }], rows: [['7']] },
            spec: { visualization: 'big-number', encoding: { values: ['value'] } }
          });
          if (action === 'dispose') {
            f.events.length = 0;
            f.dispose();
          }
        } else if (retiring && !notification.context && action === 'throw')
          throw new Error('Retirement observer failure');
      };
      await f.replace('200');
      await f.settle();
      const element = f.host.querySelector('.scopeview-view');
      return {
        retiring,
        mounted: !!element,
        value: element?.shadowRoot?.querySelector('.value-number')?.textContent ?? null,
        latest: f.latest,
        events: f.events
      };
    }, action);
    expect(result.retiring).toBe(true);
    expect(errors).toEqual(action === 'throw' ? ['Retirement observer failure'] : []);
    expect(result.mounted).toBe(action === 'throw');
    expect(result.value).toBe(action === 'throw' ? '7' : null);
    if (action === 'dispose') expect(result.events).toEqual([]);
    else expect(result.latest).toEqual({ inspect: null, select: null });
  });
}

for (const entry of inspectionEntries.filter(
  (entry) => entry.family === 'metric' && entry.surface === 'direct'
)) {
  test(`${entry.name} keeps detached facade methods and its own theme accessor compatible`, async ({
    page
  }) => {
    await page.goto('/tests/browser/fixtures/blank.html');
    const result = await page.evaluate(async (entry) => {
      const module = '/tests/browser/fixtures/inspection-matrix.ts';
      const {
        createInspectionFixture,
        inspectionDocument,
        inspectionValue
      }: typeof import('./fixtures/inspection-matrix.js') = await import(module);
      const f = await createInspectionFixture(entry);
      const view = f.view!;
      const { update, refresh, dispose } = view;
      update(inspectionDocument(entry, '200'));
      view.theme = 'dark';
      refresh();
      await f.settle();
      f.key('Home');
      const result = {
        value: inspectionValue(f.latest.inspect),
        theme: view.theme,
        ownTheme: Object.prototype.propertyIsEnumerable.call(view, 'theme')
      };
      dispose();
      return { ...result, removed: !f.host.querySelector('.scopeview-view') };
    }, entry);
    expect(result).toEqual({ value: '200', theme: 'dark', ownTheme: true, removed: true });
  });
}
