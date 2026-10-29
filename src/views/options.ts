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

export function parseViewOptions<Source, Context extends InspectionContext>(
  value: ViewOptions<Source, Context>
): ViewOptions<Source, Context> {
  const input = object(value, 'options', [
    'theme',
    'axes',
    'tooltip',
    'onInspect',
    'onSelect',
    'onError'
  ]);
  const theme =
    input.theme === undefined ? undefined : defineTheme(input.theme as ChartTheme, 'options.theme');
  if (input.axes !== undefined) choice(input.axes, ['full', 'minimal', 'none'], 'options.axes');
  if (input.tooltip !== undefined) boolean(input.tooltip, 'options.tooltip');
  for (const name of ['onInspect', 'onSelect', 'onError'])
    if (input[name] !== undefined && typeof input[name] !== 'function')
      fail(`options.${name}`, 'Expected a callback.');
  return { ...input, theme } as ViewOptions<Source, Context>;
}
