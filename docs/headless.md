---
description: Factory imports, lifecycle methods, options and interactions for headless chart views.
---

# Headless API

A headless view owns a chart inside your element. It includes Canvas drawing, resizing, light/dark tokens and compact readings. Your application supplies titles, controls, loading indicators and selected-source details.

## Import a factory

Every path below is relative to `@scopedb/scopeview`.

| Entry       | Export                | Accepted input                                                      |
| ----------- | --------------------- | ------------------------------------------------------------------- |
| `/chart`    | `createChart`         | Default metric entry: every layout, including HTML aggregate values |
| `/trace`    | `createTrace`         | Trace documents                                                     |
| `/flame`    | `createFlame`         | Profile documents                                                   |
| `/headless` | `createVisualization` | Any document family, synchronously                                  |
| `/report`   | `createReport`        | Any document family, with asynchronous layout loading               |
| `/scalar`   | `createScalar`        | A numeric value or list of values                                   |

Start with `/chart` for metrics. Changing a vertical bar to horizontal or switching another metric layout uses the same view and import. `/report` loads layouts as needed.

For bundle optimization with a fixed set of layouts, use `/chart/axis` (line, area, vertical bar), `/chart/scatter`, `/chart/donut` (`pie`), `/chart/top-list` (top lists and horizontal bars) or `/chart/treemap`. These narrower entries reject unsupported layouts on mount and update.

All factories take `(host, input, options?)`. Imports can be resolved without a browser; call the factories only after a real `HTMLElement` exists.

## View lifecycle

Synchronous factories return a `ChartView`:

