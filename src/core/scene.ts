import type { ResultRow } from '../data/result.js';
import type { DataProvenance } from '../data/semantics.js';
import type { TimeWindow } from '../data/time.js';

export interface Position {
  x: number;
  y: number;
}
export interface PlotRect extends Position {
  width: number;
  height: number;
}
export interface Tick {
  position: number;
  label: string;
  labelPosition?: number;
}
export type AxisMode = 'minimal' | 'full' | 'none';
export type SceneMark = (
  | {
      kind: 'path';
      d: string;
      fill: string;
      stroke?: string;
      strokeWidth?: number;
      dashed?: boolean;
      opacity?: number;
    }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill: string }
  | { kind: 'circle'; x: number; y: number; radius: number; fill: string; opacity?: number }
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      fill: string;
      align?: 'start' | 'end';
      /** CSS-pixel type size; layout must fit text with the same size. */
      fontSize?: number;
      fontWeight?: 400 | 600;
      /** Choose readable light/dark ink against this resolved background paint. */
      contrastAgainst?: string;
      /** Preferred inks, used only when their contrast against the fill reaches 4.5:1. */
      contrastInks?: readonly string[];
    }
) & { key?: string; series?: string };

/** Semantic reading roles shared by DOM inspectors and custom hosts. */
export interface InspectionRow {
  label: string;
  value: string;
  color?: string;
  /** Reading typography only; values remain exact supplied strings. */
  format?: 'number' | 'code';
  /** Notices remain explicit in text as well as color. */
  tone?: 'warning' | 'danger';
}

/** Source identity belongs to the chart family, never to a renderer or host. */
export interface ChartInteraction<Source = ResultRow> {
  key: string;
  sources: readonly Source[];
  tooltip: {
    /** Compact temporal sample reading; selection/lock restores the full context. */
    presentation?: 'sample';
    title?: string;
    context?: string;
    color?: string;
    /** Optional lightweight reading before a host pins the complete details. */
    previewRows?: readonly InspectionRow[];
    rows: readonly InspectionRow[];
    summary?: InspectionRow;
  };
}
export interface RenderModel<Source = ResultRow> {
  interactions: readonly ChartInteraction<Source>[];
  interactionByKey: ReadonlyMap<string, ChartInteraction<Source>>;
  ariaLabel: string;
}
export interface SceneInteraction<Source = ResultRow> extends ChartInteraction<Source> {
  anchor: Position;
  points: { x: number; y: number; color: string; series?: string; baseY?: number }[];
  /** Family-supplied hover geometry; the original path remains the hit target. */
  radial?: { expandedPath: string };
  /** Painted bar segments, distinct from the complete column reading/hit band. */
  bars?: (PlotRect & { color: string; series: string })[];
  band?: { x: number; width: number };
  /** Family-supplied axis reading; never inferred from tooltip content by a painter. */
  axisLabel?: string;
  /** Supplied sample or half-open bucket interval, in Unix milliseconds. */
  time?: { start: number; end?: number; partial?: boolean };
  /** Optional rectangle target, independent of its positive painted rectangles. */
  hitRect?: PlotRect;
  /** Visible span geometry; clipped time boundaries must not become false guides. */
  interval?: PlotRect & { startClipped?: boolean; endClipped?: boolean };
}

/** Canonical layout in CSS pixels, consumed by browser renderers and custom hosts. */
export interface ChartScene<Source = ResultRow> extends RenderModel<Source> {
  width: number;
  height: number;
  rect: PlotRect | null;
  clipRect?: PlotRect;
  marks: SceneMark[];
  /** Unclipped data readings, separate from mark geometry and hit targets. */
  labels?: SceneMark[];
  /** Host-declared incomplete intervals; never inferred from the local clock. */
  partial?: PlotRect;
  xTicks: Tick[];
  yTicks: Tick[];
  xTitle?: string;
  yTitle?: string;
  baseline?: number;
  /** Report rulers omit grid and tick strokes while retaining readable reference values. */
  axisStyle?: 'minimal';
  hitMode: 'axis' | 'bar' | 'item';
  /** Optional family paint policy; state ownership and reading placement stay shared. */
  emphasis?: 'radial' | 'cell' | 'point' | 'series' | 'row';
  interactions: SceneInteraction<Source>[];
  interactionByKey: Map<string, SceneInteraction<Source>>;
  center?: { value: string; label: string };
  interactive?: boolean;
  /** Full logical reading order, independent of culled paint/hit targets. */
  navigation?: RenderModel<Source>;
  viewport?: {
    start: number;
    end: number;
    scrollOffset: number;
    contentHeight: number;
    rowHeight: number;
  };
  provenance?: DataProvenance;
  time?: {
    domain: TimeWindow;
    window?: TimeWindow;
    intervalMs?: number;
    coverage?: 'complete' | 'limited' | 'unknown';
  };
}
export interface MeasureText {
  (text: string): number;
  /** Size used by this measurer, in CSS pixels; omitted means the 11px baseline. */
  fontSize?: number;
}
export type Inspect<Source = ResultRow> = (
  value: ChartInteraction<Source> | null,
  position: Position | null,
  pin: boolean,
  series?: string | null,
  /** Point sources whose original hit circles contain the pointer, in paint order. */
  neighbors?: readonly ChartInteraction<Source>[]
) => void;
