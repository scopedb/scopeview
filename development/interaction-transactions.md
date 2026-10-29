# Inspection transactions

Status: implemented. The public [inspection notification contract](../docs/headless.md#inspection-notifications) is the compatibility boundary for headless callbacks and component events. This document maps that contract to state ownership, delivery and regression coverage. Factory signatures, session/runtime methods, event details and context types are unchanged.

## Contract before mechanism

Inspection has three different notions of time: the accepted logical state, the last completed frame and a notification's captured source snapshot. Synchronous setters update logical getters immediately, including inside a callback. A frame describes what actually painted. A notification's context retains the source snapshot it captured, even when an earlier listener has already accepted another document. A getter is therefore allowed to return B while the current event still describes A.

The library completes one callback or DOM broadcast before publishing its nested successor. It can discard superseded pending state reports, but does not rewrite a broadcast already in progress. Inspect and select have independent identities and invalidation. Hover cannot cancel an otherwise current selection report. A fresh command preserves its entry's inspect/select enqueue order; reentry can replace a pending value in an older queue position, so different commands do not promise a total inspect/select order or an atomic notification pair. Quiet repaints do not invent source changes. Explicit component input can repeat a reading; headless callbacks deduplicate unchanged identity. Both remain coalescible state reports rather than an action log.

The contract deliberately retains synchronous nested setters. A strict actor mailbox would postpone their effects on getters and change existing behavior. Svelte's synchronous state write with ordered subscriber delivery is a useful reference for this choice. ECharts separately establishes an update-cycle boundary before user-visible events. Neither reference determines ScopeView's exact lifecycle policy or compatibility order; those are recorded below and tested through the public entries.

| Domain       | Identity and guarantee                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Source       | A compiled document owns its exact strings and an opaque snapshot identity; an equal key in another document does not identify the same data. |
| Reading      | Inspect/select compare snapshot, key, series and observable pin state; empty readings have one stable identity.                               |
| Intent       | Accepted focus, keyboard, restoration or dismissal can supersede old work even when the resulting reading identity is unchanged.              |
| Frame        | A completed scene retains the compiled source that produced it; a pending document never relabels that frame.                                 |
| Presentation | DOM and geometry project accepted state; stale presentation cannot restore an older semantic selection or viewport.                           |
| Lifetime     | Loading, component disconnection and silent headless disposal retain their existing entry-specific policies.                                  |

A context contains detached source values, not a live lookup into the latest chart. Its lazy fields close over the captured source owner. Geometry on an interaction target is not the context's source identity. Consumers may mutate their copied context, but the library does not clone an event detail separately for each listener of that same DOM event.

## State ownership

Each mounted chart has one DOM-free `Interaction` in `src/core/interaction.ts`. Its canonical reading record stores keys, hover, selection, series, keyboard mode, model version and intent. `ReadingSession` implements synchronous reducers; the public `ChartSession` adds freeze/compare, lock, visibility and restoration policy. Component and runtime session facades address the same record.

`HierarchyInteraction` owns compiled target resolution, expanded navigation, collapsed nodes, viewport, positive measurement and full positioning intent. Its private fields are mutated only by trusted synchronous reducers. Preparation that can fail completes before assigning the derived view. Shallow-copying an internal record on every field change provides no isolation: isolation belongs to captured outward payloads and validated effect tokens. Public sets, view state and viewport results remain copied or read-only projections.

Canvas providers are consumed once at runtime construction. A borrowed facade detaches before disposal, so a retained old session cannot write into the component's next lifecycle. The scene snapshot registry is a separate frame projection, not another selection owner.

## Commit, project and publish

A command runs in `Interaction.batch()`. State reducers finish before queued effects or reports invoke host code. A nested callback command can commit immediately; its projection and reports wait for the current delivery to return. There is no older semantic write left after that command's notifications.

Effects validate both before admission and before execution. A rejected stale effect cannot overwrite a valid keyed projection. Adapters revalidate after operations that may invoke host code, including custom renderer hooks, focus and popover work. Metric dismissal, refresh and reading use the same captured presentation path; showing and clearing do not maintain different queues or recapture a newer reading on behalf of an obsolete caller.

The notification order is finite compatibility policy, not an extensible priority scheduler. A state channel binds its phase once when created. Individual reports supply values and validity, not a new ordering choice. The pump revisits pending projection work after each callback, before continuing to later reports.

| Phase | Responsibility                             | Observable reason to retain the boundary                                                                         |
| ----- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 0     | Cleanup, layout and reading presentation   | Project the accepted state before observers inspect the corresponding UI.                                        |
| 1     | Controls                                   | A controls callback can dismiss or replace a reading before its pending report starts.                           |
| 2     | Reading and component change/error events  | Preserve fresh entry-specific enqueue order and independent per-channel coalescing during reentry.               |
| 3     | Viewport                                   | Earlier reading callbacks can supersede a focus or viewport; observers receive only a valid window.              |
| 4     | Portable view state                        | Report state after preceding selection, collapse and viewport callbacks have had their opportunity to change it. |
| 5     | Ready                                      | Earlier callbacks can remove or replace the frame and cancel its success notification.                           |

The shared pump records a channel's published identity before calling the host. Inspection invalidation versions remain per channel because an equal-value restoration can cancel a captured projection without changing the last value already delivered. This is distinct from value deduplication. Controls and lifecycle adapters retain their existing payloads and policies.

Ordinary work settles synchronously. The current pump yields to a timer task after 64 jobs; that threshold is an internal fairness choice, not public API or a proof that changing-value host feedback converges. Same-value acknowledgements quiesce by equality. Observer errors preserve committed state and other eligible work; remaining jobs are scheduled before the first thrown value propagates. DOM listener exceptions follow browser dispatch semantics.

## Geometry and lifecycle

`focusNode()` resolves against the compiled hierarchy and expands ancestors before committing the existing pin behavior. It does not need the target to exist in the old scene. Zero dimensions do not replace a valid measurement. An initialized hidden chart retains its last positive height and an intent containing target, source snapshot and reading intent. Positive measurement applies geometry only while that intent remains current.

Newer viewport, dismissal, restoration, collapse or document commands cancel obsolete positioning. Loading with an unavailable runtime preserves the existing saved-state policy; it does not behave like an initialized hidden chart. Before-first-paint, loading and disconnection keep their compatibility fixtures. One explicit Canvas Escape owner accepts dismissal, including noncancelable events, while runtime and shell fallback skip that Canvas path so later listeners can restore a newer state.

Runtime layout revisions and semantic model versions reject stale custom layout results and failures. Document replacement commits the new source and clears controlled bindings before cleanup callbacks run. Ready additionally validates the completed frame, current source, connection and loading/error state. Headless disposal cancels pending callbacks silently; component disconnection preserves final clears. Already retained contexts remain readable after either lifecycle ends.

## Verification and package boundaries

| Contract                          | Regression coverage                                                                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot versus current getters   | `inspection-contract.spec.ts` checks independent component listeners; `inspection-notifications.spec.ts` checks unread context after nested replacement/disposal in both channels across all 17 entries. |
| State publication and order       | Coordinator/kernel units cover immediate nested writes, coalescing, channel independence, fixed channel order, exceptions and bounded feedback.                                                          |
| Semantic focus and stale geometry | `interaction-transactions.spec.ts`, `hierarchy-viewport.spec.ts` and 48 seeded independent last-intent reference runs cover hidden/collapsed focus, measurements and superseding commands.               |
| Projection and lifecycle          | Popover/renderer regressions, hidden replacement readiness, ready cancellation, stale custom layouts and runtime reuse cover effects that can reenter or outlive their source.                           |
| API and entry compatibility       | Existing family matrices, public type consumers, exported-member comparison and installed-package acceptance cover signatures and JavaScript facade behavior.                                            |

The kernel, sessions and frame registry remain DOM-free. Shared reading DOM stays in `src/ui/`; headless views do not import component shells. Fixed metric entries omit aggregate switching, scalar stays HTML-only, registration is explicit and all existing gzip limits remain gates. Painter tokens, source colors, geometry and reading appearance are unchanged.

## Design references

- [Svelte store implementation](https://github.com/sveltejs/svelte/blob/main/packages/svelte/src/store/shared/index.js): synchronous writes and ordered subscriber delivery.
- [ECharts update-cycle rules](https://github.com/apache/echarts/blob/master/src/core/echarts.ts): a defined update boundary before user-visible events and delayed actions during updates.
- [Redux subscription contract](https://redux.js.org/api/store#subscribelistener): nested updates and the distinction between observing state and seeing every intermediate action.
