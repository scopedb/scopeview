import type {
  AxisMode,
  ChartInteraction,
  ChartScene,
  MeasureText,
  RenderModel
} from '../../core/scene.js';
import type { ViewportState } from '../../core/viewport.js';
import { fitLabel, layoutAxisLabels } from '../../core/labels.js';
import { sparseTicks } from '../../core/axes.js';
import { compactFormat } from '../../data/format.js';
import {
  entityLabelInset as tokenEntityLabelInset,
  entityLabelInsetY as tokenEntityLabelInsetY,
  entityLabelSize as tokenEntityLabelSize,
  entityOverflowInset as tokenEntityOverflowInset,
  labelSize as tokenLabelSize,
  reportAxisSpace as tokenReportAxisSpace,
  reportAxisTicks as tokenReportAxisTicks,
  reportInset as tokenReportInset
} from '../../theme/visual-tokens.js';
import { ratio, type Entity, type EntityDocument, type HierarchyIssue } from './model.js';

export interface HierarchyItem<Source extends Entity> {
  id: string;
  start: number;
  end: number;
  row: number;
  color: string;
  interaction: ChartInteraction<Source>;
}
/** Row intervals are nonoverlapping; query only viewport rows and intersecting intervals. */
export class RowIntervalIndex<Source extends Entity> {
  private rows = new Map<number, HierarchyItem<Source>[]>();
  private rowNumbers: number[];
  constructor(items: readonly HierarchyItem<Source>[]) {
    for (const item of items) {
      if (
        ![item.start, item.end].every(Number.isFinite) ||
        item.start > item.end ||
        !Number.isSafeInteger(item.row) ||
        item.row < 0
      )
        throw new RangeError('Invalid row interval.');
      const row = this.rows.get(item.row) ?? [];
      row.push(item);
      this.rows.set(item.row, row);
    }
    for (const row of this.rows.values()) {
      row.sort((a, b) => a.start - b.start || a.end - b.end);
      for (let i = 1; i < row.length; i++)
        if (row[i].start < row[i - 1].end) throw new RangeError('Row intervals must not overlap.');
    }
    this.rowNumbers = [...this.rows.keys()].sort((a, b) => a - b);
  }
  query(start: number, end: number, firstRow: number, lastRow: number) {
    if (
      ![start, end, firstRow, lastRow].every(Number.isFinite) ||
      start > end ||
      !Number.isInteger(firstRow) ||
      !Number.isInteger(lastRow)
    )
      throw new RangeError('Invalid interval query.');
    const result: HierarchyItem<Source>[] = [];
    let first = 0,
      limit = this.rowNumbers.length;
    while (first < limit) {
      const mid = (first + limit) >>> 1;
      if (this.rowNumbers[mid] < firstRow) first = mid + 1;
      else limit = mid;
    }
    for (let i = first; i < this.rowNumbers.length && this.rowNumbers[i] <= lastRow; i++) {
      const row = this.rows.get(this.rowNumbers[i])!;
      let left = 0,
        right = row.length;
      while (left < right) {
        const mid = (left + right) >>> 1;
        if (row[mid].end < start) left = mid + 1;
        else right = mid;
      }
      for (let j = left; j < row.length && row[j].start <= end; j++) result.push(row[j]);
    }
    return result;
  }
}
export interface HierarchyView<Source extends Entity> {
  kind: 'trace' | 'profile';
  document: EntityDocument;
  items: readonly HierarchyItem<Source>[];
  byId: ReadonlyMap<string, HierarchyItem<Source>>;
  collapsed: ReadonlySet<string>;
  rowCount: number;
  rowHeight: number;
  index: RowIntervalIndex<Source>;
  navigation: RenderModel<Source>;
  issues: readonly HierarchyIssue[];
  domainSize: bigint;
  formatValue(value: bigint, resolution: bigint): string;
  axisTitle: string;
}
export function createView<Source extends Entity>(
  input: Omit<HierarchyView<Source>, 'index' | 'byId' | 'navigation' | 'rowHeight'>
): HierarchyView<Source> {
  const interactions = input.items.map((item) => item.interaction);
  return {
    ...input,
    collapsed: new Set(input.collapsed),
    rowHeight: input.document.options?.rowHeight ?? 24,
    index: new RowIntervalIndex(input.items),
    byId: new Map(input.items.map((item) => [item.id, item])),
    navigation: {
      interactions,
      interactionByKey: new Map(interactions.map((value) => [value.key, value])),
      ariaLabel:
        input.document.title ?? (input.kind === 'trace' ? 'Trace timeline' : 'Profile flame graph')
    }
  };
}
const HIERARCHY_PADDING = Object.freeze({ top: 24, bottom: 40, left: 12, right: 12 });
export function hierarchyViewportHeight(height: number, axes: AxisMode = 'full') {
  return Math.max(
    1,
    height -
      (axes === 'full'
        ? HIERARCHY_PADDING.top + HIERARCHY_PADDING.bottom
        : tokenReportInset + (axes === 'none' ? tokenReportInset : tokenReportAxisSpace))
  );
}

