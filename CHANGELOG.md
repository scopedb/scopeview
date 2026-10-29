# Changelog

All significant changes to ScopeView are documented in this file.

## Unreleased

### Bug fixes

- `scope-trace` and `scope-flame` honor newer keyboard input and `focusNode()` calls over pending state restoration, and keep focused nodes visible when initialized hidden charts are shown or resized.
- Headless `onInspect` and `onSelect` callbacks continue delivering valid queued clears after another callback throws, so hosts do not retain dismissed readings or selections.
- `scope-viewport-change` observers receive current windows in consistent order when render, control or event callbacks move the viewport, restore state or replace documents.

## v0.1.1 (2026-10-29)

### New features

- Include snapshot-scoped exact source context (`MetricInspectionContext`, `TraceInspectionContext`, and `ProfileInspectionContext`) in headless `onInspect` and `onSelect` callbacks and Web Component `scope-inspect` and `scope-select` events.

### Improvements

- Reduce exact-reading formatting and narrow-label layout costs while preserving source values and chart geometry.

## v0.1.0 (2026-10-28)

- Initial release of ScopeView.
