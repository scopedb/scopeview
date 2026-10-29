/**
 * DOM-free public API: documents, validation, compilation, view state and the custom-host
 * scene contract. Internal layout, formatting and indexing helpers are not exported; expand
 * this surface only when a consumer needs it.
 */

// Documents and validation
export { compileChart, parseChartDocument, DOCUMENT_LIMITS } from './families/metrics/document.js';
export { ChartValidationError } from './data/validation.js';
export type {
  ChartDocument,
  ChartDocumentInput,
  ChartOptions,
  CompiledChart
} from './families/metrics/document.js';
export type {
  ComponentOptions,
  MetricComponentOptions,
  EntityComponentOptions,
  LegendColumn,
  ToolbarOptions,
  ScopeChartAction
} from './families/component-options.js';
export { createChartSpec, fieldRef } from './families/metrics/spec.js';
export type {
  ChartSpec,
  ChartSpecInput,
  ChartEncoding,
  ChartDisplayType
} from './families/metrics/spec.js';
export type { ChartFieldRef, ChartFieldInput } from './data/result.js';
export { buildChartDataset } from './families/metrics/dataset.js';
export type { ChartDataType, ResultSet, ResultField, ResultRow } from './data/result.js';
export { dimensionTuple } from './data/semantics.js';
export type {
  ChartPresentation,
  TimeSemantics,
  ResultSemantics,
  DataProvenance,
  QuantityDisplay
} from './data/semantics.js';
export type { TimeWindow } from './data/time.js';
export {
  parseTraceDocument,
  compileTrace,
  createTraceView,
  layoutTrace
} from './families/trace.js';
export type { TraceSpan, TraceDocument, CompiledTrace, TraceView } from './families/trace.js';
export {
  parseProfileDocument,
  compileProfile,
  createProfileView,
  layoutProfile
} from './families/profile.js';
export type {
  ProfileFrame,
  ProfileDocument,
  CompiledProfile,
  ProfileView
} from './families/profile.js';
export { ENTITY_LIMITS } from './families/hierarchy/model.js';
export type { EntityOptions } from './families/hierarchy/model.js';
export { compileVisualization } from './families/compile.js';
export type { VisualizationDocument, CompiledVisualization } from './families/compile.js';

// View state and linked charts
export { VIEW_STATE_VERSION, parseViewState, reconcileViewState } from './core/view-state.js';
export type {
  ViewState,
  MetricViewState,
  HierarchyViewState,
  ViewStateChangeDetail,
  DocumentUpdateOptions,
  ViewStateTargets
} from './core/view-state.js';
export { ChartLinkGroup } from './core/link-group.js';
export type {
  ChartLinkState,
  ChartLinkUpdate,
  ChartLinkMember,
  LinkedTimeWindow,
  LinkedSelection,
  LinkedHighlight
} from './core/link-group.js';

// Custom hosts: scenes, sessions and hit testing (paint with /runtime or /canvas)
export { layoutChart } from './families/metrics/layout.js';
export { ChartSession } from './core/session.js';
export type { InspectionNavigation } from './core/session.js';
export { SceneHitIndex } from './core/hit-test.js';
export type { PathHit } from './core/hit-test.js';
export { RangeSelectionSession, snapTimeRange } from './core/range.js';
export type { RangeContext, RangeSelectionBinding } from './core/range.js';
export { ViewportSession } from './core/viewport.js';
export type { ViewportState, ViewportBounds } from './core/viewport.js';
export type {
  ChartScene,
  SceneMark,
  SceneInteraction,
  ChartInteraction,
  InspectionRow,
  RenderModel,
  Position,
  PlotRect,
  Tick,
  MeasureText,
  Inspect
} from './core/scene.js';
export type {
  InspectionContext,
  MetricInspectionContext,
  HierarchyInspectionContext,
  TraceInspectionContext,
  ProfileInspectionContext
} from './core/inspection-context.js';
