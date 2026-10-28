import { test, expect } from '@playwright/test';
import sample from '../../examples/requests.json' with { type: 'json' };
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { sceneFor, rectangles, moveToMark, pixel } from './scene.js';
import type { ScopeChartElement } from '../../src/element.js';

test('renders all chart families with ScopeView paints and preserves the original values', async ({
  page
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/');
  await expect(page.locator('scope-chart[data-state=ready]')).toHaveCount(4);
  await expect(page.locator('#status .legend .swatch').first()).toHaveCSS(
    'background-color',
    'rgb(58, 162, 115)'
  );
  const main = page.locator('#requests');
  await expect(main.locator('.plot-canvas')).toBeVisible();
  expect(
    (await sceneFor(page, '#requests')).marks.filter((mark) => mark.kind === 'path')
  ).toHaveLength(4);
  await expect(page.locator('svg')).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(3);
  await main.getByRole('button', { name: 'View data', exact: true }).click();
  await expect(main.getByRole('table')).toBeVisible();
  await expect(main.getByRole('cell', { name: '2026-09-29T02:00:00Z', exact: true })).toHaveCount(
    3
  );
  await expect(main.getByRole('cell', { name: 'SQL NULL', exact: true })).toHaveCount(1);
  await main.getByRole('button', { name: 'Hide data', exact: true }).click();
  for (const type of ['area', 'bar', 'line']) {
    await page.locator('#visualization').selectOption(type);
    await expect(main).toHaveAttribute('data-state', 'ready');
    await expect(main.locator('.plot-canvas')).toBeVisible();
    expect(
      (await sceneFor(page, '#requests')).marks.some(
        (mark) => mark.kind === (type === 'bar' ? 'rect' : 'path')
      )
    ).toBe(true);
  }
  expect(failures).toEqual([]);
});

test('a custom host renders and inspects the public scene without using the Web Component', async ({
  page
}) => {
  await page.goto('/');
  await page.evaluate(async (sample) => {
    const coreEntry = '/src/index.ts',
      browserEntry = '/src/canvas.ts';
    const { compileChart, layoutChart, ChartSession } = await import(coreEntry);
    const { CanvasRenderer, SCOPE_CHART_STYLES } = await import(browserEntry);
    const value = structuredClone(sample);
    value.spec.visualization = 'bar';
    const compiled = compileChart(value),
      session = new ChartSession();
    const host = document.createElement('div');
    host.id = 'headless-host';
    host.style.width = '640px';
    host.style.maxWidth = '100%';
    const root = host.attachShadow({ mode: 'open' }),
      css = document.createElement('style'),
      viewport = document.createElement('div'),
      canvas = document.createElement('div'),
      decoration = document.createElement('div');
    css.textContent = SCOPE_CHART_STYLES;
    viewport.className = 'viewport';
    canvas.className = 'canvas';
    decoration.className = 'decoration';
    viewport.append(canvas, decoration);
    root.append(css, viewport);
    document.body.prepend(host);
    const renderer = new CanvasRenderer(
      canvas,
      decoration,
      (interaction: { key: string } | null, _: unknown, pin: boolean) => {
        if (!session.inspect(interaction?.key ?? null, pin)) return;
        renderer.focus(session.active);
        host.setAttribute(
          'data-inspection',
          JSON.stringify({
            key: session.active?.key ?? null,
            pinned: session.pinned,
            rowIndices:
              session.active?.sources.map((row: unknown) =>
                compiled.document.data.rows.indexOf(row)
              ) ?? []
          })
        );
      }
    );
    const size = canvas.getBoundingClientRect();
    const scene = layoutChart(
      compiled,
      session.hidden,
      size.width,
      size.height,
      (text: string) => text.length * 6
    );
    session.setModel(scene);
    renderer.render(scene);
    const first = scene.marks.find((mark: { kind: string }) => mark.kind === 'rect');
    host.dataset.first = JSON.stringify(first);
    host.addEventListener('dispose-chart', () => {
      renderer.dispose();
      session.reset();
    });
  }, sample);
  const host = page.locator('#headless-host');
  await expect(host.locator('scope-chart')).toHaveCount(0);
  const mark = JSON.parse((await host.getAttribute('data-first'))!);
  const frame = (await host.locator('.plot-canvas').boundingBox())!;
  const x = frame.x + mark.x + mark.width / 2,
    y = frame.y + mark.y + mark.height / 2;
  const before = await pixel(
    page,
    '#headless-host',
    mark.x + mark.width / 2,
    mark.y + mark.height / 2
  );
  expect(before).toEqual([207, 115, 71, 255]);
  await page.mouse.move(x, y);
  const hovered = await pixel(
    page,
    '#headless-host',
    mark.x + mark.width / 2,
    mark.y + mark.height / 2
  );
  // Key-only hosts inspect the bucket without choosing a segment to recolor.
  expect(hovered).toEqual(before);
  expect(JSON.parse((await host.getAttribute('data-inspection'))!).rowIndices).toEqual([0, 1, 2]);
  await page.mouse.click(x, y);
  await page.mouse.move(5, 5);
  expect(JSON.parse((await host.getAttribute('data-inspection'))!).pinned).toBe(true);
  await page.mouse.click(x, y);
  expect(JSON.parse((await host.getAttribute('data-inspection'))!).key).toBeNull();
  await host.evaluate((el) => el.dispatchEvent(new Event('dispose-chart')));
  await expect(host.locator('canvas')).toHaveCount(0);
});

test('keyboard inspection pins source rows, announces values and dismisses', async ({ page }) => {
  await page.goto('/');
  const chart = page.locator('#requests');
  const inspect = chart.getByRole('button', { name: 'Inspect chart', exact: true });
  await expect(inspect).toBeEnabled();
  await inspect.click();
  await expect(chart.getByRole('tooltip')).toBeVisible();
  await expect(chart.locator('.live')).toContainText('api: 120');
  await inspect.press('ArrowRight');
  await expect(chart.locator('.live')).toContainText('api: 180');
  await inspect.press('Enter');
  await expect(chart.locator('.tooltip.pinned')).toBeVisible();
  await expect(page.locator('#selection')).toContainText('Selected 3 source rows');
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(chart.locator('.tooltip.pinned')).toBeVisible();
  await expect(inspect).toBeFocused();
  await inspect.press('Escape');
  await expect(chart.locator('.tooltip')).toBeHidden();
  await expect(page.locator('#selection')).toContainText('Selection cleared');
  await inspect.press('End');
  await expect(chart.locator('.live')).toContainText('api: 350');
  await inspect.press('Enter');
  await chart.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(inspect).toBeFocused();
  await expect(chart.locator('.tooltip')).toBeHidden();
});

test('legend visibility and isolation stay local and keep stable paints', async ({ page }) => {
  await page.goto('/');
  const chart = page.locator('#requests');
  await expect(chart).toHaveAttribute('data-state', 'ready');
  const api = chart.locator('.legend button').filter({ hasText: 'api' });
  const swatch = api.locator('.swatch');
  const color = await swatch.evaluate((el) => getComputedStyle(el).backgroundColor);
  await api.click();
  await expect(api).toHaveAttribute('aria-pressed', 'false');
  await chart.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(swatch).toHaveCSS('background-color', color);
  await api.click({ modifiers: ['Shift'] });
  await expect(chart.locator('.legend button[aria-pressed=false]')).toHaveCount(2);
  await expect(page.locator('#status .legend button[aria-pressed=false]')).toHaveCount(0);
  await chart.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(chart.locator('.legend button[aria-pressed=true]')).toHaveCount(3);
});

test('loading, empty, invalid input and retry recover without changing the chart frame', async ({
  page
}) => {
  await page.goto('/');
  const chart = page.locator('#requests');
  await expect(chart).toHaveAttribute('data-state', 'ready');
  const height = await chart
    .locator('.viewport')
    .evaluate((el) => el.getBoundingClientRect().height);
  for (const state of ['loading', 'empty', 'error', 'ready']) {
    await page.locator('#state').selectOption(state);
    await expect(chart).toHaveAttribute('data-state', state);
    expect(
      await chart.locator('.viewport').evaluate((el) => el.getBoundingClientRect().height)
    ).toBe(height);
  }
  const hostError = await chart.evaluate((el) => {
    const element = el as ScopeChartElement;
    element.error = 'Unable to load data.';
    return { attribute: element.getAttribute('error'), property: element.error };
  });
  expect(hostError).toEqual({
    attribute: 'Unable to load data.',
    property: 'Unable to load data.'
  });
  await expect(chart).toHaveAttribute('data-state', 'error');
  await expect(chart.getByRole('alert')).toHaveText('Unable to load data.');
  await chart.evaluate((el) => {
    (el as ScopeChartElement).error = null;
  });
  await expect(chart).not.toHaveAttribute('error');
  await expect(chart).toHaveAttribute('data-state', 'ready');
  await chart.evaluate((el) => {
    (el as ScopeChartElement).document = { version: 99 };
  });
  await expect(chart.getByRole('alert')).toContainText('version');
  await page.locator('#visualization').selectOption('area');
  await expect(chart).toHaveAttribute('data-state', 'ready');
  await chart.evaluate((el) => {
    const parent = el.parentElement!;
    el.remove();
    parent.append(el);
  });
  await expect(chart).toHaveAttribute('data-state', 'ready');
  await expect(chart.locator('.plot-canvas')).toHaveCount(1);
});

test('320px embeds keep metrics visible and tooltips within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  const chart = page.locator('#requests');
  await expect(chart).toHaveAttribute('data-state', 'ready');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  const scene = await sceneFor(page, '#requests');
  const ticks = scene.xTicks;
  expect(ticks.length).toBeGreaterThan(1);
  for (let i = 1; i < ticks.length; i++)
    expect(ticks[i].position).toBeGreaterThan(ticks[i - 1].position);
  await chart.getByRole('button', { name: 'Inspect chart', exact: true }).click();
  await chart.getByRole('button', { name: 'Inspect chart', exact: true }).press('Enter');
  const tooltip = await chart.locator('.tooltip').boundingBox();
  expect(tooltip!.x).toBeGreaterThanOrEqual(0);
  expect(tooltip!.x + tooltip!.width).toBeLessThanOrEqual(320);
  const metrics = page.locator('#metric .metrics');
  expect(await metrics.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
});

test('Canvas scatter and donut hit their geometry and clear inside the donut hole', async ({
  page
}) => {
  await page.goto('/');
  const scatter = page.locator('#scatter');
  await expect(scatter).toHaveAttribute('data-state', 'ready');
  await moveToMark(page, '#scatter');
  await expect(scatter.getByRole('tooltip')).toContainText('scanned_mb');
  await page.mouse.down();
  await page.mouse.up();
  await expect(scatter.locator('.tooltip.pinned')).toBeVisible();
  await scatter.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(scatter.locator('.tooltip')).toBeHidden();
  const donut = page.locator('#status');
  await moveToMark(page, '#status', 0, true);
  await expect(donut.locator('.tooltip.pinned')).toContainText('8,210');
  await donut.getByRole('button', { name: 'Close', exact: true }).click();
  const frame = await donut.locator('.plot-canvas').boundingBox();
  await page.mouse.move(frame!.x + frame!.width / 2, frame!.y + frame!.height / 2);
  await expect(donut.locator('.tooltip')).toBeHidden();
});

test('pointer hover, click pinning and outside dismissal preserve grouped values', async ({
  page
}) => {
  await page.goto('/');
  const chart = page.locator('#requests');
  await expect(chart).toHaveAttribute('data-state', 'ready');
  const scene = await sceneFor(page, '#requests');
  const x = scene.frame.x + scene.interactions[2].anchor.x,
    y = scene.frame.y + scene.rect!.y + scene.rect!.height / 2;
  await page.mouse.move(x, y);
  await expect(chart.getByRole('tooltip')).toContainText('160');
  await page.mouse.click(x, y);
  await page.mouse.move(5, 5);
  await expect(chart.locator('.tooltip.pinned')).toBeVisible();
  await expect(page.locator('#selection')).toContainText('Selected 3 source rows');
  await page.mouse.click(5, 5);
  await expect(chart.locator('.tooltip')).toBeHidden();
});

test('bar hover highlights its complete stack or group, clears in gaps and preserves a pin on resize', async ({
  page
}) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto('/');
  await page.locator('#visualization').selectOption('bar');
  const chart = page.locator('#requests');
  await expect(chart).toHaveAttribute('data-state', 'ready');
  await chart.evaluate((el) => {
    el.addEventListener('scope-inspect', (event) => {
      el.setAttribute('data-inspection', JSON.stringify((event as CustomEvent).detail));
    });
  });
  let scene = await sceneFor(page, '#requests'),
    bars = rectangles(scene.marks);
  expect(bars).toHaveLength(26);
  await moveToMark(page, '#requests');
  const key = bars[0].key;
  expect(bars.filter((mark) => mark.key === key)).toHaveLength(3);
  await expect(chart.getByRole('tooltip')).toContainText('120');
  await expect(chart.getByRole('tooltip')).toContainText('90');
  await expect(chart.getByRole('tooltip')).toContainText('30');
  const inspection = JSON.parse((await chart.getAttribute('data-inspection'))!);
  expect(inspection.kind).toBe('metric');
  expect(inspection.rowIndices).toEqual([0, 1, 2]);
  const sameColumn = bars.filter((mark) => mark.key === key),
    last = sameColumn.at(-1)!;
  await page.mouse.move(
    scene.frame.x + last.x + last.width / 2,
    scene.frame.y + last.y + last.height / 2
  );
  expect(JSON.parse((await chart.getAttribute('data-inspection'))!).rowIndices).toEqual([0, 1, 2]);
  const a = bars[0],
    b = bars[1];
  const gap = {
    x: scene.frame.x + (a.x + a.width / 2 + b.x + b.width / 2) / 2,
    y: scene.frame.y + a.y + a.height / 2
  };
  await page.mouse.move(gap.x, gap.y);
  await expect(chart.locator('.tooltip')).toBeHidden();
  await moveToMark(page, '#requests', 0, true);
  await page.mouse.move(gap.x, gap.y);
  await expect(chart.locator('.tooltip.pinned')).toBeVisible();
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(chart.locator('.tooltip.pinned')).toBeVisible();
  await chart.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(chart.locator('.tooltip')).toBeHidden();
  await chart.evaluate((el) => {
    const value = (el as ScopeChartElement).document!;
    value.options = { ...value.options, stack: false };
    (el as ScopeChartElement).document = value;
  });
  await moveToMark(page, '#requests');
  scene = await sceneFor(page, '#requests');
  bars = rectangles(scene.marks);
  expect(bars).toHaveLength(26);
  expect(new Set(bars.filter((mark) => mark.key === bars[0].key).map((mark) => mark.x)).size).toBe(
    3
  );
  await chart.locator('.legend button').filter({ hasText: 'api' }).click();
  await moveToMark(page, '#requests');
  bars = rectangles((await sceneFor(page, '#requests')).marks);
  expect(bars).toHaveLength(18);
  expect(bars.filter((mark) => mark.key === bars[0].key)).toHaveLength(2);
  await expect(chart.getByRole('tooltip')).not.toContainText('api');
});

