---
description: Register Web Components and configure their properties, events, toolbars and navigation.
---

# Web Component API

ScopeView also provides Web Components with headers, legends, controls, tables and pinned details. They consume the same documents as the [headless factories](headless.md), with additional UI and state APIs.

Use this page to look up the shared API. For a working example with copyable source, open [metric charts](chart-component.md), [trace timelines](trace-component.md) or [flame graphs](flame-component.md).

## Register and mount

```ts
import '@scopedb/scopeview/register';
import { requests } from './chart.js';

const chart = document.createElement('scope-chart');
chart.theme = 'system';
chart.document = requests;
document.querySelector('#chart')!.append(chart);
```

`requests` is defined in [getting started](getting-started.md). Registration is browser-only. To register individual families, import `defineScopeChart`, `defineScopeTrace` or `defineScopeFlame` from `/element` and call the corresponding function.

| Tag           | Document             | Reference                            |
| ------------- | -------------------- | ------------------------------------ |
| `scope-chart` | `ChartDocumentInput` | [Metric charts](chart-component.md)  |
| `scope-trace` | `TraceDocument`      | [Trace timeline](trace-component.md) |
| `scope-flame` | `ProfileDocument`    | [Flame graph](flame-component.md)    |

A child `<script type="application/json">` can supply a declarative document. Property assignment takes precedence. The getter returns a copied, normalized document.

## Common properties and methods

