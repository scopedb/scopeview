import { test, expect, type Page } from '@playwright/test';
import type { ChartView } from '../../src/headless.js';
import type { ChartDocumentInput, ChartInteraction } from '../../src/index.js';

const source: ChartDocumentInput = {
  version: 1,
  title: 'Host-owned title',
  data: {
    fields: [
      { name: 'service', data_type: 'string' },
      { name: 'requests', data_type: 'number' }
    ],
    rows: [
      ['api', '120'],
      ['query', '80'],
      ['zero', '0']
    ]
  },
  spec: {
    visualization: 'bar',
    encoding: { x: 'service', y: ['requests'] }
  }
};
declare global {
  interface Window {
    headlessFixture: {
      chart: ChartView;
      source: ChartDocumentInput;
      inspected: ChartInteraction<unknown> | null;
      selected: ChartInteraction<unknown> | null;
      stopInteractions?: () => void;
    };
  }
}
test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/fixtures/blank.html');
  await page.evaluate(async (source) => {
    const entry = '/src/chart.ts';
    const { createChart } = await import(entry);
    const host = document.createElement('div');
    host.id = 'headless';
    host.style.cssText = 'width:100%;max-width:600px;--scope-chart-height:240px';
    const sibling = document.createElement('span');
    sibling.id = 'host-owned';
    host.append(sibling);
    document.body.append(host);
    const fixture = {
      source,
      selected: null,
      inspected: null
    } as Window['headlessFixture'];
    fixture.chart = createChart(host, source, {
      onInspect: (target: ChartInteraction<unknown> | null) => {
        fixture.inspected = target;
      },
      onSelect: (target: ChartInteraction<unknown> | null) => {
        fixture.selected = target;
      }
    });
    window.headlessFixture = fixture;
  }, source);
  await expect(page.locator('#headless .scopeview-view')).toHaveAttribute('data-state', 'ready');
});

async function points(page: Page) {
  return page.evaluate(async () => {
    const entry = '/src/index.ts';
    const { compileChart, layoutChart } = await import(entry);
    const canvas = document
      .querySelector('#headless .scopeview-view')!
      .shadowRoot!.querySelector('.canvas')!;
    const bounds = canvas.getBoundingClientRect();
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = `11px ${getComputedStyle(canvas).fontFamily}`;
    const scene = layoutChart(
      compileChart(window.headlessFixture.source),
      new Set(),
      bounds.width,
      bounds.height,
      (text: string) => context.measureText(text).width,
      'minimal'
    );
    return scene.interactions.map((target: { anchor: { x: number; y: number } }) => ({
      x: bounds.left + target.anchor.x,
      y: bounds.top + target.anchor.y
    }));
  });
}

test('report defaults keep transient readings without persistent selection or controls', async ({
  page
}) => {
  const chart = page.locator('#headless .scopeview-view');
  await expect(
    chart.locator('header, button, table, .legend, .summary, .tooltip-footer')
  ).toHaveCount(0);
  await expect(chart).not.toContainText(source.title!);
  const [first, second] = await points(page);
  await page.mouse.move(first.x, first.y);
  const tooltip = chart.getByRole('tooltip');
  await expect(tooltip).toContainText('120');
  await expect(tooltip).toHaveCSS('font-size', '12px');
  await page.mouse.click(first.x, first.y);
  expect(await page.evaluate(() => window.headlessFixture.selected)).toBeNull();
  await page.mouse.move(second.x, second.y);
  await expect(tooltip).toContainText('80');
  expect(await page.evaluate(() => window.headlessFixture.selected)).toBeNull();
  await page.mouse.move(1, 1);
  await expect(tooltip).toBeHidden();
  expect(await page.evaluate(() => window.headlessFixture.selected)).toBeNull();
  await expect(chart.locator('.docked, .tooltip-badge')).toHaveCount(0);
});

