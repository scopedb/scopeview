import { test, expect } from '@playwright/test';
import type { ChartInteraction, ChartScene, Position } from '../../src/index.js';
import { settleRendering } from './scene.js';

for (const density of [1, 1.25, 2])
  for (const strategy of ['direct', 'cached'] as const)
    test(`Canvas straight edges stay crisp at DPR ${density} / ${strategy}`, async ({
      browser
    }) => {
      const context = await browser.newContext({ deviceScaleFactor: density });
      const page = await context.newPage();
      try {
        await page.goto('/tests/browser/fixtures/blank.html');
        await page.evaluate(async (strategy) => {
          const entry = '/src/canvas.ts',
            { CanvasRenderer } = await import(entry),
            hostEntry = '/tests/browser/fixtures/host.ts',
            { createCanvasHost } = await import(hostEntry),
            { host, canvas, decoration } = createCanvasHost({
              id: 'resolution-host',
              width: 300.25,
              height: 160.75
            });
          host.style.position = 'relative';
          host.style.left = '0.3px';
          host.style.top = '0.35px';
          host.style.setProperty('--color-chart-grid', '#111111');
          const target = {
            key: 'cell',
            sources: [{ value: 42 }],
            tooltip: { title: 'Cell', rows: [] },
            anchor: { x: 85, y: 65 },
            points: []
          };
          const scene: ChartScene<{ value: number }> = {
            width: 300.25,
            height: 160.75,
            rect: { x: 0, y: 0, width: 300.25, height: 160.75 },
            hitMode: 'item',
            emphasis: 'cell',
            xTicks: [],
            yTicks: [{ position: 130.3, label: '' }],
            ariaLabel: 'Pixel resolution fixture',
            interactions: [target],
            interactionByKey: new Map([[target.key, target]]),
            marks: [
              {
                kind: 'rect',
                key: target.key,
                x: 20.2,
                y: 20.3,
                width: 130.4,
                height: 90.5,
                fill: '#3280dd'
              },
              { kind: 'rect', x: 200.2, y: 20, width: 0.1, height: 50, fill: '#3280dd' }
            ]
          };
          // Exercise automatic caching with a dense grid outside the sampled strips.
          if (strategy === 'cached')
            scene.marks.push(
              ...Array.from({ length: 600 }, (_, index) => ({
                kind: 'rect' as const,
                x: 220 + (index % 20) * 3.5,
                y: 20 + Math.floor(index / 20) * 3,
                width: 1,
                height: 1,
                fill: '#3280dd'
              }))
            );
          const renderer = new CanvasRenderer(
            canvas,
            decoration,
            (
              value: ChartInteraction<{ value: number }> | null,
              _position: Position | null,
              pin: boolean
            ) => {
              renderer.focus(value, pin);
              host.dataset.active = value?.key ?? '';
            }
          );
          renderer.render(scene);
          window.addEventListener('pagehide', () => renderer.dispose(), { once: true });
        }, strategy);
        await settleRendering(page);
        const host = page.locator('#resolution-host'),
          canvas = host.locator('canvas[data-layer=marks]');
        await expect(host.locator('.plot-canvas')).toHaveAttribute('data-paint-strategy', strategy);
        const sample = () =>
          canvas.evaluate((node) => {
            const c = node as HTMLCanvasElement,
              ctx = c.getContext('2d')!,
              sx = c.width / 300.25,
              sy = c.height / 160.75;
            const alpha = (x: number, y: number, width: number, height: number) =>
              Array.from(
                ctx.getImageData(
                  Math.floor(x * sx),
                  Math.floor(y * sy),
                  Math.ceil(width * sx),
                  Math.ceil(height * sy)
                ).data
              ).filter((_, index) => index % 4 === 3);
            return {
              row: alpha(10, 80, 160, 1),
              column: alpha(80, 10, 1, 110),
              rule: alpha(275, 120, 1, 20),
              tiny: alpha(199, 40, 3, 1)
            };
          });
        const before = await sample();
        for (const [name, values] of Object.entries({
          row: before.row,
          column: before.column,
          rule: before.rule
        })) {
          expect(
            values.some((alpha) => alpha >= 254),
            name
          ).toBe(true);
          // Allow one alpha level of fractional-transform rounding, without a soft fringe.
          expect(
            [...new Set(values)].filter((alpha) => alpha > 1 && alpha < 254),
            name
          ).toEqual([]);
        }
        // Subpixel source values remain visible instead of being rounded to zero area.
        expect(before.tiny.some((alpha) => alpha > 0)).toBe(true);
        // Raw Canvas pixels can be sharp while a fractional CSS box blurs the
        // composed page. Sample a native-density screenshot to cover that step.
        const screenshot = await page.screenshot({ scale: 'device' });
        const composed = await page.evaluate(
          async (image) => {
            const bitmap = await createImageBitmap(await (await fetch(image)).blob()),
              surface = document.createElement('canvas');
            surface.width = bitmap.width;
            surface.height = bitmap.height;
            const context = surface.getContext('2d')!;
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            const frame = document
                .querySelector('#resolution-host')!
                .shadowRoot!.querySelector('.plot-canvas')!
                .getBoundingClientRect(),
              density = devicePixelRatio;
            const colors = (x: number, y: number, width: number, height: number) => {
              const { data } = context.getImageData(
                Math.floor((frame.x + x) * density),
                Math.floor((frame.y + y) * density),
                width,
                height
              );
              return [
                ...new Set(
                  Array.from({ length: data.length / 4 }, (_, index) =>
                    Array.from(data.slice(index * 4, index * 4 + 3)).join(',')
                  )
                )
              ].sort();
            };
            return {
              row: colors(10, 80, Math.ceil(160 * density), 1),
              column: colors(80, 10, 1, Math.ceil(110 * density))
            };
          },
          `data:image/png;base64,${screenshot.toString('base64')}`
        );
        for (const colors of Object.values(composed))
          expect(colors).toEqual(['255,255,255', '50,128,221']);
        const bounds = (await host.locator('.plot-canvas').boundingBox())!;
        await page.mouse.move(bounds.x + 85, bounds.y + 65);
        await expect(host).toHaveAttribute('data-active', 'cell');
        const hovered = await sample();
        expect(hovered.row).toEqual(before.row);
        expect(hovered.column).toEqual(before.column);
        await page.mouse.move(bounds.x + bounds.width + 2, bounds.y + 65);
        await expect(host).toHaveAttribute('data-active', '');
        expect(await sample()).toEqual(before);
      } finally {
        await context.close();
      }
    });

