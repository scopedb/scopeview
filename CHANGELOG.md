# Changelog

All significant changes to ScopeView are documented in this file.

## Unreleased

### Improvements

- Scale scalar big-number readouts responsively in narrow containers and refine dark-mode tooltip elevation, spacing, and docked observation alignment across metric, trace, and profile charts.
- Support CSS Color 4 (`color(srgb ...)`, percentage RGB channels, `none`, and `/ alpha`) contrast calculation and consistent series dimming during hover and persistent selection.
- Reduce layout, hit-testing, and Canvas redraw costs during pointer hover, viewport panning, and theme updates across dense scatter, axis, trace, and profile workloads while allowing optional session sharing across headless metric charts.

### Bug fixes

- Preserve clipped trace and flame span outlines, fractional-DPR axis tick and badge crispness, narrow proportional hierarchy labels, wide-gamut CSS Color 4 clamping, inline theme-override cleanup on reset, and loading/error repaint guards across chart and hierarchy Web Components.

## v0.1.1 (2026-10-29)

### New features

- Include snapshot-scoped exact source context (`MetricInspectionContext`, `TraceInspectionContext`, and `ProfileInspectionContext`) in headless `onInspect` and `onSelect` callbacks and Web Component `scope-inspect` and `scope-select` events.

### Improvements

- Reduce exact-reading formatting and narrow-label layout costs while preserving source values and chart geometry.

## v0.1.0 (2026-10-28)

- Initial release of ScopeView.
