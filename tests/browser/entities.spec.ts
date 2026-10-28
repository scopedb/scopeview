import { test, expect, type Page } from '@playwright/test';
import type { ScopeTraceElement, ScopeFlameElement } from '../../src/element.js';

import { createEmbed } from '../../node/embed.mjs';
import { pixel, settleRendering } from './scene.js';

async function geometry(page: Page, host: string) {
  return page.locator(host).evaluate((node) => {
    const element = node as ScopeTraceElement | ScopeFlameElement,
      scene = element.scene!;
    const bounds = node.shadowRoot!.querySelector('.canvas')!.getBoundingClientRect();
    return {
      marks: scene.marks,
      interactions: scene.interactions,
      rect: scene.rect!,
      viewport: element.viewport,
      navigation: scene.navigation!.interactions.length,
      frame: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    };
  });
}
async function point(page: Page, host: string, key: string) {
  await page.locator(`${host} .canvas`).scrollIntoViewIfNeeded();
  await settleRendering(page);
  const scene = await geometry(page, host),
    mark = scene.marks.find((mark) => mark.kind === 'rect' && mark.key === key);
  if (!mark || mark.kind !== 'rect') throw new Error(`Missing mark ${key}`);
  // Keep off text and inside the plot when the row is clipped at the viewport edge.
  return {
    x: scene.frame.x + mark.x + mark.width / 2,
    y: scene.frame.y + Math.max(scene.rect.y, mark.y) + 3,
    local: { x: mark.x + mark.width / 2, y: Math.max(scene.rect.y, mark.y) + 3 }
  };
}
test.beforeEach(async ({ page }) => {
  await page.goto('/examples/families.html');
  await expect(
    page.locator('scope-trace[data-state=ready],scope-flame[data-state=ready]')
  ).toHaveCount(2);
});

test('uses one Canvas and the same inspector while retaining exact sources and zero nodes', async ({
  page
}) => {
  await expect(page.locator('#trace canvas')).toHaveCount(1);
  await expect(page.locator('#flame canvas')).toHaveCount(1);
  const p = await point(page, '#trace', 'trace:parse'),
    before = await pixel(page, '#trace', p.local.x, p.local.y);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator('#trace .tooltip')).toContainText('10.000001 ms');
  expect(await pixel(page, '#trace', p.local.x, p.local.y)).toEqual(before);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#trace .tooltip')).toHaveClass(/pinned/);
  await expect(page.locator('#trace .tooltip')).toContainText('10,000,001 ns');
  await expect(page.locator('#events')).toContainText('1790643600000000001');
  await page
    .locator('#trace .tooltip')
    .getByRole('button', { name: 'Close', exact: true })
    .press('Escape');
  await expect(page.locator('#trace .tooltip')).toBeHidden();
  await expect(page.locator('#trace .canvas')).toBeFocused();
  const canvas = page.locator('#flame .canvas');
  await canvas.press('End');
  await expect(page.locator('#flame .tooltip')).toContainText('idle · zero weight');
  await expect(page.locator('#flame .tooltip')).toContainText('0 samples');
  await page.locator('#trace').getByRole('button', { name: 'View data', exact: true }).click();
  await expect(
    page.locator('#trace').getByRole('cell', { name: '1790643600000000001', exact: true }).first()
  ).toBeVisible();
});

test('distinguishes drag from pin and provides anchor zoom, pan and reset', async ({ page }) => {
  const canvas = page.locator('#trace .canvas');
  await canvas.press('+');
  await expect
    .poll(
      async () =>
        (await geometry(page, '#trace')).viewport.end -
        (await geometry(page, '#trace')).viewport.start
    )
    .toBeCloseTo(0.5);
  const scene = await geometry(page, '#trace'),
    p = await point(page, '#trace', 'trace:worker-a');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x - 60, p.y, { steps: 8 });
  await expect(canvas).toHaveAttribute('data-scope-panning', '');
  await expect(page.locator('#trace .plot')).toHaveCSS('cursor', 'grabbing');
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute('data-scope-panning', '');
  await expect
    .poll(async () => (await geometry(page, '#trace')).viewport.start)
    .toBeGreaterThan(scene.viewport.start);
  await expect(page.locator('#trace .tooltip')).not.toHaveClass(/pinned/);
  await canvas.press('0');
  await expect.poll(async () => (await geometry(page, '#trace')).viewport.start).toBe(0);
  await expect.poll(async () => (await geometry(page, '#trace')).viewport.end).toBe(1);
  const root = await point(page, '#trace', 'trace:query');
  await page.mouse.move(root.x, root.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await geometry(page, '#trace')).viewport.end).toBeLessThan(1);
});

