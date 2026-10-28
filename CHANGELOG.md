# Changelog

All significant changes to ScopeView are documented in this file.

## Unreleased

- Include snapshot-scoped exact source context in inspect/select callbacks and component events; copy source data on demand, infer family-specific context types, and coordinate notification identity, loading and callback reentrancy through one shared protocol across all browser entries.
- Reduce exact-reading formatting and narrow-label layout costs while preserving source values and chart geometry.

## v0.1.0 (2026-10-28)

- Initial release of ScopeView.