test('zero and NULL columns read their own source without fabricating painted bars', async ({
  page
}) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto('/');
  const chart = page.locator('#requests');
  const value = structuredClone(sample);
  value.spec.visualization = 'bar';
  value.data.rows = [
    ['2026-09-29T02:00:00Z', 'api', '0'],
    ['2026-09-29T02:05:00Z', 'api', null],
    ['2026-09-29T02:10:00Z', 'api', '-3']
  ];
  await chart.evaluate((el, value) => {
    el.addEventListener('scope-inspect', (event) => {
      el.setAttribute('data-inspection', JSON.stringify((event as CustomEvent).detail));
    });
    (el as ScopeChartElement).document = value;
  }, value);
  const scene = await sceneFor(page, '#requests');
  expect(rectangles(scene.marks)).toHaveLength(1);
  const inspect = chart.getByRole('button', { name: 'Inspect chart', exact: true });
  await inspect.click();
  await expect(chart.locator('.tooltip-value')).toHaveText('0');
  const zero = scene.interactions[0].anchor,
    r = scene.rect!;
  await page.mouse.move(scene.frame.x + zero.x, scene.frame.y + r.y + r.height / 2);
  await expect(chart.locator('.tooltip-value')).toHaveText('0');
  const negative = rectangles(scene.marks)[0];
  await page.mouse.move(
    scene.frame.x + (zero.x + negative.x + negative.width / 2) / 2,
    scene.frame.y + r.y + r.height / 2
  );
  await expect(chart.locator('.tooltip-value')).toHaveText('NULL');
  expect(JSON.parse((await chart.getAttribute('data-inspection'))!).rowIndices).toEqual([1]);
});

