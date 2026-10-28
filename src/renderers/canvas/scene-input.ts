import { SceneHitIndex } from '../../core/hit-test.js';
import { inspectionSeriesAt } from '../../core/inspection-series.js';
import type { ChartScene, Inspect, Position, SceneMark } from '../../core/scene.js';

function scenePosition(
  root: HTMLElement | SVGSVGElement,
  scene: ChartScene<unknown>,
  event: MouseEvent
): Position {
  const bounds = root.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) * scene.width) / bounds.width,
    y: ((event.clientY - bounds.top) * scene.height) / bounds.height
  };
}

/** All browser painters use the same CSS-pixel targets, including exact path hits. */
export class SceneInput<Source> {
  #scene: ChartScene<Source> | null = null;
  #index: SceneHitIndex<Source> | null = null;
  #paths = new Map<string, Path2D>();
  #context = document.createElement('canvas').getContext('2d');
  #events = new AbortController();
  constructor(
    private root: HTMLElement | SVGSVGElement,
    private inspect: Inspect<Source>
  ) {
    const signal = this.#events.signal;
    root.addEventListener('pointermove', (event) => this.pointer(event as PointerEvent, false), {
      signal
    });
    root.addEventListener('click', (event) => this.pointer(event as MouseEvent, true), { signal });
    root.addEventListener(
      'pointerleave',
      () => {
        this.cursor(false);
        this.inspect(null, null, false);
      },
      { signal }
    );
  }
  update(scene: ChartScene<Source>) {
    this.#scene = scene;
    this.#index = new SceneHitIndex(scene);
    this.#paths.clear();
    this.cursor(false);
  }
  private cursor(hit: boolean) {
    const cursor =
      !this.#scene || this.#scene.interactive === false
        ? ''
        : this.#scene.hitMode === 'item'
          ? hit
            ? 'pointer'
            : 'default'
          : 'crosshair';
    if (this.root.style.cursor !== cursor) this.root.style.cursor = cursor;
  }
  path(mark: Extract<SceneMark, { kind: 'path' }>) {
    let path = this.#paths.get(mark.d);
    if (!path) {
      path = new Path2D(mark.d);
      this.#paths.set(mark.d, path);
    }
    return path;
  }
  private pointer(event: MouseEvent, pin: boolean) {
    if (!this.#scene || this.#scene.interactive === false) return;
    const position = scenePosition(this.root, this.#scene, event);
    const value = this.#index!.hit(position, (mark, p) => {
      const ctx = this.#context;
      if (!ctx) return false;
      const path = this.path(mark);
      ctx.lineWidth = mark.strokeWidth ?? 2;
      ctx.lineJoin = 'round';
      ctx.setLineDash(mark.dashed ? [5, 4] : []);
      return (
        (mark.fill !== 'none' && ctx.isPointInPath(path, p.x, p.y)) ||
        (!!mark.stroke && mark.stroke !== 'none' && ctx.isPointInStroke(path, p.x, p.y))
      );
    });
    this.cursor(value !== null);
    this.inspect(
      value,
      position,
      pin,
      inspectionSeriesAt(value, position),
      this.#index!.pointHits(position)
    );
  }
  dispose() {
    this.#events.abort();
    this.#scene = null;
    this.#index = null;
    this.#paths.clear();
    if (this.#context) this.#context.canvas.width = this.#context.canvas.height = 0;
    this.#context = null;
  }
}
