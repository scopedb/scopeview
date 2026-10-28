import { test, expect, type Locator } from '@playwright/test';
import type { ChartView } from '../../src/headless.js';
import { pixels, settleRendering } from './scene.js';

declare global {
  interface Window {
    reportPaint: ChartView;
  }
}

/** Find actual data ink, independently of the layout/hit-testing implementation. */
async function paintedPoints(canvas: Locator, line: boolean) {
  return canvas.evaluate((node, line) => {
    const canvas = node as HTMLCanvasElement;
    const probe = document.createElement('span');
    canvas.parentElement!.append(probe);
    const colorContext = document.createElement('canvas').getContext('2d')!;
    const palette = new Set<string>();
    for (let index = 1; index <= 10; index++) {
      probe.style.color = `var(--color-chart-series-${index}${line ? '-line' : ''})`;
      colorContext.clearRect(0, 0, 1, 1);
      colorContext.fillStyle = getComputedStyle(probe).color;
      colorContext.fillRect(0, 0, 1, 1);
      palette.add([...colorContext.getImageData(0, 0, 1, 1).data].join(','));
    }
    probe.remove();
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let longest: number[] = [],
      row = 0;
    for (let y = 0; y < canvas.height; y++) {
      const xs: number[] = [];
      for (let x = 0; x < canvas.width; x++) {
        const offset = (y * canvas.width + x) * 4;
        if (data[offset + 3] !== 255) continue;
        if (palette.has(`${data[offset]},${data[offset + 1]},${data[offset + 2]},255`)) xs.push(x);
      }
      if (xs.length > longest.length) {
        longest = xs;
        row = y;
      }
    }
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    return {
      ink: longest.length,
      // A categorical line reads supplied endpoints, not interpolated positions between them.
      points: (line ? [0.03, 0.97] : [0.25, 0.75]).map((fraction) => ({
        x: (longest[Math.floor(longest.length * fraction)] + 0.5) / scale,
        y: (row + 0.5) / scale
      }))
    };
  }, line);
}

test.use({ deviceScaleFactor: 2 });

for (const { width, theme } of [
  { width: 900, theme: 'light' },
  { width: 390, theme: 'dark' }
] as const) {
  test(`built report paints and follows the pointer at ${width}px in ${theme}`, async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/tests/browser/fixtures/blank.html');
    await page.evaluate(() => {
      document.body.style.cssText = 'margin:16px;min-height:1400px';
      const host = document.createElement('div');
      host.id = 'report-paint';
      host.style.cssText =
        'margin-top:48px;max-width:640px;overflow:hidden;transform:translateZ(0)';
      document.body.append(host);
    });

    for (const family of ['line', 'bar', 'trace', 'profile']) {
      await test.step(family, async () => {
        // WebKit can re-hit a stationary pointer when the next view mounts beneath it.
        await page.mouse.move(1, 1);
        await page.evaluate(
          async ({ family, theme }) => {
            const host = document.getElementById('report-paint')!;
            const entry = '/dist/report.js';
            const { createReport } = await import(entry);
            const input =
              family === 'trace'
                ? {
                    version: 1,
                    kind: 'trace',
                    spans: [
                      {
                        id: 'root',
                        name: 'executeQueryWithCompleteSourceName',
                        startTimeNs: '0',
                        endTimeNs: '100000000'
                      }
                    ]
                  }
                : family === 'profile'
                  ? {
                      version: 1,
                      kind: 'profile',
                      unit: 'samples',
                      frames: [
                        {
                          id: 'root',
                          name: 'evaluateExpressionWithCompleteSourceName',
                          selfWeight: '100'
                        }
                      ]
                    }
                  : {
                      version: 1,
                      data: {
                        fields: [
                          { name: 'service', data_type: 'string' },
                          { name: 'requests', data_type: 'number' }
                        ],
                        rows: [
                          ['Query', '120'],
                          ['Ingest', '120']
                        ]
                      },
                      spec: {
                        visualization: family,
                        encoding: { x: 'service', y: ['requests'] }
                      }
                    };
            window.reportPaint = await createReport(host, input, { theme });
          },
          { family, theme }
        );
        const view = page.locator('#report-paint .scopeview-view');
        const canvas = view.locator('canvas[data-layer=marks]');
        const tooltip = view.getByRole('tooltip');
        await expect(view).toHaveAttribute('data-state', 'ready');
        await settleRendering(page);
        const background = theme === 'dark' ? 'rgb(26, 32, 41)' : 'rgb(255, 255, 255)';
        await expect(view).toHaveCSS('background-color', background);
        const frame = (await canvas.boundingBox())!;
        await expect(canvas).toHaveAttribute('width', String(frame.width * 2));
        await expect(canvas).toHaveAttribute('height', '480');
        const { ink, points } = await paintedPoints(canvas, family === 'line');
        expect(ink).toBeGreaterThan(40);
        const before = await pixels(page, '#report-paint', points);
        const reading =
          family === 'trace' ? '100 ms' : family === 'profile' ? '100 samples' : '120';
        const boxes = [];
        for (const [index, point] of points.entries()) {
          const pointer = { x: frame.x + point.x, y: frame.y + point.y + index * 2 };
          await page.mouse.move(pointer.x, pointer.y);
          await expect(tooltip).toBeVisible();
          await expect(tooltip).toContainText(reading);
          await expect(tooltip).toHaveCSS('font-size', '12px');
          await expect(tooltip).toHaveCSS('background-color', background);
          await expect(tooltip).toHaveCSS('pointer-events', 'none');
          expect(await tooltip.evaluate((node) => node.matches(':popover-open'))).toBe(true);
          const box = (await tooltip.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(7);
          expect(box.x + box.width).toBeLessThanOrEqual(width - 7);
          expect(box.y).toBeGreaterThanOrEqual(7);
          expect(box.y + box.height).toBeLessThanOrEqual(693);
          expect(
            pointer.x > box.x &&
              pointer.x < box.x + box.width &&
              pointer.y > box.y &&
              pointer.y < box.y + box.height
          ).toBe(false);
          boxes.push(box);
        }
        expect(boxes[1]).not.toEqual(boxes[0]);
        if (family === 'trace')
          await expect(tooltip).toContainText('executeQueryWithCompleteSourceName');
        if (family === 'profile')
          await expect(tooltip).toContainText('evaluateExpressionWithCompleteSourceName');
        await page.mouse.move(1, 1);
        await expect(tooltip).toBeHidden();
        expect(await pixels(page, '#report-paint', points)).toEqual(before);

        await page.mouse.move(frame.x + points[0].x, frame.y + points[0].y);
        await expect(tooltip).toBeVisible();
        await page.mouse.wheel(0, 60);
        await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
        await expect(tooltip).toBeHidden();
        await page.evaluate(() => window.reportPaint.dispose());
        await expect(view).toHaveCount(0);
        await page.evaluate(() => scrollTo(0, 0));
        await settleRendering(page);
      });
    }
    expect(errors).toEqual([]);
  });
}
