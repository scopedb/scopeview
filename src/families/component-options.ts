import { object, choice, boolean, fail } from '../data/validation.js';
import type { AxisMode } from '../core/scene.js';

export type ScopeChartAction =
  | 'inspect'
  | 'toggle-data'
  | 'show-all'
  | 'zoom-in'
  | 'zoom-out'
  | 'reset-view'
  | 'toggle-collapse';
export type LegendColumn = 'last' | 'avg' | 'sum' | 'min' | 'max';
export interface ToolbarOptions {
  actions?: ScopeChartAction[];
  attribution?: boolean;
}
/** Component UI belongs to its host, separately from the document's plot options. */
export interface ComponentOptions {
  axes?: AxisMode;
  header?: boolean;
  tooltip?: boolean;
  dataTable?: boolean;
  dismissOnOutside?: boolean;
  toolbar?: boolean | ToolbarOptions;
}
export interface MetricComponentOptions extends ComponentOptions {
  legend?: boolean | { columns: LegendColumn[] };
}
export interface EntityComponentOptions extends ComponentOptions {
  summary?: boolean;
  inspector?: boolean;
}
export const metricActions = ['inspect', 'toggle-data', 'show-all'] as const;
export const hierarchyActions = [
  'inspect',
  'zoom-in',
  'zoom-out',
  'reset-view',
  'toggle-collapse',
  'toggle-data'
] as const;

export function parseComponentOptions(value: unknown, family: 'metric'): MetricComponentOptions;
export function parseComponentOptions(value: unknown, family: 'hierarchy'): EntityComponentOptions;
export function parseComponentOptions(value: unknown, family: 'metric' | 'hierarchy') {
  const input = object(value, 'ui', [
    'axes',
    'header',
    'tooltip',
    'dataTable',
    'dismissOnOutside',
    'toolbar',
    ...(family === 'metric' ? ['legend'] : ['summary', 'inspector'])
  ]);
  const result: MetricComponentOptions & EntityComponentOptions = {};
  for (const key of [
    'header',
    'tooltip',
    'dataTable',
    'dismissOnOutside',
    'summary',
    'inspector'
  ] as const)
    if (input[key] !== undefined) result[key] = boolean(input[key], `ui.${key}`);
  if (input.axes !== undefined)
    result.axes = choice(input.axes, ['full', 'minimal', 'none'], 'ui.axes');
  if (input.toolbar !== undefined) {
    if (typeof input.toolbar === 'boolean') result.toolbar = input.toolbar;
    else {
      const toolbar = object(input.toolbar, 'ui.toolbar', ['actions', 'attribution']);
      const parsed: ToolbarOptions = {};
      if (toolbar.attribution !== undefined)
        parsed.attribution = boolean(toolbar.attribution, 'ui.toolbar.attribution');
      if (toolbar.actions !== undefined) {
        const actions = family === 'metric' ? metricActions : hierarchyActions;
        if (
          !Array.isArray(toolbar.actions) ||
          toolbar.actions.length > actions.length ||
          new Set(toolbar.actions).size !== toolbar.actions.length
        )
          fail('ui.toolbar.actions', 'Expected a unique action list.');
        parsed.actions = Array.from(toolbar.actions, (action) =>
          choice(action, actions, 'ui.toolbar.actions')
        );
      }
      result.toolbar = parsed;
    }
  }
  if (input.legend !== undefined) {
    if (typeof input.legend === 'boolean') result.legend = input.legend;
    else {
      const legend = object(input.legend, 'ui.legend', ['columns']);
      if (
        !Array.isArray(legend.columns) ||
        !legend.columns.length ||
        legend.columns.length > 5 ||
        new Set(legend.columns).size !== legend.columns.length
      )
        fail('ui.legend.columns', 'Expected 1–5 unique summary columns.');
      result.legend = {
        columns: Array.from(legend.columns, (column) =>
          choice(column, ['last', 'avg', 'sum', 'min', 'max'], 'ui.legend.columns')
        )
      };
    }
  }
  return result;
}