| Member          | Behavior                                                                    |
| --------------- | --------------------------------------------------------------------------- |
| `update(input)` | Validate and replace data within the mounted family                         |
| `theme`         | Read or replace a mode shortcut or strict [theme object](styling.md#themes) |
| `refresh()`     | Re-read host tokens and refresh rendering                                   |
| `dispose()`     | Release the view's DOM, observers and listeners; safe to repeat             |

The view appends an owned child and leaves other host children alone. Invalid updates preserve the previous chart. Calling `update` after disposal throws. Changing from metrics to trace or profile requires disposing and mounting another view; a generic dispatcher chooses the family only at mount time.

Keep the input document in application state. A headless view does not expose component properties such as `document`, `configure` or `viewState`.

## Options and readings

| Option                       | Default     | Behavior                                                               |
| ---------------------------- | ----------- | ---------------------------------------------------------------------- |
| `theme`                      | `'light'`   | Mode shortcut or theme object; `system` follows the OS preference      |
| `axes`                       | `'minimal'` | Sparse rulers; use `'full'` or `'none'` when needed                    |
| `tooltip`                    | `true`      | Show the built-in reading                                              |
| `onInspect(target, context)` | —           | Receive the transient reading and source context, or two `null` values |
| `onSelect(target, context)`  | —           | Receive persistent selection and context after enabling interactions   |
| `onError(error)`             | —           | Receive asynchronous rendering failures                                |

A target contains `key`, original `sources` and `tooltip` rows. Metric sources are result rows; trace/profile sources are spans/frames. `tooltip: false` keeps inspection callbacks available. Invalid document errors throw at the API call rather than arriving through `onError`.

Hover, click and keyboard arrows inspect. Home/End jump to boundary targets; Escape dismisses. Default views leave page scrolling alone. Trace/profile plots fit all depths; small marks retain exact keyboard readings even when their labels cannot fit.

`document.options.interactive: false` disables chart input. Pass `tooltip: false` in the factory options to hide the reading while retaining callbacks. Titles, legends and controls are host UI; Web Components configure them through `configure()`. They are not accepted in document options. Unknown factory or document settings throw with their path before mounting. [Styling](styling.md) covers height, fonts and inherited tokens. The [options reference](options.md) separates document settings from component UI.

## Inspect source context

Both callbacks receive a second argument with exact source context, or `null`. Metric factories infer `MetricInspectionContext`, `createTrace` infers `TraceInspectionContext`, and `createFlame` infers `ProfileInspectionContext`; mixed-family factories use the `InspectionContext` union. Each factory entry and the package root export their corresponding context types.

The context is JSON-serializable and identifies the captured document with `version: 1`, `kind`, `key`, an opaque `snapshotId`, and its optional title and description. Source objects are detached copies of the painted snapshot, so retaining or mutating a context does not affect subsequent updates.

```ts
const chart = createChart(host, requests, {
  onInspect(target, context) {
    if (!target || !context) return;
    console.log(context.snapshotId, context.rowIndices, context.rows);
    console.log(context.fields, context.spec, context.series);
  },
  onSelect(_target, context) {
    console.log('Selected source:', context);
  }
});
```

| Context kind | Exact source and context                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `metric`     | Raw `rows`, zero-based `rowIndices`, ordered `fields`, normalized `spec`, inspected `series`, supplied `semantics` and value display rules |
| `trace`      | Raw `span`, supplied `ancestors` ordered root to parent, exact `durationNs` string and trace `coverage`                                    |
| `profile`    | Raw `frame`, supplied `ancestors`, `unit`, exact inclusive `totalWeight` and `profileTotalWeight` strings                                  |

Metric timestamps and numeric cells retain the supplied strings, including sub-millisecond timestamps, large integers and decimal precision. NULL and zero remain distinct. Use fields and the normalized spec to identify time, value and series roles, including duplicate field names. A metric target can include several source rows at the same time; `series` identifies the inspected series when the pointer identifies one, and is `null` for a whole-target reading. Profile `frame.selfWeight` is the raw self weight; `totalWeight` includes supplied descendants. Missing hierarchy parents are not invented.

`snapshotId` remains stable across inspection, selection, resizing, themes and visibility changes for one compiled document, and changes when data is replaced. A compatible persistent selection reconciles to the replacement and reports the new `snapshotId` and values; clearing or dismissing a reading or selection reports `null` for both arguments. The [headless example](../examples/headless.html) displays the callback's JSON beside each family.

## Inspection notifications

The following contract also applies to the Web Components' `scope-inspect` and `scope-select` events. A context describes the source snapshot captured for that notification; public getters describe the latest accepted logical state. The two can differ during a callback that submits a newer command. Synchronous setters and methods commit before returning; painting and asynchronous report downloads have their own completion boundaries.

In headless callbacks, `target` is a library-owned interaction record. Use the separate, detached `context` value for retaining or mutating application-owned source data.

For example, listener 1 receives a notification for A and synchronously restores B. Its next `viewState` read sees B. Listener 2 still receives the same event for A, and its `viewState` read also sees B. Notifications for B follow after the current callback and DOM broadcast finish. Read the event's context to interpret that event, and use getters when you need the latest state.

- A context's key, raw values, series/time fields and ancestors belong to one `snapshotId`. Retaining it, including reading lazy source fields after an update or disposal, keeps that snapshot. Reusing a key in another document does not reuse its snapshot identity. Treat event details as snapshot data; consumers that mutate a detail share that mutation with other listeners of the same event.
- Inspection and selection are state notifications, not a log of every input or intermediate transition. Superseded pending values can be coalesced. Once a notification starts, the library finishes that callback or DOM broadcast before delivering its successor. Selection is independent of transient hover, so changing hover does not cancel an otherwise current selection report.
- Quiet layout, theme and size changes do not repeat an unchanged source reading. Explicit component reading input can repeat `scope-inspect` even when its identity is unchanged; headless callbacks deduplicate that identity. Pending repeated reports can still coalesce. Same-value viewport or collapse acknowledgements do not create another change event.
- An already painted frame keeps its originating snapshot while a replacement awaits paint. A report never combines an old frame's source with the replacement's fields or ancestry. Compatible selections reconcile according to the entry's existing update policy and publish replacement context after a compatible paint.
- A callback may dismiss, restore, update or dispose its chart. Those commands invalidate older pending work in the affected channels. Headless disposal is silent and cancels pending callbacks; components preserve their final-clear behavior on disconnection. Retained contexts remain usable.
- Headless callback failures do not roll back committed state. Other eligible notifications in the same synchronous flush run before the first thrown value propagates. Changing-value feedback yields to a later task after bounded work; remaining work is scheduled before an error propagates. DOM listener exceptions follow browser event-dispatch behavior. The queue does not guarantee that a host loop producing different values will converge.

Component notifications preserve this relative order: controls, inspection/selection and collapse/visibility, viewport, portable view state, then ready. For a fresh reading, components enqueue inspect before select; headless views enqueue select before inspect. Reentry can replace a pending channel's value while retaining its earlier queue position, so different commands do not have a total inspect/select order or an atomic pair of notifications. Ready follows a completed frame from the current source and can repeat on repaint; a hidden container must paint its replacement before reporting that replacement as ready. Track inspection events for selection invalidation.

## Load layouts on demand

`createReport` returns `Promise<ReportView>`. Its `update` method also returns a Promise:

```ts
import { createReport } from '@scopedb/scopeview/report';
import { requests } from './chart.js';

const host = document.querySelector<HTMLElement>('#chart')!;
const controller = new AbortController();
const chart = await createReport(host, requests, {
  theme: 'system',
  signal: controller.signal
});

await chart.update({ ...requests, spec: { ...requests.spec, visualization: 'area' } });

// When this section is removed:
controller.abort();
chart.dispose();
```

Abort a pending mount if its host is removed. The signal prevents mounting after an import finishes; it does not cancel the module download or dispose an already mounted view. After mounting, use `dispose()`.

Metric updates validate before loading. During a download, the previous figure stays available. The latest valid update wins; an older successful update resolves without applying. Invalid input or failed loading rejects without replacing the current figure. Disposing during an update prevents mounting and rejects it with `AbortError`. Handle rejections in the application, including an intentionally aborted mount.

The loader and downloaded layouts share ESM chunks, so only the requested family and metric layout are loaded on demand.

## Enable selection and navigation

```ts
import { createChart } from '@scopedb/scopeview/chart';
import { requests } from './chart.js';

const chart = createChart(document.querySelector<HTMLElement>('#chart')!, requests, {
  onSelect: (target) => console.log(target?.sources ?? [])
});
const { enableInteractions } = await import('@scopedb/scopeview/interactions');
const disable = enableInteractions(chart);

// Return to transient readings:
disable();
chart.dispose();
```

The add-on enables click/Enter selection with neutral emphasis. Another source remains hoverable. Trace/profile views also gain drag pan, scrolling, Ctrl/Command-wheel zoom, `+`/`-`, `0` to reset, Shift+arrows to pan and PageUp/PageDown to scroll.

Disabling clears selection and restores the fitted report. Disposing the chart also releases the add-on. It works with ESM plot views, not scalars or the standalone script. Switching an aggregate metric view to a plot creates a new inner view; enable interactions again after that transition. The add-on supplies input behavior, not controls or panels.

## Render HTML values

```ts
import { createScalar } from '@scopedb/scopeview/scalar';

const value = createScalar(document.querySelector<HTMLElement>('#chart')!, [
  { label: 'Requests', value: '9007199254740993' },
  { label: 'Errors', value: '0' },
  { label: 'Unavailable', value: null }
], { theme: 'system' });

value.update({
  label: 'Elapsed',
  value: '1500',
  display: { divisor: '1000', unit: 's', decimals: 2 }
});
```

`ScalarInput` is one `ScalarValue` or an array. Values are numeric strings or `null`, with optional `label` and `display`. Zero shows `0`, missing values show `NULL`, and an empty array shows “No data”. Only `theme` is accepted as a factory option. The result uses the same lifecycle and ignores plot height.

The `/scalar` entry excludes Canvas and the metric compiler. Aggregate documents rendered through `/chart` or `/report` also use HTML but still validate their field mappings.

## Standalone script

The package includes `dist/scopeview.js`. Load it as a classic script to obtain `ScopeView.createChart`, `createTrace`, `createFlame`, `createScalar` and `createVisualization`. It is self-contained and uses the same view lifecycle. ESM-only features such as `/report`, `/interactions` and component registration require their own entries. See [HTML export](embedding.md) for embedding a document with that runtime.

## Live example

This view uses the headless API. Hover, click or focus the chart to inspect its original values. The family picker belongs to this documentation host.

<HeadlessDemo />

## Next steps

- [Frameworks](frameworks.md): connect mounting, updates and disposal to a client lifecycle.
- [Styling](styling.md): set chart size, follow your application's theme and customize tokens.
- [Web Component API](api.md): add built-in controls and persistent detail panels.
