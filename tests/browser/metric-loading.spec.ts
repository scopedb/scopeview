import { test, expect } from '@playwright/test';
import type { ReportView } from '../../src/report.js';
import { settleRendering } from './scene.js';

function metric(type: string, label = 'Alpha') {
  return {
    version: 1,
    data: {
      fields: [
        { name: 'Category', data_type: 'string' },
        { name: 'Value', data_type: 'number' },
        { name: 'X', data_type: 'number' }
      ],
      rows: [
        [label, '9007199254740993', '1'],
        ['Beta', '12', '1.5'],
        ['Zero', '0', '2']
      ]
    },
    spec: {
      visualization: type === 'donut' ? 'pie' : type === 'horizontal' ? 'bar' : type,
      encoding:
        type === 'scatter'
          ? { x: 'X', y: 'Value', color: 'Category' }
          : ['donut', 'treemap', 'top-list'].includes(type)
            ? { category: 'Category', value: 'Value' }
            : { x: 'Category', y: ['Value'] }
    },
    ...(type === 'horizontal' ? { options: { orientation: 'horizontal' } } : {})
  };
}

declare global {
  interface Window {
    metricLoading: { view: ReportView; pending?: Promise<string>; controller?: AbortController };
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/fixtures/blank.html');
});

test('fixed axis entry keeps other layouts out and rejects unsupported updates', async ({
  page
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.evaluate(
    async ({ entry, input }) => {
      const { createChart } = await import(entry);
      const host = document.createElement('div');
      host.id = 'metric';
      host.style.width = '500px';
      host.innerHTML = '<p id="owned-by-report">Report text</p>';
      document.body.append(host);
      window.metricLoading = { view: createChart(host, input) };
    },
    { entry: '/dist/chart-axis.js', input: metric('line') }
  );
  const canvas = page.locator('#metric .canvas');
  const tooltip = page.locator('#metric .tooltip');
  for (const type of ['line', 'bar', 'area']) {
    await page.evaluate((input) => window.metricLoading.view.update(input), metric(type));
    await settleRendering(page);
    await canvas.press('Home');
    await expect(tooltip).toContainText('9,007,199,254,740,993');
  }
  expect(
    await page.evaluate((input) => {
      try {
        window.metricLoading.view.update(input);
        return '';
      } catch (error) {
        return String(error);
      }
    }, metric('scatter'))
  ).toContain('supports axis');
  await expect(tooltip).toContainText('9,007,199,254,740,993');
  const invalid = metric('line');
  invalid.data.rows[0][1] = 'not a number';
  expect(
    await page.evaluate((input) => {
      try {
        window.metricLoading.view.update(input);
        return '';
      } catch (error) {
        return String(error);
      }
    }, invalid)
  ).toContain('data.rows[0][1]');
  await expect(tooltip).toContainText('9,007,199,254,740,993');
  expect(
    requests.filter((url) =>
      /layout-(?:scatter|donut|top-list|treemap)|report-chart|viewport-controller/.test(url)
    )
  ).toEqual([]);
  await page.evaluate(() => window.metricLoading.view.dispose());
  await expect(page.locator('#metric .scopeview-view')).toHaveCount(0);
  await expect(page.locator('#owned-by-report')).toHaveText('Report text');
});

test('automatic reports fetch metric layouts only when requested', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.evaluate(
    async ({ entry, input }) => {
      const { createReport } = await import(entry);
      const host = document.createElement('div');
      host.id = 'metric';
      host.style.width = '500px';
      document.body.append(host);
      window.metricLoading = { view: await createReport(host, input) };
    },
    { entry: '/dist/report.js', input: metric('line') }
  );
  const canvas = page.locator('#metric .canvas');
  const tooltip = page.locator('#metric .tooltip');
  await expect(page.locator('#metric .scopeview-view')).toHaveAttribute('data-state', 'ready');
  expect(requests.filter((url) => /layout-(?:scatter|donut|top-list|treemap)/.test(url))).toEqual(
    []
  );
  for (const type of ['scatter', 'treemap', 'donut', 'top-list', 'horizontal', 'bar']) {
    const before = requests.length;
    await page.evaluate((input) => window.metricLoading.view.update(input), metric(type));
    await settleRendering(page);
    await canvas.press('Home');
    await expect(tooltip).toContainText('9,007,199,254,740,993');
    if (['scatter', 'treemap', 'donut', 'top-list'].includes(type))
      expect(requests.slice(before).some((url) => url.includes(`layout-${type}`))).toBe(true);
  }
  const requestCount = requests.length;
  await page.evaluate((input) => window.metricLoading.view.update(input), metric('scatter'));
  await settleRendering(page);
  await canvas.press('Home');
  await expect(tooltip).toContainText('9,007,199,254,740,993');
  expect(requests.length).toBe(requestCount);
  const mounted = page.locator('#metric .scopeview-view');
  await expect(mounted).toHaveCount(1);
  expect(
    await page.evaluate(async () => {
      try {
        await window.metricLoading.view.update({});
        return false;
      } catch {
        return true;
      }
    })
  ).toBe(true);
  await expect(tooltip).toContainText('9,007,199,254,740,993');
  await page.evaluate(() => window.metricLoading.view.dispose());
  await expect(mounted).toHaveCount(0);
});

