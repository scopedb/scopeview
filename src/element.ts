/** Browser-only Web Component API; registration is explicit through /register. */
export { ScopeChartElement, defineScopeChart } from './elements/chart-element.js';
export type {
  ScopeInspectionDetail,
  ScopeChartReadyDetail,
  ScopeVisibilityChangeDetail,
  ScopeChartEventDetails,
  ScopeChartEventMap
} from './elements/chart-element.js';
export type { ScopeErrorDetail, ScopeCommonEventDetails } from './elements/events.js';
export type { ScopeTheme } from './elements/lifecycle.js';
export type { ChartTheme, ThemeConfig, ThemeMode } from './theme/config.js';
export {
  ScopeTraceElement,
  ScopeFlameElement,
  defineScopeTrace,
  defineScopeFlame
} from './elements/entity-elements.js';
export type {
  HierarchyInspectionDetail,
  HierarchyReadyDetail,
  HierarchyCollapseChangeDetail,
  HierarchyEventDetails,
  HierarchyEventMap
} from './elements/hierarchy-element.js';
export type {
  ScopeChartAction,
  ScopeChartControl,
  ScopeControlsChangeDetail
} from './elements/controls.js';
export { bindChartLinks } from './elements/link-binding.js';
export type { ChartLinkTarget, ChartLinkBindingOptions } from './elements/link-binding.js';
