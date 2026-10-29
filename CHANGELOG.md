# Changelog

All significant changes to ScopeView are documented in this file.

## Unreleased

### Bug fixes

- `scope-trace` and `scope-flame` resolve `focusNode()` below collapsed ancestors while initialized charts are hidden, retain pin behavior when measurement resumes, and honor newer nested focus, keyboard, dismissal, viewport and restored-state commands.
- Viewport and collapse observers can acknowledge the current value without recursive events. Changing-value callback cycles yield to the browser, and nested viewport broadcasts reach listeners in consistent order.
- Inspection callbacks retain exact source snapshots across document replacement and continue valid queued clears after an observer throws. Reentrant layout and cleanup callbacks cannot overwrite newer data, and removed frames cannot emit a stale ready event.

## v0.1.1 (2026-10-29)

### New features

- Include snapshot-scoped exact source context (`MetricInspectionContext`, `TraceInspectionContext`, and `ProfileInspectionContext`) in headless `onInspect` and `onSelect` callbacks and Web Component `scope-inspect` and `scope-select` events.

### Improvements

- Reduce exact-reading formatting and narrow-label layout costs while preserving source values and chart geometry.

## v0.1.0 (2026-10-28)

- Initial release of ScopeView.