test('self-contained export runs offline in a sandbox and treats labels as text', async ({
  page
}) => {
  const hostile = { ...sample, title: '</script><img src=x onerror="window.injection=true">' };
  mkdirSync('.local', { recursive: true });
  writeFileSync('.local/embed-input.json', JSON.stringify(hostile));
  execFileSync('node', [
    'node/cli.mjs',
    'render',
    '.local/embed-input.json',
    '--output',
    '.local/embed.html',
    '--format',
    'fragment',
    '--force'
  ]);
  const html = readFileSync('.local/embed.html', 'utf8');
  expect(Buffer.byteLength(html)).toBeLessThan(1_000_000);
  expect(html).not.toContain(hostile.title);
  await page.goto('/');
  await expect(page.locator('scope-chart[data-state=ready]')).toHaveCount(4);
  const documents = await page
    .locator('scope-chart')
    .evaluateAll((elements) => elements.map((el) => (el as ScopeChartElement).document!));
  await page.route('**/*', (route) => route.abort());
  await page.setContent(
    '<iframe sandbox="allow-scripts" style="width:100%;height:600px;border:0"></iframe>'
  );
  await page.locator('iframe').evaluate((frame, html) => {
    (frame as HTMLIFrameElement).srcdoc = html;
  }, html);
  const chart = page.frameLocator('iframe').locator('.scopeview-view');
  await expect(chart).toHaveAttribute('data-state', 'ready');
  await expect(chart.locator('header, h2, button, table')).toHaveCount(0);
  await expect(chart.locator('img')).toHaveCount(0);
  await expect(chart.locator('.plot-canvas')).toBeVisible();
  await chart.locator('.canvas').press('Home');
  await expect(chart.getByRole('tooltip')).toBeVisible();
  for (const style of ['area', 'bar'] as const) {
    const value = structuredClone(documents[0]);
    value.spec.visualization = style;
    documents.push(value);
  }
  for (const value of documents) {
    await chart.evaluate((el, value) => {
      (
        el.closest('[data-scopeview]') as HTMLElement & {
          scopeviewView: import('../../src/headless.js').ChartView;
        }
      ).scopeviewView.update(value);
    }, value);
    await expect(chart).toHaveAttribute('data-state', 'ready');
    if (value.spec.visualization !== 'big-number')
      await expect(chart.locator('.plot-canvas')).toBeVisible();
    else await expect(chart.locator('.value-number').first()).toHaveText('8,990');
  }
});

