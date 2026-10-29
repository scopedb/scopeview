import type { ChartScene } from './scene.js';

const snapshots = new WeakMap<object, object>();

/** A frame keeps the source that actually produced it, including while new data waits. */
export function captureScene<Source>(scene: ChartScene<Source>, snapshot: object) {
  snapshots.set(scene, snapshot);
  return scene;
}

export function sceneSnapshot(scene: object | null | undefined): object | null {
  return scene ? (snapshots.get(scene) ?? null) : null;
}