test('the default metric entry changes bar orientation without replacing the public view', async ({
  page
}) => {
  await page.evaluate(() => {
    const fixture = window.headlessFixture;
    fixture.source = { ...fixture.source, options: { orientation: 'horizontal' } };
    fixture.chart.update(fixture.source);
  });
  await expect(page.locator('#headless .scopeview-view')).toHaveCount(1);
  await expect(page.locator('#headless .scopeview-view')).toHaveAttribute('data-state', 'ready');
  await page.locator('#headless .canvas').press('Home');
  await expect(page.locator('#headless .tooltip')).toContainText('120');
  await page.evaluate(() => {
    const fixture = window.headlessFixture;
    fixture.source = { ...fixture.source, options: { orientation: 'vertical' } };
    fixture.chart.update(fixture.source);
  });
  await expect(page.locator('#headless .scopeview-view')).toHaveCount(1);
  await page.locator('#headless .canvas').press('End');
  await expect(page.locator('#headless .tooltip')).toContainText('0');
});

test('keyboard readings preserve zero and exact updated sources; invalid updates are atomic', async ({
  page
}) => {
  await page.evaluate(async () => {
    const entry = '/src/interactions.ts';
    const { enableInteractions } = await import(entry);
    window.headlessFixture.stopInteractions = enableInteractions(window.headlessFixture.chart);
  });
  const canvas = page.locator('#headless .canvas');
  await canvas.press('End');
  await expect(page.locator('#headless .tooltip')).toContainText('0');
  await canvas.press('Home');
  await canvas.press('Enter');
  await page.evaluate(() => {
    const fixture = window.headlessFixture;
    fixture.source.data.rows[0][1] = '9007199254740993';
    fixture.chart.update(fixture.source);
  });
  await expect
    .poll(() => page.evaluate(() => window.headlessFixture.selected?.sources))
    .toEqual([['api', '9007199254740993']]);
  expect(
    await page.evaluate(() => {
      try {
        window.headlessFixture.chart.update({ version: 9 });
        return false;
      } catch {
        return true;
      }
    })
  ).toBe(true);
  await expect(page.locator('#headless .tooltip')).toContainText('9,007,199,254,740,993');
  await canvas.press('Escape');
  await expect(page.locator('#headless .tooltip')).toBeHidden();
  expect(await page.evaluate(() => window.headlessFixture.selected)).toBeNull();
  await page.evaluate(() => window.headlessFixture.stopInteractions?.());
});

