import { expect, test } from '@playwright/test';
import { createEmbed } from '../../node/embed.mjs';
import type { ChartDocumentInput } from '../../src/index.js';

const chartDocument: ChartDocumentInput = {
  version: 1,
  title: 'Requests by service',
  description: 'Saved fixture · requests · UTC',
  data: {
    fields: [
      { name: 'service', data_type: 'string' },
      { name: 'requests', data_type: 'number' }
    ],
    rows: [
      ['api', '9007199254740993'],
      ['zero', '0'],
      ['missing', null]
    ]
  },
  spec: {
    visualization: 'bar',
    encoding: { x: 'service', y: ['requests'] }
  }
};
const escapeAttribute = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const csp =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'";

for (const { width, theme } of [
  { width: 736, theme: 'light' },
  { width: 320, theme: 'dark' }
] as const) {
  test(`HTML fragment paints in a script-only sandbox at ${width}px in ${theme}`, async ({
    page
  }) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 500 });
    await page.goto('/tests/browser/fixtures/blank.html');
    page.on('request', (request) => requests.push(request.url()));
    const fragment = await createEmbed(chartDocument, {
      format: 'fragment',
      caption: true,
      theme: 'system'
    });
    const source = `<meta http-equiv="Content-Security-Policy" content="${csp}"><style>:root{color-scheme:${theme}}</style>${fragment}`;
    await page.setContent(
      `<iframe title="Chart" sandbox="allow-scripts" style="width:100%;height:450px;border:0" srcdoc="${escapeAttribute(source)}"></iframe>`
    );
    const frame = page.frameLocator('iframe');
    const view = frame.locator('.scopeview-view');
    await expect(view).toHaveAttribute('data-state', 'ready');
    await expect(view).toHaveAttribute('data-theme', theme);
    await expect(frame.getByRole('heading', { name: chartDocument.title! })).toBeVisible();
    const marks = view.locator('canvas[data-layer=marks]');
    await expect
      .poll(() =>
        marks.evaluate((node) => {
          const canvas = node as HTMLCanvasElement;
          const pixels = canvas
            .getContext('2d')!
            .getImageData(0, 0, canvas.width, canvas.height).data;
          return pixels.filter((value, index) => index % 4 === 3 && value > 0).length;
        })
      )
      .toBeGreaterThan(20);
    await view.locator('.canvas').press('Home');
    const tooltip = view.getByRole('tooltip');
    await expect(tooltip).toContainText('9,007,199,254,740,993');
    await expect(tooltip).toHaveCSS('font-size', '12px');
    await view.locator('.canvas').press('ArrowRight');
    await expect(tooltip).toContainText('zero');
    await expect(tooltip.locator('.tooltip-value')).toHaveText('0');
    // NULL has no fabricated bar or keyboard mark; it stays intact in the snapshot.
    const snapshot = JSON.parse(
      (await frame.locator('script[type="application/json"]').textContent())!
    );
    expect(snapshot.data.rows[2]).toEqual(['missing', null]);
    const inner = page.frames().find((candidate) => candidate.parentFrame() !== null)!;
    expect(
      await inner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await inner.evaluate(() => {
      document.documentElement.style.colorScheme = 'dark';
    });
    await expect(view).toHaveAttribute('data-theme', 'dark');
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('HTML follows OS and declared CSS appearance', async ({ page }) => {
  const html = await createEmbed(chartDocument, { caption: true, theme: 'system' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setContent(html);
  const view = page.locator('.scopeview-view');
  await expect(view).toHaveAttribute('data-state', 'ready');
  await expect(view).toHaveAttribute('data-theme', 'system');
  await expect(view).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(view).toHaveCSS('background-color', 'rgb(26, 32, 41)');
  await page.evaluate(() => {
    document.documentElement.style.colorScheme = 'light';
  });
  await expect(view).toHaveAttribute('data-theme', 'light');
  await expect(view).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('explicit appearance remains local beside a system-themed fragment', async ({ page }) => {
  const system = await createEmbed(chartDocument, { format: 'fragment', theme: 'system' });
  const explicit = await createEmbed(chartDocument, { format: 'fragment', theme: 'light' });
  await page.setContent(`<style>:root{color-scheme:light}</style>${system}${explicit}`);
  const views = page.locator('.scopeview-view');
  await expect(views).toHaveCount(2);
  await expect(views.nth(0)).toHaveAttribute('data-theme', 'light');
  await expect(views.nth(1)).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => {
    document.documentElement.style.colorScheme = 'dark';
  });
  await expect(views.nth(0)).toHaveAttribute('data-theme', 'dark');
  await expect(views.nth(1)).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => {
    document.documentElement.style.colorScheme = 'light';
  });
  await expect(views.nth(0)).toHaveAttribute('data-theme', 'light');
  await expect(views.nth(1)).toHaveAttribute('data-theme', 'light');
});

test('complete HTML renders captions, series and exact readings offline', async ({ page }) => {
  const sample: ChartDocumentInput = {
    ...chartDocument,
    description: 'Synthetic sample',
    data: {
      fields: [
        { name: 'service', data_type: 'string' },
        { name: 'Query', data_type: 'number' },
        { name: 'Ingest', data_type: 'number' }
      ],
      rows: [
        ['api', '120', '80'],
        ['worker', '60', '40']
      ]
    },
    spec: {
      visualization: 'bar',
      encoding: { x: 'service', y: ['Query', 'Ingest'] }
    },
    options: {
      values: ['Query', 'Ingest'].map((field) => ({
        field,
        divisor: '1',
        unit: 'requests',
        decimals: 0
      }))
    }
  };
  const html = await createEmbed(sample, { theme: 'system' });
  expect(html.startsWith('<!doctype html>')).toBe(true);
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route('http://chart-offline.test/', (route) =>
    route.fulfill({ body: html, contentType: 'text/html' })
  );
  await page.goto('http://chart-offline.test/');
  await expect(page.locator('.scopeview-view')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByRole('heading', { name: chartDocument.title! })).toBeVisible();
  await expect(page.locator('figcaption')).toContainText('Synthetic sample');
  await expect(page.getByRole('list', { name: 'Series' }).getByRole('listitem')).toContainText([
    'Query',
    'Ingest'
  ]);
  await page.locator('.canvas').press('Home');
  await expect(page.getByRole('tooltip')).toContainText('120 requests');
  await expect(page.locator('.scopeview-view')).toHaveCSS('background-color', 'rgb(26, 32, 41)');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('.scopeview-view')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  expect(requests).toEqual(['http://chart-offline.test/']);
  expect(errors).toEqual([]);
  await page.setContent(await createEmbed(sample, { legend: false }));
  await expect(page.locator('.scopeview-view')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByRole('heading', { name: chartDocument.title! })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Series' })).toHaveCount(0);
  await page.setContent(await createEmbed(sample, { caption: false }));
  await expect(page.locator('.scopeview-view')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('figcaption')).toHaveCount(0);
});
