import type { ChartInteraction, ChartScene, Position } from './scene.js';
import type { TimeWindow } from '../data/time.js';

export type PaintInvalidation = 'layout' | 'paint';

/** A projection of host/session state; painters never commit selections. */
export interface PaintState {
  inspectionKey: string | null;
  /** Transient pointer emphasis without changing a persistent reading or selection. */
  hoverKey?: string | null;
  /** Persistent selection is visually distinct from passive hover. */
  inspectionPinned?: boolean;
  inspectionSeries?: string | null;
  /** Persistent source remains visible while another source is hovered. */
  selectedKey?: string | null;
  /** Passive peer highlight; local inspection takes precedence and keeps ownership. */
  linkedInspectionKey?: string | null;
  linkedCursor?: number | null;
  range: TimeWindow | null;
}

/** A painter consumes geometry; it never owns layout or interaction state. */
export interface ScenePainter<Source> {
  model: ChartScene<Source> | null;
  render(scene: ChartScene<Source>, state?: PaintState): void;
  anchor(interaction: ChartInteraction<Source>): Position | null;
  focus(
    interaction: ChartInteraction<Source> | null,
    pinned?: boolean,
    series?: string | null,
    selectedKey?: string | null,
    hoverKey?: string | null
  ): void;
  selection(range: TimeWindow | null): void;
  dispose(): void;
}
