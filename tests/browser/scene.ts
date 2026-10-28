import type { Page } from '@playwright/test';
import type { ChartScene, SceneMark } from '../../src/index.js';
import type { ScopeChartElement } from '../../src/element.js';

/** Font completion and scrolling can schedule layout on the next animation frame. */
export async function settleRendering(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

/** Browser tests use canonical geometry for coordinates, and pixels/events for outcomes. */
export async function sceneFor(page: Page, host: string) {
  return page.locator(host).evaluate(async (node) => {
    const entry = '/src/index.ts';
    const { compileChart, layoutChart } = await import(entry);
    const source = node.id === 'custom-host' ? document.querySelector('#treemap')! : node;
    const compiled = compileChart((source as ScopeChartElement).document);
    const root = node.shadowRoot!,
      canvas = root.querySelector<HTMLElement>('.canvas')!;
    const frame = canvas.getBoundingClientRect();
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = `11px ${getComputedStyle(canvas).fontFamily}`;
    const hidden = new Set(
      [...source.shadowRoot!.querySelectorAll('.legend button')]
        .filter((button) => button.getAttribute('aria-pressed') === 'false')
        .map((button) => button.querySelector('.name')!.textContent!)
    );
    const scene: ChartScene = layoutChart(
      compiled,
      hidden,
      frame.width,
      frame.height,
      (text: string) => measure.measureText(text).width
    );
    return {
      marks: scene.marks,
      interactions: scene.interactions,
      rect: scene.rect,
      xTicks: scene.xTicks,
      yTicks: scene.yTicks,
      frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height }
    };
  });
}

export function rectangles(marks: SceneMark[]) {
  return marks.filter((mark): mark is Extract<SceneMark, { kind: 'rect' }> => mark.kind === 'rect');
}

export async function moveToMark(page: Page, host: string, index = 0, click = false) {
  await settleRendering(page);
  await page.locator(`${host} .plot-canvas`).scrollIntoViewIfNeeded();
  await settleRendering(page);
  const scene = await sceneFor(page, host),
    mark = scene.marks.filter((mark) => mark.key)[index];
  const point =
    mark.kind === 'rect'
      ? { x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 }
      : mark.kind === 'circle'
        ? mark
        : scene.interactions.find((value) => value.key === mark.key)!.anchor;
  const x = scene.frame.x + point.x,
    y = scene.frame.y + point.y;
  if (click) await page.mouse.click(x, y);
  else await page.mouse.move(x, y);
  return { scene, mark };
}

export async function pixel(page: Page, host: string, x: number, y: number) {
  return (await pixels(page, host, [{ x, y }]))[0];
}

/** Sample one composed frame in one browser call, preserving CSS-pixel coordinates at any DPR. */
export async function pixels(page: Page, host: string, points: { x: number; y: number }[]) {
  return page.locator(`${host} canvas[data-layer=marks]`).evaluate((node, points) => {
    const canvas = node as HTMLCanvasElement,
      scale = canvas.width / canvas.getBoundingClientRect().width,
      ctx = canvas.getContext('2d')!;
    return points.map(({ x, y }) => [
      ...ctx.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data
    ]);
  }, points);
}
