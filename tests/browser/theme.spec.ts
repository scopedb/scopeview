import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createEmbed } from '../../node/embed.mjs';
import type { ChartTheme, ChartView } from '../../src/chart.js';
import type { ChartDocumentInput } from '../../src/index.js';

const source: ChartDocumentInput = {
  version: 1,
  title: 'Themed requests',
  data: {
    fields: [
      { name: 'service', data_type: 'string' },
      { name: 'requests', data_type: 'number' }
    ],
    rows: [
      ['api', '9007199254740993'],
      ['worker', '0'],
      ['missing', null]
    ]
  },
  spec: { visualization: 'bar', encoding: { x: 'service', y: ['requests'] } },
  options: { colors: { requests: '#456789' } }
};
const theme: ChartTheme = {
  mode: 'light',
  fontSize: 26,
  fontFamily: 'monospace',
  palette: ['#c74d32'],
  colors: { surface: '#fff9ef', text: '#18212b', mutedText: '#68758a' }
};
declare global {
  interface Window {
    themeView: ChartView;
    themePaints: { text: string; font: string; color: string }[];
    themeMeasures: string[];
  }
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.themePaints = [];
    window.themeMeasures = [];
    const paint = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      window.themePaints.push({ text, font: this.font, color: String(this.fillStyle) });
      return maxWidth === undefined
        ? paint.call(this, text, x, y)
        : paint.call(this, text, x, y, maxWidth);
    };
    const measure = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function (text) {
      window.themeMeasures.push(this.font);
      return measure.call(this, text);
    };
  });
  await page.goto('/tests/browser/fixtures/blank.html');
});

test('headless theme changes synchronize measurement, Canvas, tooltip and scalar, then restore host CSS', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.evaluate(
    async ({ source, theme }) => {
      const entry = '/src/chart.ts';
      const { createChart } = await import(entry);
      const host = document.createElement('div');
      host.id = 'chart';
      host.style.setProperty('--font-sans', 'serif');
      document.body.append(host);
      window.themeView = createChart(host, source, { theme });
    },
    { source, theme }
  );
  const view = page.locator('#chart .scopeview-view');
  await expect(view).toHaveAttribute('data-state', 'ready');
  await expect(view).toHaveCSS('background-color', 'rgb(255, 249, 239)');
  await expect
    .poll(() =>
      page.evaluate(() => window.themePaints.some(({ font }) => font.includes('22px monospace')))
    )
    .toBe(true);
  expect(
    await page.evaluate(() => window.themeMeasures.some((font) => font.includes('22px monospace')))
  ).toBe(true);
  await view.locator('.canvas').press('Home');
  await expect(view.getByRole('tooltip')).toContainText('9,007,199,254,740,993');
  await expect(view.getByRole('tooltip')).toHaveCSS('font-size', '24px');
  await expect(view.getByRole('tooltip')).toHaveCSS('font-family', 'monospace');
  const invalid = await page.evaluate(() => {
    const before = window.themeView.theme;
    try {
      window.themeView.theme = { fontSize: 0 };
    } catch (error) {
      return { same: window.themeView.theme === before, path: (error as { path: string }).path };
    }
  });
  expect(invalid).toEqual({ same: true, path: 'theme.fontSize' });
  await page.evaluate(() => {
    window.themeView.theme = 'dark';
  });
  await expect(view).toHaveAttribute('data-theme', 'dark');
  await expect(view.getByRole('tooltip')).toHaveCSS('font-size', '12px');
  await expect(view).toHaveCSS('font-family', 'serif');
  await page.evaluate((source) => {
    window.themeView.theme = { fontSize: 26 };
    window.themeView.update({
      ...source,
      data: { fields: [source.data.fields[1]], rows: [['7']] },
      spec: { visualization: 'big-number', encoding: { values: ['requests'] } }
    });
  }, source);
  await expect(page.locator('#chart .value-number')).toHaveCSS('font-size', '56px');
  await expect(page.locator('#chart .value-number')).toHaveText('7');
});