for (const density of [1, 1.25, 2])
  for (const strategy of ['direct', 'cached'] as const)
    test(`Canvas scatter points and labels retain native pixels at DPR ${density} / ${strategy}`, async ({
      browser
    }) => {
      const context = await browser.newContext({ deviceScaleFactor: density });
      const page = await context.newPage();
      try {
        await page.goto('/tests/browser/fixtures/blank.html');
        const samples = await page.evaluate(async (strategy) => {
          const painterEntry = '/src/canvas.ts',
            { CanvasRenderer } = await import(painterEntry),
            chartEntry = '/src/index.ts',
            { compileChart, layoutChart } = await import(chartEntry),
            documentEntry = '/examples/mark-data.ts',
            { markDocument } = await import(documentEntry),
            hostEntry = '/tests/browser/fixtures/host.ts',
            { createCanvasHost } = await import(hostEntry);
          return ['light', 'dark'].map((surface) => {
            const { host, canvas, decoration } = createCanvasHost({
              id: `scatter-${surface}`,
              width: 320,
              height: 240,
              surface
            });
            host.style.position = 'relative';
            host.style.left = '0.3px';
            host.style.top = '0.35px';
            host.style.colorScheme = surface;
            const measure = document.createElement('canvas').getContext('2d')!;
            measure.font = `11px ${getComputedStyle(canvas).fontFamily}`;
            const scene: ChartScene = layoutChart(
              compileChart(markDocument('scatter')),
              new Set(),
              320,
              240,
              (text: string) => measure.measureText(text).width
            );
            // Clipped marks exercise automatic caching without changing sampled pixels.
            if (strategy === 'cached')
              scene.marks.push(
                ...Array.from({ length: 600 }, (_, index) => ({
                  kind: 'rect' as const,
                  x: scene.width + 1 + (index % 20),
                  y: Math.floor(index / 20),
                  width: 1,
                  height: 1,
                  fill: '#3280dd'
                }))
              );
            const renderer = new CanvasRenderer(canvas, decoration, () => {});
            renderer.render(scene);
            window.addEventListener('pagehide', () => renderer.dispose(), { once: true });
            const point = scene.marks.find((mark) => mark.kind === 'circle')!;
            if (point.kind !== 'circle') throw new Error('Missing scatter point');
            const tick = scene.yTicks[1];
            return {
              id: host.id,
              point: { x: point.x, y: point.y },
              regions: [
                { x: point.x - 7, y: point.y - 7, width: 14, height: 14 },
                { x: scene.rect!.x - 30, y: tick.position - 8, width: 24, height: 16 }
              ]
            };
          });
        }, strategy);
        await settleRendering(page);
        for (const { id } of samples)
          await expect(page.locator(`#${id} .plot-canvas`)).toHaveAttribute(
            'data-paint-strategy',
            strategy
          );
        const screenshot = await page.screenshot({ scale: 'device' });
        const readings = await page.evaluate(
          async ({ image, samples }) => {
            const bitmap = await createImageBitmap(await (await fetch(image)).blob()),
              composed = document.createElement('canvas');
            composed.width = bitmap.width;
            composed.height = bitmap.height;
            const pageContext = composed.getContext('2d')!;
            pageContext.drawImage(bitmap, 0, 0);
            bitmap.close();
            return samples.map(({ id, point, regions }) => {
              const root = document.querySelector(`#${id}`)!.shadowRoot!,
                canvas = root.querySelector<HTMLCanvasElement>('canvas[data-layer=marks]')!,
                context = canvas.getContext('2d')!,
                frame = canvas.getBoundingClientRect(),
                density = devicePixelRatio,
                background = id.endsWith('dark') ? [23, 25, 32] : [255, 255, 255];
              const center = context.getImageData(
                Math.floor(point.x * density),
                Math.floor(point.y * density),
                1,
                1
              ).data;
              const errors = regions.map((region) => {
                const x = Math.floor(region.x * density),
                  y = Math.floor(region.y * density),
                  width = Math.ceil(region.width * density),
                  height = Math.ceil(region.height * density),
                  original = context.getImageData(x, y, width, height).data;
                let best = Infinity;
                // Fractional CSS origins may choose either neighboring device pixel.
                // Every glyph and curved edge must retain its original antialiasing.
                for (const dx of [-1, 0, 1])
                  for (const dy of [-1, 0, 1]) {
                    const actual = pageContext.getImageData(
                      Math.floor(frame.x * density) + x + dx,
                      Math.floor(frame.y * density) + y + dy,
                      width,
                      height
                    ).data;
                    let error = 0;
                    for (let pixel = 0; pixel < original.length; pixel += 4) {
                      const alpha = original[pixel + 3] / 255;
                      for (let channel = 0; channel < 3; channel++) {
                        const expected = Math.round(
                          original[pixel + channel] * alpha + background[channel] * (1 - alpha)
                        );
                        error = Math.max(error, Math.abs(actual[pixel + channel] - expected));
                      }
                    }
                    best = Math.min(best, error);
                  }
                return best;
              });
              return { id, alpha: center[3], errors };
            });
          },
          { image: `data:image/png;base64,${screenshot.toString('base64')}`, samples }
        );
        for (const reading of readings) {
          // Small resting points use their full source color, with no translucent halo.
          expect(reading.alpha, reading.id).toBe(255);
          for (const [index, error] of reading.errors.entries())
            expect(error, `${reading.id} ${index ? 'label' : 'point'}`).toBeLessThanOrEqual(2);
        }
      } finally {
        await context.close();
      }
    });
