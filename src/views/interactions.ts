import type { PlotRect } from '../core/scene.js';
import type { ViewportState } from '../core/viewport.js';

export interface ViewportDriver {
  readonly consumed: boolean;
  state(contentHeight: number, visibleHeight: number): ViewportState;
  reveal(start: number, end: number, top: number, bottom: number): void;
  cancel(): void;
  dispose(): void;
}
export type ViewportFactory = (
  canvas: HTMLElement,
  rect: () => PlotRect | null | undefined,
  enabled: () => boolean,
  changed: () => void
) => ViewportDriver;
export interface InteractionHost {
  select(enabled: boolean): void;
  viewport?(factory: ViewportFactory): () => void;
  cleanup(callback: () => void): void;
}
/** Shared by the ESM view entries and the explicitly imported interaction module. */
export const interactionHosts = new WeakMap<object, InteractionHost | undefined>();