test('virtualizes 10,000 parallel spans and reveals the last logical node for keyboard inspection', async ({
  page
}) => {
  await page.locator('#large').click();
  await expect.poll(async () => (await geometry(page, '#trace')).navigation).toBe(10_000);
  expect((await geometry(page, '#trace')).marks.length).toBeLessThan(40);
  await page.locator('#trace .canvas').press('End');
  await expect(page.locator('#trace .tooltip')).toContainText('worker 9999');
  await expect
    .poll(async () => (await geometry(page, '#trace')).viewport.scrollOffset)
    .toBeGreaterThan(200_000);
  expect((await geometry(page, '#trace')).marks.length).toBeLessThan(40);
  expect(
    (await geometry(page, '#trace')).interactions.some((value) => value.key === 'trace:9999')
  ).toBe(true);
  await page.locator('#trace .canvas').press('Enter');
  await expect(page.locator('#events')).toContainText('"id": "9999"');
  await page.locator('#trace .canvas').press('Home');
  await expect(page.locator('#trace .tooltip')).toContainText('worker 0');
});

test('virtualizes a deep profile and preserves pin through viewport, paint and resize changes', async ({
  page
}) => {
  await page.locator('#deep').click();
  await expect.poll(async () => (await geometry(page, '#flame')).navigation).toBe(2000);
  await page.locator('#flame .canvas').press('End');
  // Focus can scroll the containing page after keydown; it must not erase keyboard reading.
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  await page.locator('#flame .canvas').dispatchEvent('pointerleave');
  await expect(page.locator('#flame .tooltip')).toContainText('frame 1999');
  await page.locator('#flame .canvas').press('Enter');
  await expect(page.locator('#flame .tooltip')).toContainText('frame 1999');
  await page.locator('#flame').evaluate((node) => {
    const element = node as ScopeFlameElement;
    element.viewport = { start: 0, end: 0.2, scrollOffset: 0 };
    element.style.setProperty('--color-chart-series-1', '#ef7755');
    element.refresh();
  });
  await expect(page.locator('#flame .tooltip')).toHaveClass(/pinned/);
  await expect(page.locator('#flame .tooltip')).toContainText('frame 1999');
  await page.setViewportSize({ width: 360, height: 900 });
  await expect(page.locator('#flame .tooltip')).toHaveClass(/pinned/);
  await page.locator('#flame .canvas').press('Enter');
  await expect
    .poll(async () => (await geometry(page, '#flame')).viewport.scrollOffset)
    .toBeGreaterThan(40_000);
});

test('collapses subtrees without changing weights, expands ancestors on focus, and clears hidden pins', async ({
  page
}) => {
  await page
    .locator('#flame')
    .evaluate((node) => (node as ScopeFlameElement).focusNode('scan', { pin: true }));
  await page.locator('#flame').getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect.poll(async () => (await geometry(page, '#flame')).navigation).toBe(4);
  await expect(page.locator('#flame .tooltip')).toContainText('80 samples');
  await page
    .locator('#flame')
    .evaluate((node) => (node as ScopeFlameElement).focusNode('decode', { pin: true }));
  await expect.poll(async () => (await geometry(page, '#flame')).navigation).toBe(6);
  await expect(page.locator('#flame .tooltip')).toContainText('decoder.ts:42');
  await page.locator('#flame').evaluate((node) => {
    (node as ScopeFlameElement).collapsed = ['scan'];
  });
  await expect(page.locator('#flame .tooltip')).toBeHidden();
});

test('recovers from invalid data, loading, empty and reconnect with owned snapshots', async ({
  page
}) => {
  const chart = page.locator('#trace');
  await chart.evaluate((node) => {
    const element = node as ScopeTraceElement;
    const doc = element.document!;
    doc.spans[0] = { ...doc.spans[0], name: 'mutated' };
    element.loading = true;
  });
  await expect(chart).toHaveAttribute('data-state', 'loading');
  await expect(chart.locator('canvas')).toHaveCount(0);
  await chart.evaluate((node) => {
    (node as ScopeTraceElement).loading = false;
  });
  await expect(chart).toHaveAttribute('data-state', 'ready');
  expect(await chart.evaluate((node) => (node as ScopeTraceElement).document!.spans[0].name)).toBe(
    'SELECT · logs'
  );
  await chart.evaluate((node) => {
    (node as ScopeTraceElement).document = {
      version: 1,
      kind: 'trace',
      spans: [{ id: 'a', name: 'bad', startTimeNs: 1, endTimeNs: '2' }]
    };
  });
  await expect(chart).toHaveAttribute('data-state', 'error');
  await page.locator('#small').click();
  await expect(chart).toHaveAttribute('data-state', 'ready');
  await chart.evaluate((node) => {
    const parent = node.parentElement!;
    node.remove();
    parent.append(node);
  });
  await expect(chart.locator('canvas')).toHaveCount(1);
  await expect(chart).toHaveAttribute('data-state', 'ready');
  await chart.evaluate((node) => {
    (node as ScopeTraceElement).document = { version: 1, kind: 'trace', spans: [] };
  });
  await expect(chart).toHaveAttribute('data-state', 'empty');
  await expect(chart.locator('canvas')).toHaveCount(0);
});

