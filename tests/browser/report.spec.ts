import { test, expect } from '@playwright/test';
import type { ChartView } from '../../src/headless.js';

declare global {
  interface Window {
    reportFixture: { view: ChartView; stop?: () => void; selected: unknown };
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/fixtures/blank.html');
});

test('async report loads its family on demand and shares optional interactions', async ({
  page
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.evaluate(async (entry) => {
    await import(entry);
  }, '/dist/report.js');
  expect(requests.filter((url) => /\/(?:trace|flame|chart)\.(?:ts|js)/.test(url))).toEqual([]);
  await page.evaluate(async (entry) => {
    const { createReport } = await import(entry);
    const host = document.createElement('div');
    host.id = 'lazy-report';
    host.style.width = '400px';
    host.innerHTML = '<span id="report-text">Report text</span>';
    document.body.append(host);
    const input = {
      version: 1,
      kind: 'trace',
      spans: [{ id: 'root', name: 'Report trace', startTimeNs: '0', endTimeNs: '1' }]
    };
    const controller = new AbortController();
    const cancelled = createReport(host, input, { signal: controller.signal });
    controller.abort();
    try {
      await cancelled;
      throw new Error('Cancelled mounting must reject.');
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'AbortError') throw error;
    }
    if (host.querySelector('.scopeview-view')) throw new Error('Cancelled view was mounted.');
    window.reportFixture = {
      selected: null,
      view: await createReport(host, input, {
        onSelect: (target: unknown) => {
          window.reportFixture.selected = target;
        }
      })
    };
  }, '/dist/report.js');
  const host = page.locator('#lazy-report');
  const canvas = host.locator('.canvas');
  await expect(host.locator('.scopeview-view')).toHaveAttribute('data-state', 'ready');
  await canvas.press('Home');
  await expect(host.locator('.tooltip')).toContainText('Report trace');
  await expect(host.locator('.tooltip')).toContainText('1 ns');
  await canvas.press('Enter');
  expect(await page.evaluate(() => window.reportFixture.selected)).toBeNull();
  expect(
    requests.filter((url) =>
      /\/families\/metrics\/|\/(?:src|dist)\/(?:flame|chart|interactions)\.(?:ts|js)|viewport-controller/.test(
        url
      )
    )
  ).toEqual([]);
  await page.evaluate(async (entry) => {
    const interactions = entry.replace(/report\./, 'interactions.');
    const { enableInteractions } = await import(interactions);
    window.reportFixture.stop = enableInteractions(window.reportFixture.view);
  }, '/dist/report.js');
  await expect(canvas).toHaveCSS('touch-action', 'pan-y');
  await canvas.press('Enter');
  expect(await page.evaluate(() => window.reportFixture.selected)).not.toBeNull();
  await page.evaluate(() => window.reportFixture.view.dispose());
  await expect(host.locator('.scopeview-view')).toHaveCount(0);
  await expect(page.locator('#report-text')).toHaveText('Report text');
});

