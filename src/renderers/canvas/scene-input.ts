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

let hitContext: CanvasRenderingContext2D | null | undefined;
let hitDocument: Document | undefined;
function scratchHitContext() {
  if (
    hitContext === undefined ||
    hitDocument !== document ||
    (hitContext &&
      hitContext.canvas.ownerDocument != null &&
      hitContext.canvas.ownerDocument !== document)
  ) {
    hitDocument = document;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    hitContext = canvas.getContext('2d');
  }
  return hitContext;
}

/** All browser painters use the same CSS-pixel targets, including exact path hits. */
export class SceneInput<Source> {
  #root: HTMLElement | SVGSVGElement;
  #inspect: Inspect<Source>;
  #scene: ChartScene<Source> | null = null;
  #index: SceneHitIndex<Source> | null = null;
  #paths = new Map<string, Path2D>();
  #events = new AbortController();
  constructor(root: HTMLElement | SVGSVGElement, inspect: Inspect<Source>) {
    this.#root = root;
    this.#inspect = inspect;
    const signal = this.#events.signal;
    root.addEventListener('pointermove', (event) => this.#pointer(event as PointerEvent, false), {
      signal
    });
    root.addEventListener('click', (event) => this.#pointer(event as MouseEvent, true), { signal });
    root.addEventListener(
      'pointerleave',
      () => {
        this.#cursor(false);
        this.#inspect(null, null, false);
      },
      { signal }
    );
  }
  update(scene: ChartScene<Source>) {
    this.#scene = scene;
    this.#index = null;
    this.#paths.clear();
    this.#cursor(false);
  }
  #cursor(hit: boolean) {
    const cursor =
      !this.#scene || this.#scene.interactive === false
        ? ''
        : this.#scene.hitMode === 'item'
          ? hit
            ? 'pointer'
            : 'default'
          : 'crosshair';
    if (this.#root.style.cursor !== cursor) this.#root.style.cursor = cursor;
  }
  path(mark: Extract<SceneMark, { kind: 'path' }>) {
    let path = this.#paths.get(mark.d);
    if (!path) {
      path = new Path2D(mark.d);
      this.#paths.set(mark.d, path);
    }
    return path;
  }
  #pointer(event: MouseEvent, pin: boolean) {
    if (!this.#scene || this.#scene.interactive === false) return;
    if (!this.#index) this.#index = new SceneHitIndex(this.#scene);
    const index = this.#index;
    const position = scenePosition(this.#root, this.#scene, event);
    const value = index.hit(position, (mark, p) => {
      const ctx = scratchHitContext();
      if (!ctx) return false;
      const path = this.path(mark);
      if (mark.fill !== 'none' && ctx.isPointInPath(path, p.x, p.y)) return true;
      if (mark.stroke && mark.stroke !== 'none') {
        ctx.lineWidth = mark.strokeWidth ?? 2;
        ctx.lineJoin = 'round';
        ctx.setLineDash(mark.dashed ? [5, 4] : []);
        return ctx.isPointInStroke(path, p.x, p.y);
      }
      return false;
    });
    this.#cursor(value !== null);
    this.#inspect(
      value,
      position,
      pin,
      inspectionSeriesAt(value, position),
      value && this.#scene.emphasis === 'point' ? index.pointHits(position) : []
    );
  }
  dispose() {
    this.#events.abort();
    this.#scene = null;
    this.#index = null;
    this.#paths.clear();
  }
}