for (const [entry, type] of [
  ['scatter', 'scatter'],
  ['donut', 'donut'],
  ['treemap', 'treemap'],
  ['top-list', 'horizontal']
]) {
  test(`independent ${entry} entry mounts exact readings without other metric layouts`, async ({
    page
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.evaluate(
      async ({ entry, input }) => {
        const { createChart } = await import(entry);
        const host = document.createElement('div');
        host.id = 'metric';
        host.style.width = '500px';
        document.body.append(host);
        window.metricLoading = { view: createChart(host, input) };
      },
      { entry: `/dist/chart-${entry}.js`, input: metric(type) }
    );
    const canvas = page.locator('#metric .canvas');
    await expect(canvas).toHaveAttribute('tabindex', '0');
    await canvas.press('Home');
    await expect(page.locator('#metric .tooltip')).toContainText('9,007,199,254,740,993');
    expect(
      requests.flatMap((url) => {
        const kind = url.match(/layout-(axis|scatter|donut|top-list|treemap)[.-]/)?.[1];
        return kind && kind !== entry ? [kind] : [];
      })
    ).toEqual([]);
  });
}

for (const action of ['snapshot', 'supersede', 'dispose', 'fail', 'abort-mount']) {
  test(`a pending metric download is safe to ${action}`, async ({ page }) => {
    let release!: () => void;
    let requested!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const download = new Promise<void>((resolve) => (requested = resolve));
    await page.route(/\/layout-scatter[.-]/, async (route) => {
      requested();
      await held;
      if (action === 'fail') await route.abort('failed');
      else await route.continue();
    });
    await page.evaluate(
      async ({ initial, next, action, entry }) => {
        const { createReport } = await import(entry);
        const host = document.createElement('div');
        host.id = 'metric';
        host.style.width = '500px';
        host.innerHTML = '<p id="owned-by-report">Report text</p>';
        document.body.append(host);
        const view = await createReport(host, initial);
        window.metricLoading = { view };
        if (action === 'abort-mount') {
          const controller = new AbortController();
          window.metricLoading.controller = controller;
          window.metricLoading.pending = createReport(host, next, {
            signal: controller.signal
          }).then(
            () => 'mounted',
            (error: Error) => error.name
          );
        } else {
          window.metricLoading.pending = view.update(next).then(
            () => 'updated',
            (error: Error) => error.name
          );
          next.data.rows[0][0] = 'Mutated after update';
        }
      },
      { initial: metric('line'), next: metric('scatter'), action, entry: '/dist/report.js' }
    );
    await download;
    const canvas = page.locator('#metric .canvas');
    const tooltip = page.locator('#metric .tooltip');
    // The reading model and keyboard target are installed by the first animation frame.
    await expect(canvas).toHaveAttribute('tabindex', '0');
    await canvas.press('Home');
    await expect(tooltip).toContainText('Alpha');
    if (action === 'supersede')
      await page.evaluate((input) => window.metricLoading.view.update(input), metric('bar', 'New'));
    if (action === 'dispose') await page.evaluate(() => window.metricLoading.view.dispose());
    if (action === 'abort-mount')
      await page.evaluate(() => window.metricLoading.controller!.abort());
    release();
    const result = await page.evaluate(() => window.metricLoading.pending);
    await settleRendering(page);
    if (action === 'dispose' || action === 'abort-mount') expect(result).toBe('AbortError');
    if (action === 'fail') expect(result).toBe('TypeError');
    if (action === 'supersede' || action === 'snapshot') expect(result).toBe('updated');
    await expect(page.locator('#owned-by-report')).toHaveText('Report text');
    if (action === 'dispose') {
      await expect(page.locator('#metric .scopeview-view')).toHaveCount(0);
    } else {
      await expect(page.locator('#metric .scopeview-view')).toHaveCount(1);
      await canvas.press('Home');
      await expect(tooltip).toContainText(action === 'supersede' ? 'New' : 'Alpha');
      if (action === 'fail') {
        await page.evaluate(
          (input) => window.metricLoading.view.update(input),
          metric('bar', 'New')
        );
        await settleRendering(page);
        await canvas.press('Home');
        await expect(tooltip).toContainText('New');
      }
    }
  });
}
