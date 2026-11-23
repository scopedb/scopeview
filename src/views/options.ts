import { object, choice, boolean, fail } from '../data/validation.js';
import type { AxisMode, ChartInteraction } from '../core/scene.js';
import { defineTheme, type ChartTheme } from '../theme/config.js';
import type { InspectionContext } from '../core/inspection-context.js';

export interface ViewOptions<Source, Context extends InspectionContext = InspectionContext> {
  theme?: ChartTheme;
  axes?: AxisMode;
  tooltip?: boolean;
  onInspect?(target: ChartInteraction<Source> | null, context: Context | null): void;
  onSelect?(target: ChartInteraction<Source> | null, context: Context | null): void;
  onError?(error: unknown): void;
}

export interface ParsedViewOptions<Source, Context extends InspectionContext = InspectionContext>
  extends ViewOptions<Source, Context> {
  axes: AxisMode;
}

const viewKeys = ['theme', 'axes', 'tooltip', 'onInspect', 'onSelect', 'onError'] as const;

export function parseAxisMode(value: unknown, path: string): AxisMode {
  return choice(value, ['full', 'minimal', 'none'], path);
}

export function parseViewOptions<Source, Context extends InspectionContext>(
  value: ViewOptions<Source, Context>,
  defaultAxes: AxisMode = 'minimal'
): ParsedViewOptions<Source, Context> {
  const input = object(value, 'options', viewKeys);
  if (input.tooltip !== undefined) boolean(input.tooltip, 'options.tooltip');
  for (const name of ['onInspect', 'onSelect', 'onError'])
    if (input[name] !== undefined && typeof input[name] !== 'function')
      fail(`options.${name}`, 'Expected a callback.');
  return {
    ...input,
    ...(input.theme !== undefined
      ? { theme: defineTheme(input.theme as ChartTheme, 'options.theme') }
      : {}),
    axes: input.axes === undefined ? defaultAxes : parseAxisMode(input.axes, 'options.axes')
  } as ParsedViewOptions<Source, Context>;
}