test('cancels in-flight viewport gestures when data or host state changes', async ({ page }) => {
  const p = await point(page, '#trace', 'trace:worker-a');
  await page.locator('#trace .canvas').press('+');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x - 60, p.y, { steps: 5 });
  await page.locator('#trace').evaluate((node) => {
    const element = node as ScopeTraceElement;
    const snapshot = element.document;
    element.document = snapshot;
  });
  await expect.poll(async () => (await geometry(page, '#trace')).viewport.start).toBe(0);
  await page.mouse.up();
  await expect(page.locator('#trace .tooltip')).toBeHidden();
  const next = await point(page, '#trace', 'trace:parse');
  await page.mouse.click(next.x, next.y);
  await expect(page.locator('#trace .tooltip')).toHaveClass(/pinned/);
  await page.locator('#trace').evaluate((node) => {
    const element = node as ScopeTraceElement;
    element.error = 'Host failure';
    element.loading = true;
  });
  await expect(page.locator('#trace')).toHaveAttribute('data-state', 'error');
  await page.locator('#trace').evaluate((node) => {
    const element = node as ScopeTraceElement;
    element.error = null;
    element.loading = false;
  });
  await expect(page.locator('#trace')).toHaveAttribute('data-state', 'ready');
});

test('preserves vertical touch page scroll and supports horizontal viewport panning', async ({
  browser
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 700 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  try {
    await page.goto('/examples/families.html');
    await expect(page.locator('#trace')).toHaveAttribute('data-state', 'ready');
    await page.locator('#trace').evaluate((node) => {
      (node as ScopeTraceElement).viewport = { start: 0.2, end: 0.6, scrollOffset: 0 };
    });
    const p = await point(page, '#trace', 'trace:worker-a'),
      cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: p.x, y: p.y }]
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: p.x - 65, y: p.y }]
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(async () => (await geometry(page, '#trace')).viewport.start)
      .toBeGreaterThan(0.2);
    await expect(page.locator('#trace .tooltip')).toBeHidden();
    const vertical = await point(page, '#trace', 'trace:worker-a');
    const before = await geometry(page, '#trace');
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: vertical.x, y: vertical.y }]
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: vertical.x, y: vertical.y - 90 }]
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect((await geometry(page, '#trace')).viewport).toEqual(before.viewport);
  } finally {
    await context.close();
  }
});

test('supports declarative updates, disabled interaction and narrow layouts', async ({ page }) => {
  await page.evaluate(() => {
    const chart = document.createElement('scope-trace');
    chart.id = 'declarative';
    chart.configure({ toolbar: false });
    const script = document.createElement('script');
    script.type = 'application/json';
    script.textContent = JSON.stringify({
      version: 1,
      kind: 'trace',
      title: '<img src=x onerror=alert(1)>',
      spans: [{ id: 'x', name: 'safe', startTimeNs: '1', endTimeNs: '2' }],
      options: { interactive: false }
    });
    chart.append(script);
    document.querySelector('main')!.append(chart);
  });
  await expect(page.locator('#declarative')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#declarative .canvas')).not.toHaveAttribute('tabindex');
  await expect(page.locator('#declarative .toolbar')).toBeHidden();
  await expect(page.locator('#declarative img')).toHaveCount(0);
  await page.locator('#declarative script').evaluate((node) => {
    const doc = JSON.parse(node.textContent!);
    doc.title = 'Updated';
    node.textContent = JSON.stringify(doc);
  });
  await expect(page.locator('#declarative h2')).toHaveText('Updated');
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('exports both entity families as self-contained offline embeds with safe script data', async ({
  page
}) => {
  for (const family of ['trace', 'profile'] as const) {
    const source =
      family === 'trace'
        ? {
            version: 1,
            kind: family,
            spans: [
              {
                id: 'x',
                name: '</script><img src=x>',
                startTimeNs: '1790643600000000001',
                endTimeNs: '1790643600000000002'
              }
            ]
          }
        : {
            version: 1,
            kind: family,
            unit: 'samples',
            frames: [{ id: 'x', name: '</script><img src=x>', selfWeight: '9007199254740993' }]
          };
    const html = await createEmbed(source, { format: 'fragment' });
    await page.route('**/*', (route) => route.abort());
    await page.setContent(
      `<style>body{margin:0}</style><iframe style="width:700px;height:500px" sandbox="allow-scripts" srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`
    );
    const frame = page.frameLocator('iframe'),
      tag = '.scopeview-view';
    await expect(frame.locator(tag)).toHaveAttribute('data-state', 'ready');
    await frame.locator(`${tag} .canvas`).press('Home');
    await expect(frame.locator(`${tag} .tooltip`)).toContainText('</script><img src=x>');
    await expect(frame.locator('img')).toHaveCount(0);
    await page.unroute('**/*');
  }
});
