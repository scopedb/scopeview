import type { CompiledChart } from '../families/metrics/document.js';
import type { AxisMode, ChartInteraction, ChartScene, Position } from '../core/scene.js';
import type { RangeSelectionBinding } from '../core/range.js';
import type { LinkedHighlight } from '../core/link-group.js';

export interface ChartRenderer {
  model: ChartScene | null;
  rangeSelection?: RangeSelectionBinding | null;
  linkedHighlight: LinkedHighlight | null;
  update(compiled: CompiledChart, hidden: Set<string>, axes?: AxisMode): void;
  anchor(interaction: ChartInteraction): Position | null;
  focus(
    interaction: ChartInteraction | null,
    pinned?: boolean,
    series?: string | null,
    selectedKey?: string | null
  ): void;
  dispose(): void;
}