/** Shared virtualization/label layout produces ordinary Canvas scene primitives. */
export function layoutHierarchy<Source extends Entity>(
  view: HierarchyView<Source>,
  width: number,
  height: number,
  measure: MeasureText,
  viewport: ViewportState = { start: 0, end: 1, scrollOffset: 0 },
  axes: AxisMode = 'full',
  fitRows = false
): ChartScene<Source> {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    ![viewport.start, viewport.end, viewport.scrollOffset].every(Number.isFinite) ||
    viewport.start < 0 ||
    viewport.end > 1 ||
    viewport.start >= viewport.end ||
    viewport.scrollOffset < 0
  )
    throw new RangeError('Invalid scene size or viewport.');
  const rect = {
    x: HIERARCHY_PADDING.left,
    y: axes === 'full' ? HIERARCHY_PADDING.top : tokenReportInset,
    width: Math.max(1, width - HIERARCHY_PADDING.left - HIERARCHY_PADDING.right),
    height: hierarchyViewportHeight(height, axes)
  };
  const rowHeight = fitRows
    ? Math.min(view.rowHeight, rect.height / Math.max(1, view.rowCount))
    : view.rowHeight;
  const markHeight = fitRows ? Math.max(rowHeight * 0.5, rowHeight - 2) : rowHeight - 2;
  const baseSize = measure.fontSize ?? tokenLabelSize;
  const labelSize = (tokenEntityLabelSize * baseSize) / tokenLabelSize,
    labelInset = tokenEntityLabelInset;
  const measureLabel = (text: string) => measure(text) * (labelSize / baseSize);
  const span = viewport.end - viewport.start,
    x = (value: number) => rect.x + ((value - viewport.start) / span) * rect.width;
  const scene: ChartScene<Source> = {
    width,
    height,
    rect,
    clipRect: rect,
    marks: [],
    xTicks: [],
    yTicks: [],
    hitMode: 'item',
    interactions: [],
    interactionByKey: new Map(),
    navigation: view.navigation,
    interactive: view.document.options?.interactive ?? true,
    ariaLabel: view.navigation.ariaLabel,
    xTitle: axes === 'full' ? view.axisTitle : undefined,
    axisStyle: axes === 'minimal' ? 'minimal' : undefined,
    viewport: {
      contentHeight: view.rowCount * rowHeight,
      rowHeight,
      ...viewport
    }
  };
  const first = Math.floor(viewport.scrollOffset / rowHeight),
    last = Math.min(
      view.rowCount - 1,
      Math.ceil((viewport.scrollOffset + rect.height) / rowHeight)
    );
  for (const item of view.index.query(viewport.start, viewport.end, first, last)) {
    const left = Math.max(rect.x, x(item.start)),
      right = Math.min(rect.x + rect.width, x(item.end));
    const y = rect.y + item.row * rowHeight - viewport.scrollOffset;
    const key = item.interaction.key;
    if (right > left) {
      scene.marks.push({
        kind: 'rect',
        key,
        x: left,
        y,
        width: right - left,
        height: markHeight,
        fill: item.color
      });
      if (markHeight >= labelSize + tokenEntityLabelInsetY * 2) {
        const prefix = view.collapsed.has(item.id) ? '▸ ' : '';
        const label = fitLabel(
          prefix + item.interaction.tooltip.title!,
          right - left - labelInset * 2,
          measureLabel,
          4 + prefix.length
        );
        // A centered overflow cue distinguishes a narrow named span from an empty
        // block. Do not invent abbreviations or change the duration/weight geometry.
        const overflow =
          !label &&
          right - left >= tokenEntityOverflowInset * 2 &&
          right - left >= measureLabel('…') + tokenEntityOverflowInset * 2;
        if (label || overflow)
          scene.marks.push({
            kind: 'text',
            x: label ? left + labelInset : (left + right - measureLabel('…')) / 2,
            y: y + markHeight / 2,
            text: label || '…',
            fontSize: labelSize,
            fill: 'var(--color-chart-entity-label-dark)',
            contrastAgainst: item.color,
            contrastInks: [
              'var(--color-chart-entity-label-dark)',
              'var(--color-chart-entity-label-light)'
            ]
          });
      }
    }
    const interaction = {
      ...item.interaction,
      anchor: { x: (left + right) / 2, y: y + markHeight / 2 },
      points: [],
      ...(right > left ? { hitRect: { x: left, y, width: right - left, height: rowHeight } } : {}),
      ...(view.kind === 'trace'
        ? {
            interval: {
              x: left,
              y: Math.max(rect.y, y),
              width: Math.max(0, right - left),
              height: Math.max(
                0,
                Math.min(rect.y + rect.height, y + markHeight) - Math.max(rect.y, y)
              ),
              startClipped: item.start < viewport.start,
              endClipped: item.end > viewport.end
            }
          }
        : {})
    };
    scene.interactions.push(interaction);
    scene.interactionByKey.set(key, interaction);
  }
  if (axes === 'none') return scene;
  const tickCount = Math.max(
    1,
    Math.min(axes === 'minimal' ? tokenReportAxisTicks - 1 : 6, Math.floor(rect.width / 100))
  );
  const labels = new Set<string>();
  const start = fractionInteger(viewport.start, view.domainSize),
    end = fractionInteger(viewport.end, view.domainSize),
    count = BigInt(tickCount),
    resolution = readableStep((end - start + count - 1n) / count);
  for (
    let value = ((start + resolution - 1n) / resolution) * resolution;
    value <= end;
    value += resolution
  ) {
    const position = x(ratio(value, view.domainSize));
    const label =
      axes === 'minimal' && view.kind === 'profile'
        ? value >= 1_000_000_000_000n
          ? new Intl.NumberFormat('en-US', {
              notation: 'scientific',
              maximumSignificantDigits: 3
            }).format(value)
          : compactFormat(String(value))
        : view.formatValue(value, resolution);
    if (position < rect.x - 1e-6 || position > rect.x + rect.width + 1e-6 || labels.has(label))
      continue;
    labels.add(label);
    scene.xTicks.push({
      position,
      label
    });
  }
  if (axes === 'minimal') {
    scene.xTicks = sparseTicks(scene.xTicks, tokenReportAxisTicks);
    if (view.kind === 'profile' && 'unit' in view.document && scene.xTicks.length)
      scene.xTicks[scene.xTicks.length - 1].label += ` ${view.document.unit}`;
  }
  return layoutAxisLabels(scene, measure);
}
/** Aligned 1/2/2.5/5 steps keep axes readable without approximating source integers. */
function readableStep(minimum: bigint) {
  let power = 1n;
  while (power * 10n <= minimum) power *= 10n;
  return [power, power * 2n, power >= 10n ? (power / 2n) * 5n : 0n, power * 5n, power * 10n].find(
    (step) => step > 0n && step >= minimum
  )!;
}
export function entityColor(name: string): string {
  let hash = 2166136261;
  for (const char of name) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return `var(--color-chart-series-${((hash >>> 0) % 10) + 1})`;
}
function fractionInteger(fraction: number, total: bigint): bigint {
  if (fraction <= 0 || !total) return 0n;
  if (fraction >= 1) return total;
  // Convert the viewport's IEEE-754 fraction exactly, then round to an integer tick.
  // Source arithmetic is untouched; no fixed decimal grid limits deep zoom.
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, fraction);
  const bits = bytes.getBigUint64(0),
    exponent = Number((bits >> 52n) & 2047n);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  const shift = (exponent ? exponent - 1023 : -1022) - 52;
  const denominator = 1n << BigInt(-shift);
  return (mantissa * total + denominator / 2n) / denominator;
}
