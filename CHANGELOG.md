# Changelog

All significant changes to ScopeView are documented in this file.

## Unreleased

- Keep queued inspection notifications flowing when a callback throws, preserve newer hierarchy input over pending state restoration, and respect toolbar Escape handlers.
- Include snapshot-scoped exact source context (`MetricInspectionContext`, `TraceInspectionContext`, `ProfileInspectionContext`) in headless `onInspect`/`onSelect` callbacks and component `scope-inspect`/`scope-select` events.
- Reduce exact-reading formatting and narrow-label layout costs while preserving source values and chart geometry.

## v0.1.0 (2026-10-28)

- Initial release of ScopeView.