| Member                                               | Behavior                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `document`                                           | Set data and reset local view state; invalid input displays an error                                          |
| `updateDocument(input, { preserveViewState: true })` | Refresh data while retaining compatible state                                                                 |
| `configure(ui)`                                      | Patch host UI; replace nested objects/arrays; preserve document and view state                                |
| `theme`                                              | Mode shortcut (default `'light'`) or strict [theme object](styling.md#themes); mode reflects to the attribute |
| `loading`                                            | Show the loading state and suspend the rendered view                                                          |
| `error`                                              | Host error string; set `null` to clear it                                                                     |
| `refresh()`                                          | Refresh after inherited style changes                                                                         |
| `viewState`                                          | Get or restore a copied portable view state                                                                   |
| `controls`                                           | Snapshot of available actions, labels and disabled/expanded states                                            |
| `performAction(action)`                              | Perform an enabled action; return whether it was accepted                                                     |
| `scene`, `diagnostics`                               | Current rendering model/counters, or `null` without an active runtime                                         |
| `linkedHighlight`                                    | Passive host-projected cross-chart emphasis                                                                   |

`configure` works before or after document assignment, and its settings persist when data is replaced. Unknown keys or invalid values throw without changing the UI, document or state. Use `document` for a deliberate reset, or `updateDocument` for a refresh of the same logical source.

Loading and host errors are separate from the document. Clear them when data is ready:

```ts
chart.loading = true;
chart.error = null;
// After the application obtains a valid snapshot:
chart.document = requests;
chart.loading = false;
```

Remove the element with `chart.remove()` on unmount. Disconnect releases buffers and listeners; reconnect creates a runtime for the retained document.

## Disclosure options

Set component UI with `configure`. Documents contain only plot settings:

```ts
chart.configure({
  axes: 'minimal',
  header: false,
  toolbar: { actions: ['inspect', 'toggle-data'], attribution: false }
});
```

The [options reference](options.md) lists accepted values and defaults. Use [component UI](options.md#component-ui) for headers, tooltips, tables, toolbars, legends, axes and pinned details. [Metric options](options.md#metric-options) and [trace/profile options](options.md#trace-and-profile-options) remain in the document. [Styling](styling.md) covers host size and themes.

`document.options.interactive` controls input; trace/profile `document.options.rowHeight` controls row height. To patch plot options while keeping state:

```ts
const document = chart.document!;
chart.updateDocument({ ...document, options: { ...document.options, interactive: false } },
  { preserveViewState: true });
```

## Events

Events bubble and cross Shadow DOM. ScopeView element listeners are typed by `/element`.

```ts
chart.addEventListener('scope-select', (event) => {
  if (event.detail.pinned) console.log(event.detail.rows);
  console.log(event.detail.context);
});
chart.addEventListener('scope-error', (event) => {
  console.error(event.detail.message);
});
```

`scope-inspect` and `scope-select` details include `context`, using the same serializable [source context](headless.md#inspect-source-context) as headless callbacks. It contains a snapshot ID, exact original values and field or hierarchy information, and is `null` when the reading is cleared. Existing detail fields remain available. Trace and profile elements infer their corresponding context types. Keys alone do not identify a data snapshot.

Event context captures the displayed snapshot. Its source fields are copied together on the first data-field read, then reused within that event. Retained events still describe their original snapshot after data is replaced; unread contexts do not copy ancestor chains. A document replacement reports the final reading and selection: preserved pins receive updated context after the replacement paints, and cleared or removed sources receive `null`. This also applies to replacements made during loading. Outside dismissal, errors and disconnection clear the reported context even while loading. Synchronous host callbacks can dismiss or replace a reading; remaining notifications for superseded selections are discarded. Ordinary repainting does not report selection changes. Track these inspection events rather than treating `scope-ready`, which also fires after repainting, as a selection invalidation signal.

For every family, `scope-select` describes the persistent selection. Its `key` and `context` are `null` and `pinned` is `false` when keyboard navigation clears selection, even if `scope-inspect` still describes a transient reading. Clearing an already-null reported state does not emit another selection event. Host control callbacks follow the same reentrancy rules as inspection listeners; dismissing from either callback keeps the reading hidden.

If a listener changes inspection state, the current event finishes broadcasting before nested inspection events are delivered. Those nested events are revalidated and delivered within the same synchronous delivery, so component and delegated host listeners observe the same state order.

| Event                           | Detail                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| `scope-ready`                   | Rendered visualization and row/node counts; may fire after repaint |
| `scope-error`                   | `{ message }`                                                      |
| `scope-inspect`, `scope-select` | Family, key, pin state and copied original sources                 |
| `scope-controls-change`         | `{ controls }`                                                     |
| `scope-view-state-change`       | `{ state, reason }`                                                |
| `scope-visibility-change`       | Metric hidden-series names                                         |
| `scope-viewport-change`         | Trace/profile `{ start, end, scrollOffset }`                       |
| `scope-collapse-change`         | Trace/profile `{ collapsed }`                                      |

Metric inspection uses `rows` and `rowIndices`, with time/provenance where available. Trace/profile inspection uses typed `sources`. Dismissal sends a null key and empty sources. `scope-ready` is not a one-time mount event; use `{ once: true }` for an initial action.

## Custom toolbar

Place controls in `slot="toolbar"` to replace the built-in toolbar:

```html
<scope-trace id="trace">
  <nav slot="toolbar" aria-label="Chart controls"></nav>
</scope-trace>
```

Read `controls`, render a button per `action`, and call `performAction(action)` when clicked. Listen for `scope-controls-change` to update labels and disabled/expanded states. Keep buttons keyed by action so refreshing their state preserves focus. The live component examples show a complete implementation in their **index.html** tab.

| Family        | Actions                                                |
| ------------- | ------------------------------------------------------ |
| All           | `inspect`, `toggle-data`                               |
| Metric        | `show-all`                                             |
| Trace/profile | `zoom-in`, `zoom-out`, `reset-view`, `toggle-collapse` |

`toolbar.actions` filters displayed controls in the standard order. It does not disable keyboard shortcuts or programmatic actions; use `document.options.interactive` or the host `dataTable` switch for that. Slotted controls stay inside the chart's interaction boundary and preserve current readings.

## Hierarchy navigation

Trace and profile components add `viewport`, `collapsed`, `toggleNode(id)`, `focusNode(id, { pin? })` and `resetViewport()`. Call focus/viewport actions after the chart is ready and measured. The viewport stores normalized horizontal fractions and CSS-pixel vertical scroll. Collapsing hides descendants without changing source weights or durations.

For persistence, linked charts and controlled metric time ranges, see [view state and coordination](view-state.md).
