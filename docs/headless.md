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

Both callbacks receive a second argument, `InspectionContext | null`. Existing one-argument callbacks continue to work. The context is a detached, JSON-serializable snapshot of the exact inspected source, with `version: 1`, `kind`, `key`, an opaque `snapshotId`, and the document's optional title and description. Import its types from `@scopedb/scopeview`.

```ts
const chart = createChart(host, requests, {
  onInspect(target, context) {
    if (!target || !context) return;
    if (context.kind === 'metric') {
      console.log(context.snapshotId, context.rowIndices, context.rows);
      console.log(context.fields, context.spec, context.series);
    }
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

`snapshotId` remains stable across inspection, selection, resizing, themes and visibility changes for one compiled document. A successful data replacement receives a different ID even when source keys and values repeat; a failed headless update retains the previous snapshot. A compatible persistent selection can reconcile to the new source, and its callback then carries the new ID and values. Treat a stored context as evidence about that snapshot, and attach the application's dataset or execution ID separately when needed.

Moving between series within one metric target updates the inspect callback's context. Inspecting another source leaves the selected context unchanged. Dismissal supplies `null` for both arguments. ScopeView only reports context; application actions remain host-owned. The [headless example](../examples/headless.html) displays the callback's JSON beside each family.

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

The loader and downloaded layouts share ESM chunks. A loader's byte size is not the cost of a rendered chart; use `pnpm test:bundle` after building to check complete consumers.

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
