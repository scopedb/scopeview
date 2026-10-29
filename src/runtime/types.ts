import type { ChartInteraction, ChartScene, Inspect, MeasureText } from '../core/scene.js';

export type SceneLayout<Source> = (
  width: number,
  height: number,
  measure: MeasureText,
  hidden: ReadonlySet<string>
) => ChartScene<Source>;

/** The report runtime accepts only the lifecycle and reading hooks it implements. */
export interface ReadingOptions<Source> {
  layout: SceneLayout<Source>;
  onInspect?: Inspect<Source>;
  onRender?(scene: ChartScene<Source>): void;
  onError?(error: unknown): void;
  /** Reveal a committed keyboard target before reporting its reading, including virtualized rows. */
  onNavigate?(target: ChartInteraction<Source>): void;
  /** A trusted viewport host can consume a drag before hover/click inspection. */
  inputConsumed?(): boolean;
}