test('themes and host token overrides repaint; disposal releases owned DOM only', async ({
  page
}) => {
  const chart = page.locator('#headless .scopeview-view');
  await page.evaluate(() => {
    window.headlessFixture.chart.theme = 'dark';
  });
  await expect(chart).toHaveCSS('background-color', 'rgb(26, 32, 41)');
  await page.evaluate(() => {
    document.getElementById('headless')!.style.setProperty('--color-surface', 'rgb(30, 40, 50)');
    window.headlessFixture.chart.refresh();
  });
  await expect(chart).toHaveCSS('background-color', 'rgb(30, 40, 50)');
  await page.locator('#headless .canvas').press('Home');
  await expect(page.locator('#headless .tooltip')).toHaveCSS('background-color', 'rgb(30, 40, 50)');
  await page.evaluate(() => {
    const host = document.getElementById('headless')!;
    host.style.removeProperty('--color-surface');
    window.headlessFixture.chart.theme = 'system';
    window.headlessFixture.chart.refresh();
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(chart).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(chart).toHaveCSS('background-color', 'rgb(26, 32, 41)');
  await page.evaluate(() => window.headlessFixture.chart.dispose());
  await expect(chart).toHaveCount(0);
  await expect(page.locator('#host-owned')).toHaveCount(1);
  expect(
    await page.evaluate(() => {
      try {
        window.headlessFixture.chart.update(window.headlessFixture.source);
        return false;
      } catch {
        return true;
      }
    })
  ).toBe(true);
});

test('disabled readings still emit source events, while static charts disable input', async ({
  page
}) => {
  await page.evaluate(async () => {
    const entry = '/src/chart.ts';
    const { createChart } = await import(entry);
    const fixture = window.headlessFixture;
    fixture.chart.dispose();
    fixture.chart = createChart(document.getElementById('headless')!, fixture.source, {
      tooltip: false,
      onInspect: (target: ChartInteraction<unknown> | null) => {
        fixture.inspected = target;
      }
    });
  });
  await expect(page.locator('#headless .canvas')).toHaveAttribute('tabindex', '0');
  await page.locator('#headless .canvas').press('Home');
  expect(await page.evaluate(() => window.headlessFixture.inspected?.sources)).toEqual([
    ['api', '120']
  ]);
  await expect(page.locator('#headless .tooltip')).toBeHidden();
  await page.evaluate(() => {
    const fixture = window.headlessFixture;
    fixture.source.options = { interactive: false };
    fixture.chart.update(fixture.source);
  });
  await expect(page.locator('#headless .canvas')).not.toHaveAttribute('tabindex');
});

test('a recovered report paint clears its error status and restores readings', async ({ page }) => {
  const chart = page.locator('#headless .scopeview-view');
  for (const empty of [false, true]) {
    if (empty)
      await page.evaluate(() => {
        const fixture = window.headlessFixture;
        fixture.source.data.rows = [];
        fixture.chart.update(fixture.source);
      });
    await page.evaluate(() => {
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = () => {
        CanvasRenderingContext2D.prototype.fillText = fillText;
        throw new Error('Temporary painting failure');
      };
      window.headlessFixture.chart.refresh();
    });
    await expect(chart).toHaveAttribute('data-state', 'error');
    await expect(chart.getByRole('status')).toHaveText('Unable to render chart.');
    await page.evaluate(() => window.headlessFixture.chart.refresh());
    await expect(chart).toHaveAttribute('data-state', 'ready');
    if (empty) await expect(chart.getByRole('status')).toHaveText('No data');
    else {
      await expect(chart.getByRole('status')).toBeHidden();
      await chart.locator('.canvas').press('Home');
      await expect(chart.getByRole('tooltip')).toContainText('120');
    }
  }
});

test('factory, runtime and scalar configuration reject unknown keys without mounting', async ({
  page
}) => {
  const result = await page.evaluate(async (source) => {
    const headlessEntry = '/src/headless.ts',
      reportEntry = '/src/report.ts',
      scalarEntry = '/src/scalar.ts',
      canvasEntry = '/src/canvas.ts',
      runtimeEntry = '/src/runtime.ts';
    const { createVisualization } = await import(headlessEntry);
    const { createReport } = await import(reportEntry);
    const { createScalar } = await import(scalarEntry);
    const { ChartRuntime } = await import(runtimeEntry);
    const { CanvasRenderer } = await import(canvasEntry);
    const host = document.createElement('div');
    const marker = document.createElement('span');
    host.append(marker);
    document.body.append(host);
    const paths: string[] = [];
    const docs = [
      source,
      { version: 1, kind: 'trace', spans: [] },
      { version: 1, kind: 'profile', unit: 'samples', frames: [] }
    ];
    for (const input of docs) {
      for (const create of [createVisualization, createReport]) {
        try {
          await create(host, input, { toolip: false });
        } catch (error) {
          paths.push((error as { path: string }).path);
        }
      }
    }
    for (const options of [
      { toolip: false },
      { theme: 'unknown' },
      { axes: 'quiet' },
      { onInspect: false }
    ]) {
      try {
        createVisualization(host, source, options);
      } catch (error) {
        paths.push((error as { path: string }).path);
      }
    }
    try {
      createScalar(host, { value: '1' }, { tooltip: false });
    } catch (error) {
      paths.push((error as { path: string }).path);
    }
    try {
      createScalar(host, { value: '1', future: true });
    } catch (error) {
      paths.push((error as { path: string }).path);
    }
    try {
      new ChartRuntime(host, document.createElement('div'), { renderer: 'canvas' });
    } catch (error) {
      paths.push((error as { path: string }).path);
    }
    try {
      new ChartRuntime(host, document.createElement('div'), { paint: { strategy: 'direct' } });
    } catch (error) {
      paths.push((error as { path: string }).path);
    }
    let paintError = '';
    try {
      new CanvasRenderer(host, document.createElement('div'), () => {}, { strategy: 'direct' });
    } catch (error) {
      paintError = String(error);
    }
    const untouched = host.children.length === 1 && host.firstElementChild === marker;
    host.remove();
    return { paths, untouched, paintError };
  }, source);
  expect(result.untouched).toBe(true);
  expect(result.paintError).toContain('CanvasRenderer expects 3 arguments.');
  expect(result.paths).toEqual([
    ...Array(6).fill('options.toolip'),
    'options.toolip',
    'options.theme',
    'options.axes',
    'options.onInspect',
    'options.tooltip',
    'value.future',
    'options.renderer',
    'options.paint'
  ]);
});