test('scalar entry uses intrinsic HTML and shared tokens without Canvas or chart modules', async ({
  page
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.evaluate(async () => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = () => {
      throw new Error('Scalars must not construct a Canvas.');
    };
    try {
      const entry = '/src/scalar.ts';
      const { createScalar } = await import(entry);
      const host = document.createElement('div');
      host.id = 'scalar';
      host.style.cssText = 'width:360px;--scope-chart-height:900px;--color-text-primary:rgb(1,2,3)';
      host.innerHTML = '<span id="sibling">Report text</span>';
      document.body.append(host);
      window.reportFixture = {
        selected: null,
        view: createScalar(host, [
          { label: '<img src=x onerror=alert(1)>', value: '9007199254740993' },
          { label: 'Zero', value: '0' },
          { label: 'Missing', value: null }
        ])
      };
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  });
  const scalar = page.locator('#scalar .scopeview-scalar');
  await expect(scalar.locator('canvas, .canvas, .tooltip, img')).toHaveCount(0);
  await expect(scalar.locator('.value-number')).toHaveText(['9,007,199,254,740,993', '0', 'NULL']);
  await expect(scalar.locator('.value-number').first()).toHaveAttribute(
    'title',
    '9007199254740993'
  );
  await expect(scalar).toContainText('<img src=x onerror=alert(1)>');
  await expect(scalar).toHaveCSS('color', 'rgb(1, 2, 3)');
  expect((await scalar.boundingBox())!.height).toBeLessThan(120);
  expect(requests.filter((url) => /\/src\/(?:runtime|renderers|families)\//.test(url))).toEqual([]);
  expect(
    await page.evaluate(() => {
      try {
        window.reportFixture.view.update({ value: '0x10' });
        return false;
      } catch {
        return true;
      }
    })
  ).toBe(true);
  await expect(scalar.locator('.value-number').first()).toHaveText('9,007,199,254,740,993');
  await page.evaluate(() => {
    window.reportFixture.view.update({
      value: '1500',
      display: { divisor: '1000', unit: 's', decimals: 2 }
    });
    document.getElementById('scalar')!.style.removeProperty('--color-text-primary');
    window.reportFixture.view.theme = 'dark';
    window.reportFixture.view.refresh();
  });
  await expect(scalar.locator('.value-number')).toHaveText('1.50 s');
  await expect(scalar).not.toHaveCSS('color', 'rgb(1, 2, 3)');
  await page.evaluate(() => window.reportFixture.view.update([]));
  await expect(scalar.getByRole('status')).toHaveText('No data');
  await page.evaluate(() => window.reportFixture.view.dispose());
  await expect(scalar).toHaveCount(0);
  await expect(page.locator('#sibling')).toHaveText('Report text');
});

test('aggregate chart documents instantiate HTML and can switch to a plot and back', async ({
  page
}) => {
  await page.evaluate(async () => {
    const entry = '/src/chart.ts';
    const { createChart } = await import(entry);
    const host = document.createElement('div');
    host.id = 'aggregate';
    document.body.append(host);
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = () => {
      throw new Error('Aggregates must not instantiate a painter.');
    };
    try {
      window.reportFixture = {
        selected: null,
        view: createChart(host, {
          version: 1,
          data: {
            fields: [{ name: 'value', data_type: 'number' }],
            rows: [['9007199254740993']]
          },
          spec: {
            visualization: 'big-number',
            encoding: { values: ['value'] }
          }
        })
      };
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  });
  await expect(page.locator('#aggregate canvas')).toHaveCount(0);
  await expect(page.locator('#aggregate .value-number')).toHaveText('9,007,199,254,740,993');
  await page.evaluate(() =>
    window.reportFixture.view.update({
      version: 1,
      data: {
        fields: [
          { name: 'service', data_type: 'string' },
          { name: 'value', data_type: 'number' }
        ],
        rows: [['api', '42']]
      },
      spec: {
        visualization: 'bar',
        encoding: { x: 'service', y: ['value'] }
      }
    })
  );
  await expect(page.locator('#aggregate .scopeview-view')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#aggregate canvas[data-layer=marks]')).toHaveCount(1);
  await page.locator('#aggregate .canvas').press('Home');
  await expect(page.locator('#aggregate .tooltip')).toContainText('42');
  await page.evaluate(() =>
    window.reportFixture.view.update({
      version: 1,
      data: {
        fields: [{ name: 'value', data_type: 'number' }],
        rows: [['0']]
      },
      spec: {
        visualization: 'big-number',
        encoding: { values: ['value'] }
      }
    })
  );
  await expect(page.locator('#aggregate .value-number')).toHaveText('0');
  await expect(page.locator('#aggregate .scopeview-view')).toHaveCount(1);
  await expect(page.locator('#aggregate canvas, #aggregate .tooltip')).toHaveCount(0);
});

test('aggregate report and component preserve NULL labels alongside exact integers and zero', async ({
  page
}) => {
  await page.evaluate(async () => {
    const chartEntry = '/src/chart.ts';
    const registerEntry = '/src/register.ts';
    const { createChart } = await import(chartEntry);
    await import(registerEntry);
    const input = {
      version: 1,
      data: {
        fields: ['beyond_safe', 'zero', 'missing'].map((name) => ({ name, data_type: 'number' })),
        rows: [['9007199254740993', '0', null]]
      },
      spec: {
        visualization: 'big-number',
        encoding: { values: ['beyond_safe', 'zero', 'missing'] }
      }
    };
    const host = document.createElement('div');
    host.id = 'nullable-aggregate';
    document.body.append(host);
    window.reportFixture = { selected: null, view: createChart(host, input) };
    const component = Object.assign(document.createElement('scope-chart'), { document: input });
    component.id = 'nullable-component';
    document.body.append(component);
  });
  const report = page.locator('#nullable-aggregate');
  await expect(report.locator('.value-label')).toHaveText(['beyond_safe', 'zero', 'missing']);
  await expect(report.locator('.value-number')).toHaveText(['9,007,199,254,740,993', '0', 'NULL']);
  await expect(report.locator('canvas')).toHaveCount(0);
  const component = page.locator('#nullable-component');
  await expect(component.locator('.metric-label')).toHaveText(['beyond_safe', 'zero', 'missing']);
  await expect(component.locator('.metric').first()).toContainText('9,007,199,254,740,993');
  await expect(component.locator('.metric-value').nth(1)).toHaveText('0');
  await expect(component.locator('.metric-value').nth(2)).toHaveText('NULL');
});

test('aggregate HTML preserves the document compiler numeric input contract', async ({ page }) => {
  const input = await page.evaluate(async () => {
    const entry = '/src/chart.ts';
    const { createChart } = await import(entry);
    const host = document.createElement('div');
    host.id = 'numeric-aggregate';
    document.body.append(host);
    const input = {
      version: 1,
      data: {
        fields: [{ name: 'value', data_type: 'number' }],
        rows: [[' 42 ']]
      },
      spec: {
        visualization: 'big-number',
        encoding: { values: ['value'] }
      }
    };
    window.reportFixture = { selected: null, view: createChart(host, input) };
    return input;
  });
  const value = page.locator('#numeric-aggregate .value-number');
  await expect(value).toHaveText('42');
  await expect(value).toHaveAttribute('title', ' 42 ');
  input.data.rows[0][0] = '0x10';
  await page.evaluate((input) => window.reportFixture.view.update(input), input);
  await expect(value).toHaveText('16');
  await expect(value).toHaveAttribute('title', '0x10');
  input.data.rows[0][0] = 'not numeric';
  expect(
    await page.evaluate((input) => {
      try {
        window.reportFixture.view.update(input);
        return false;
      } catch {
        return true;
      }
    }, input)
  ).toBe(true);
  await expect(value).toHaveText('16');
});

test('hierarchy reads every depth by default and loads viewport input only on request', async ({
  page
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.evaluate(async () => {
    const entry = '/src/flame.ts';
    const { createFlame } = await import(entry);
    const host = document.createElement('div');
    host.id = 'profile';
    host.style.width = '600px';
    document.body.append(host);
    window.reportFixture = {
      selected: null,
      view: createFlame(
        host,
        {
          version: 1,
          kind: 'profile',
          unit: 'samples',
          frames: Array.from({ length: 80 }, (_, index) => ({
            id: String(index),
            ...(index ? { parentId: String(index - 1) } : {}),
            name: `Frame ${index}`,
            selfWeight: index === 79 ? '9007199254740993' : '0'
          }))
        },
        {
          onSelect: (target: unknown) => {
            window.reportFixture.selected = target;
          }
        }
      )
    };
  });
  const canvas = page.locator('#profile .canvas');
  await expect(page.locator('#profile .scopeview-view')).toHaveAttribute('data-state', 'ready');
  await canvas.press('End');
  const tooltip = page.locator('#profile .tooltip');
  await expect(tooltip).toContainText('Frame 79');
  await expect(tooltip).toContainText('9,007,199,254,740,993');
  await canvas.press('Enter');
  expect(await page.evaluate(() => window.reportFixture.selected)).toBeNull();
  const wheelPrevented = () =>
    canvas.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const event = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -100,
        clientX: bounds.x + 200,
        clientY: bounds.y + 30
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(await wheelPrevented()).toBe(false);
  expect(
    requests.some((url) =>
      /(?:viewport-controller|chart-runtime|\/core\/viewport|\/src\/interactions)\./.test(url)
    )
  ).toBe(false);
  await page.evaluate(async () => {
    const entry = '/src/interactions.ts';
    const { enableInteractions } = await import(entry);
    const fixture = window.reportFixture;
    fixture.stop = enableInteractions(fixture.view);
    if (fixture.stop !== enableInteractions(fixture.view))
      throw new Error('Activation must be idempotent.');
  });
  await expect(canvas).toHaveCSS('touch-action', 'pan-y');
  expect(await wheelPrevented()).toBe(true);
  expect(requests.some((url) => url.includes('/runtime/viewport-controller.ts'))).toBe(true);
  await canvas.press('Home');
  await canvas.press('End');
  await expect(tooltip).toContainText('Frame 79');
  const bounds = (await canvas.boundingBox())!;
  const reading = (await tooltip.boundingBox())!;
  expect(reading.y).toBeGreaterThanOrEqual(bounds.y);
  expect(reading.y).toBeLessThan(bounds.y + bounds.height);
  await canvas.press('Enter');
  expect(await page.evaluate(() => window.reportFixture.selected)).not.toBeNull();
  await page.evaluate(() => window.reportFixture.stop?.());
  await expect(canvas).toHaveCSS('touch-action', 'auto');
  expect(await wheelPrevented()).toBe(false);
  expect(await page.evaluate(() => window.reportFixture.selected)).toBeNull();
  await canvas.press('End');
  await expect(tooltip).toContainText('Frame 79');
  await page.evaluate(() => window.reportFixture.view.dispose());
  expect(
    await page.evaluate(async () => {
      const entry = '/src/interactions.ts';
      const { enableInteractions } = await import(entry);
      try {
        enableInteractions(window.reportFixture.view);
        return false;
      } catch {
        return true;
      }
    })
  ).toBe(true);
});

test.describe('report canvas density', () => {
  test.use({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });

  test('report canvases resize at native density without adding surrounding UI', async ({
    page
  }) => {
    await page.evaluate(async () => {
      const entry = '/src/trace.ts';
      const { createTrace } = await import(entry);
      const host = document.createElement('div');
      host.id = 'sized';
      host.style.width = '400px';
      document.body.append(host);
      window.reportFixture = {
        selected: null,
        view: createTrace(host, {
          version: 1,
          kind: 'trace',
          spans: [{ id: 'root', name: 'Query', startTimeNs: '0', endTimeNs: '100' }]
        })
      };
    });
    const marks = page.locator('#sized canvas[data-layer=marks]');
    await expect(marks).toHaveAttribute('width', '800');
    await expect(marks).toHaveAttribute('height', '480');
    await page.evaluate(() => {
      const host = document.getElementById('sized')!;
      host.style.width = '320px';
      host.style.setProperty('--scope-chart-height', '180px');
    });
    await expect(marks).toHaveAttribute('width', '640');
    await expect(marks).toHaveAttribute('height', '360');
    await page.locator('#sized .canvas').press('Home');
    await expect(page.locator('#sized .tooltip')).toContainText('Query');
    await expect(page.locator('#sized header, #sized button, #sized table')).toHaveCount(0);
  });
});
