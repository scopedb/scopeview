import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

/** Load the relocated file's actual bytes, block all external requests, and inspect paint/readings. */
export async function observePackedHTML(
  browser,
  fixture,
  files,
  scenarios = [
    { width: 960, dpr: 1, theme: 'light' },
    { width: 320, dpr: 1, theme: 'dark' },
    { width: 390, dpr: 2, theme: 'light' }
  ]
) {
  fixture.report.browserVersion = browser.version();
  const api = await import(pathToFileURL(`${fixture.installed}/dist/index.js`).href);
  const expected = {
    line: ['12', '18', '9'],
    area: ['12', '18', '9'],
    bar: ['9,007,199,254,740,993', '80', '0'],
    'horizontal-bar': ['120', '80', '0'],
    scatter: ['12.5', '120', '24.75', '80'],
    pie: ['120', '80'],
    'top-list': ['120', '80', '0'],
    treemap: ['120', '80'],
    trace: ['GET /example', 'Query', 'Tiny exact span', '1 ns', 'Zero duration', '0 ns'],
    profile: [
      'main',
      'query',
      '9,007,199,254,740,993',
      'Tiny exact frame',
      '1 samples',
      'Zero self weight'
    ]
  };
  for (const scenario of scenarios) {
    const context = await browser.newContext({
      viewport: { width: scenario.width, height: 700 },
      deviceScaleFactor: scenario.dpr,
      colorScheme: scenario.theme
    });
    const page = await context.newPage();
    const errors = [],
      external = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(/^(?:https?|wss?):/, (route) => {
      external.push(route.request().url());
      return route.abort();
    });
    try {
      for (const [name, file] of Object.entries(files)) {
        const source = JSON.parse(
          (await readFile(file, 'utf8')).match(/type="application\/json">([\s\S]*?)<\/script>/)[1]
        );
        await page.goto(pathToFileURL(file).href);
        const view = page.locator('.scopeview-view');
        await expect(view).toHaveAttribute('data-state', 'ready');
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
          `${name}: overflow`
        );
        const snapshot = JSON.parse(
          await page.locator('script[type="application/json"]').textContent()
        );
        assert.deepEqual(snapshot, source);
        const original = fixture.report.artifacts.find(
          (artifact) => artifact.name === name
        ).document;
        if (original.data) assert.deepEqual(snapshot.data.rows, original.data.rows);
        else
          assert.deepEqual(
            snapshot[name === 'trace' ? 'spans' : 'frames'],
            original[name === 'trace' ? 'spans' : 'frames']
          );
        let painted = 0,
          readings = [];
        if (name === 'big-number') {
          await expect(view.locator('.value-number')).toHaveText([
            '9,007,199,254,740,993',
            '0',
            'NULL'
          ]);
          assert.equal(await view.locator('canvas').count(), 0);
          readings = await view.locator('.value-number').allTextContents();
        } else {
          const marks = view.locator('canvas[data-layer=marks]');
          const pixels = await marks.evaluate((node) => {
            const canvas = node,
              ctx = canvas.getContext('2d');
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let painted = 0,
              best = null;
            const scale = canvas.width / canvas.getBoundingClientRect().width;
            for (let y = 0; y < canvas.height; y++) {
              let start = null;
              for (let x = 0; x <= canvas.width; x++) {
                const i = (y * canvas.width + x) * 4;
                if (x < canvas.width && data[i + 3] > 0) painted++;
                const colored =
                  x < canvas.width &&
                  data[i + 3] > 100 &&
                  Math.max(data[i], data[i + 1], data[i + 2]) -
                    Math.min(data[i], data[i + 1], data[i + 2]) >
                    30;
                if (colored && start === null) start = x;
                if (!colored && start !== null) {
                  if (!best || x - start > best.length)
                    best = { x: (start + x) / 2 / scale, y: y / scale, length: x - start };
                  start = null;
                }
              }
            }
            return { painted, point: best };
          });
          painted = pixels.painted;
          assert.ok(painted > 20, `${name}: actual marks missing`);
          const canvas = view.locator('.canvas');
          await canvas.press('Home');
          const tooltip = view.getByRole('tooltip');
          for (let i = 0; i < 12; i++) {
            await expect(tooltip).toBeVisible();
            readings.push(await tooltip.innerText());
            await canvas.press('ArrowRight');
          }
          const all = readings.join('\n');
          for (const value of expected[name])
            assert.ok(
              all.includes(value),
              `${name} at ${scenario.width}px: missing ${value}\n${all}`
            );
          await expect(tooltip).toHaveCSS('font-size', '12px');
          await canvas.press('Escape');
          await expect(tooltip).toBeHidden();
          const dimensions = await canvas.evaluate((node) => ({
            width: node.clientWidth,
            height: node.clientHeight,
            font: `11px ${getComputedStyle(node).fontFamily}`
          }));
          let point;
          if (source.kind === 'trace' || source.kind === 'profile') {
            point = await page
              .locator('[data-scopeview]')
              .evaluate((node) => node.scopeviewView.runtime.model.interactions[0].anchor);
          } else {
            const compiled = api.compileChart(source),
              texts = new Set();
            const layout = (measure) =>
              api.layoutChart(
                compiled,
                new Set(),
                dimensions.width,
                dimensions.height,
                measure,
                'minimal'
              );
            layout((text) => {
              texts.add(text);
              return text.length * 7;
            });
            const widths = await page.evaluate(
              ({ texts, font }) => {
                const context = document.createElement('canvas').getContext('2d');
                context.font = font;
                return Object.fromEntries(
                  texts.map((text) => [text, context.measureText(text).width])
                );
              },
              { texts: [...texts], font: dimensions.font }
            );
            point = layout((text) => widths[text] ?? text.length * 7).interactions[0].anchor;
          }
          const bounds = await canvas.boundingBox();
          await page.mouse.move(bounds.x + point.x, bounds.y + point.y);
          await expect(tooltip, `${name} pointer at ${scenario.width}px`).toBeVisible();
          const pointerReading = await tooltip.innerText();
          assert.ok(readings.includes(pointerReading), `${name}: pointer and keyboard disagree`);
          readings.push(pointerReading);
          if (name === 'line' || name === 'area') assert.equal(snapshot.data.rows[2][1], null);
          if (name === 'bar') assert.equal(snapshot.data.rows[3][1], null);
        }
        fixture.report.browser.push({
          name,
          ...scenario,
          file,
          painted,
          readings,
          errors: [...errors],
          externalRequests: [...external]
        });
        await fixture.save();
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    } finally {
      await context.close();
    }
  }
}