test('component themes are atomic, survive document changes and restore inline host values', async ({
  page
}) => {
  const paths = await page.evaluate(
    async ({ source, theme }) => {
      const entry = '/src/register.ts';
      await import(entry);
      const element = document.createElement('scope-chart');
      element.id = 'component';
      element.style.setProperty('--font-sans', 'serif', 'important');
      element.document = source;
      element.theme = theme;
      document.body.append(element);
      const paths: string[] = [];
      try {
        element.theme = { colors: { typo: '#fff' } } as never;
      } catch (error) {
        paths.push((error as { path: string }).path);
      }
      return paths;
    },
    { source, theme }
  );
  expect(paths).toEqual(['theme.colors.typo']);
  const element = page.locator('#component');
  await expect(element).toHaveAttribute('data-state', 'ready');
  await expect(element.locator('h2')).toHaveCSS('font-size', '28px');
  await expect
    .poll(() =>
      page.evaluate(() => window.themePaints.some(({ font }) => font.includes('22px monospace')))
    )
    .toBe(true);
  await page.evaluate((source) => {
    const element = document.querySelector('scope-chart')!;
    element.document = { ...source, title: 'Updated' };
    element.theme = 'system';
  }, source);
  await expect(element.locator('h2')).toHaveText('Updated');
  await expect(element.locator('h2')).toHaveCSS('font-size', '14px');
  expect(
    await element.evaluate((el) => [
      el.style.getPropertyValue('--font-sans'),
      el.style.getPropertyPriority('--font-sans')
    ])
  ).toEqual(['serif', 'important']);
  await page.evaluate(() => {
    const element = document.querySelector('scope-chart')!;
    element.theme = { fontSize: 26 };
    element.document = {
      version: 1,
      data: { fields: [{ name: 'n', data_type: 'number' }], rows: [['7']] },
      spec: { visualization: 'big-number', encoding: { values: ['n'] } }
    };
  });
  await expect(element.locator('.metric-value')).toHaveCSS('font-size', '128px');
});