test('declarative JSON upgrades and observes text updates', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((value) => {
    const el = document.createElement('scope-chart');
    el.id = 'declarative';
    const script = document.createElement('script');
    script.type = 'application/json';
    script.textContent = JSON.stringify(value);
    el.append(script);
    document.body.append(el);
  }, sample);
  const chart = page.locator('#declarative');
  await expect(chart).toHaveAttribute('data-state', 'ready');
  await chart.locator('script').evaluate((el) => {
    el.textContent = '{bad json';
  });
  await expect(chart).toHaveAttribute('data-state', 'error');
  await chart.locator('script').evaluate((el, value) => {
    el.textContent = JSON.stringify(value);
  }, sample);
  await expect(chart).toHaveAttribute('data-state', 'ready');
});

test('overflowing stacks become a recoverable local error with original data available', async ({
  page
}) => {
  await page.goto('/');
  const chart = page.locator('#requests');
  await expect(chart).toHaveAttribute('data-state', 'ready');
  await chart.evaluate((element) => {
    const el = element as ScopeChartElement,
      doc = el.document!;
    doc.spec.visualization = 'bar';
    doc.data.rows = doc.data.rows.slice(0, 2).map((row) => [row[0], row[1], '1e308']);
    el.document = doc;
  });
  await expect(chart.getByRole('alert')).toContainText('stack total');
  await expect(chart.getByRole('button', { name: 'Inspect chart', exact: true })).toBeDisabled();
  await expect(chart.locator('.plot-canvas')).toHaveCount(0);
  await chart.getByRole('button', { name: 'View data', exact: true }).click();
  await expect(chart.getByRole('cell', { name: '1e308', exact: true })).toHaveCount(2);
  await page.locator('#visualization').selectOption('line');
  await expect(chart).toHaveAttribute('data-state', 'ready');
  await expect(chart.getByRole('button', { name: 'Inspect chart', exact: true })).toBeEnabled();
});