test('export embeds the resolved theme for captions, plots and exact readings without requests', async ({
  page
}) => {
  const html = await createEmbed(source, { theme });
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(html);
  const view = page.locator('.scopeview-view');
  await expect(view).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('h3')).toHaveCSS('font-size', '28px');
  await expect(page.locator('h3')).toHaveCSS('font-family', 'monospace');
  await expect(page.locator('figure')).toHaveCSS('background-color', 'rgb(255, 249, 239)');
  await expect(view).toHaveCSS('background-color', 'rgb(255, 249, 239)');
  await view.locator('.canvas').press('Home');
  await expect(view.getByRole('tooltip')).toHaveCSS('font-size', '24px');
  await expect(view.getByRole('tooltip')).toContainText('9,007,199,254,740,993');
  const snapshot = JSON.parse(
    (await page.locator('script[type="application/json"]').textContent())!
  );
  expect(snapshot.theme).toBeUndefined();
  expect(snapshot.data).toEqual(source.data);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test('palette identity, semantic roles and explicit colors stay separate', async ({ page }) => {
  const paints = await page.evaluate(
    async ({ source, theme }) => {
      const entry = '/src/headless.ts';
      const { createVisualization } = await import(entry);
      for (const [id, input] of Object.entries({
        categorical: { ...source, options: {} },
        authored: source,
        semantic: {
          ...source,
          data: {
            ...source.data,
            fields: [{ name: 'status', data_type: 'string' }, source.data.fields[1]],
            rows: [
              ['info', '1'],
              ['error', '2']
            ]
          },
          spec: { visualization: 'bar', encoding: { x: 'status', y: ['requests'] } },
          options: { colorStrategy: 'semantic' }
        }
      })) {
        const host = document.createElement('div');
        host.id = id;
        document.body.append(host);
        createVisualization(host, input, { theme });
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      return Object.fromEntries(
        ['categorical', 'authored', 'semantic'].map((id) => {
          const canvas = document
            .querySelector(`#${id} .scopeview-view`)!
            .shadowRoot!.querySelector<HTMLCanvasElement>('canvas[data-layer=marks]')!;
          const bytes = canvas
            .getContext('2d')!
            .getImageData(0, 0, canvas.width, canvas.height).data;
          const colors = new Set<string>();
          for (let i = 0; i < bytes.length; i += 4)
            if (bytes[i + 3] === 255) colors.add(`${bytes[i]},${bytes[i + 1]},${bytes[i + 2]}`);
          return [id, [...colors]];
        })
      );
    },
    { source, theme }
  );
  expect(paints.categorical).toContain('199,77,50');
  expect(paints.authored).toContain('69,103,137');
  expect(paints.semantic).toContain('65,139,230');
  expect(paints.semantic).toContain('221,86,82');
  expect(paints.semantic).not.toContain('199,77,50');
});

test('treemap and hierarchy fonts fit at the size actually painted', async ({ page }) => {
  await page.evaluate(async (source) => {
    const entry = '/src/headless.ts';
    const { createVisualization } = await import(entry);
    const documents = [
      {
        ...source,
        options: {},
        data: {
          ...source.data,
          rows: [
            ['api', '12'],
            ['worker', '8']
          ]
        },
        spec: { visualization: 'treemap', encoding: { category: 'service', value: 'requests' } }
      },
      {
        version: 1,
        kind: 'trace',
        options: { rowHeight: 40 },
        spans: [{ id: 'root', name: 'Complete root label', startTimeNs: '0', endTimeNs: '1000000' }]
      },
      {
        version: 1,
        kind: 'profile',
        unit: 'samples',
        options: { rowHeight: 40 },
        frames: [{ id: 'root', name: 'Complete root label', selfWeight: '100' }]
      }
    ];
    for (const [index, input] of documents.entries()) {
      const host = document.createElement('div');
      host.id = `family-${index}`;
      host.style.width = '320px';
      document.body.append(host);
      createVisualization(host, input, { theme: { fontSize: 26, fontFamily: 'monospace' } });
    }
  }, source);
  for (let i = 0; i < 3; i++)
    await expect(page.locator(`#family-${i} .scopeview-view`)).toHaveAttribute(
      'data-state',
      'ready'
    );
  const fonts = await page.evaluate(() => window.themePaints);
  expect(
    fonts.some(({ font, text }) => font.includes('24px monospace') && text.startsWith('Complete'))
  ).toBe(true);
  expect(
    fonts.some(({ font, text }) => text === 'api' && parseFloat(font.replace(/^400 /, '')) >= 22)
  ).toBe(true);
  expect(
    fonts
      .filter(({ text }) => text.startsWith('Complete'))
      .every(({ font }) => font.includes('24px monospace'))
  ).toBe(true);
});

test('late font completion measures and paints again with the same theme', async ({ page }) => {
  const font = (
    await readFile('node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2')
  ).toString('base64');
  const metrics = await page.evaluate(
    async ({ source, font }) => {
      const entry = '/src/chart.ts';
      const { createChart } = await import(entry);
      const host = document.createElement('div');
      document.body.append(host);
      window.themeView = createChart(host, source, {
        theme: { fontFamily: '"Late Theme Font", monospace', fontSize: 16 }
      });
      const painted = () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      await painted();
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = '16px "Late Theme Font", monospace';
      const before = context.measureText('Requests by service').width;
      const count = window.themeMeasures.length;
      const face = new FontFace('Late Theme Font', `url(data:font/woff2;base64,${font})`);
      document.fonts.add(face);
      await face.load();
      await document.fonts.ready;
      await painted();
      const measuredAgain = window.themeMeasures.length > count;
      return { before, after: context.measureText('Requests by service').width, measuredAgain };
    },
    { source, font }
  );
  expect(metrics.measuredAgain).toBe(true);
  expect(metrics.after).not.toBe(metrics.before);
});

test('intrinsic scalar themes keep their own readable surface without a Canvas', async ({
  page
}) => {
  await page.evaluate(async () => {
    const entry = '/src/scalar.ts';
    const { createScalar } = await import(entry);
    const host = document.createElement('div');
    host.id = 'scalar';
    host.style.background = 'white';
    document.body.append(host);
    window.themeView = createScalar(
      host,
      { value: '9007199254740993', label: 'Requests' },
      { theme: { mode: 'dark', colors: { surface: '#18212d' } } }
    );
  });
  const view = page.locator('#scalar .scopeview-view');
  await expect(view).toHaveCSS('background-color', 'rgb(24, 33, 45)');
  await expect(view.locator('.value-number')).toHaveText('9,007,199,254,740,993');
  await expect(view.locator('canvas')).toHaveCount(0);
  await page.evaluate(() => {
    window.themeView.theme = 'light';
  });
  await expect(view).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});