test('local time inspection distinguishes both occurrences of a repeated DST hour', async ({
  browser,
  baseURL
}) => {
  const context = await browser.newContext({
    timezoneId: 'America/New_York',
    viewport: { width: 1100, height: 900 },
    deviceScaleFactor: 2
  });
  try {
    const page = await context.newPage();
    await page.goto(baseURL ?? 'http://127.0.0.1:4173/');
    const chart = page.locator('#requests');
    await expect(chart).toHaveAttribute('data-state', 'ready');
    await chart.evaluate((element) => {
      const el = element as ScopeChartElement,
        doc = el.document!;
      doc.data.rows = Array.from({ length: 5 }, (_, i) => [
        new Date(Date.parse('2026-11-01T05:00:00Z') + i * 30 * 60_000).toISOString(),
        'api',
        String(i + 1)
      ]);
      el.document = doc;
    });
    const ticks = (await sceneFor(page, '#requests')).xTicks.map((tick) => tick.label).join(' ');
    expect(ticks).toContain('EDT');
    expect(ticks).toContain('EST');
    const inspect = chart.getByRole('button', { name: 'Inspect chart', exact: true });
    await inspect.click();
    await expect(chart.getByRole('tooltip')).toContainText('01:00');
    await expect(chart.getByRole('tooltip')).toContainText('EDT');
    await inspect.press('ArrowRight');
    await inspect.press('ArrowRight');
    await expect(chart.getByRole('tooltip')).toContainText('01:00');
    await expect(chart.getByRole('tooltip')).toContainText('EST');
  } finally {
    await context.close();
  }
});
