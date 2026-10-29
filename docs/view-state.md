---
description: Save readings, preserve compatible state and coordinate selections and ranges across charts.
---

# View state and coordination

Use these APIs with the optional components or a custom host. Headless views expose lifecycle methods and reading callbacks; enabling `/interactions` does not add component properties such as `viewState` or `rangeSelection`.

## Save a reading

Every component exposes a copied `viewState`. Store it under an application-defined source identity, then restore it after assigning the matching document:

```ts
import { parseViewState } from '@scopedb/scopeview';
import type { ScopeChartElement } from '@scopedb/scopeview/element';

export function saveView(chart: ScopeChartElement): string {
  return JSON.stringify(chart.viewState);
}

export function restoreView(chart: ScopeChartElement, saved: string) {
  const state = parseViewState(JSON.parse(saved));
  if (state.kind !== 'metric') throw new TypeError('Expected metric view state.');
  chart.viewState = state;
}
```

| Family        | State fields                                                        |
| ------------- | ------------------------------------------------------------------- |
| Metric        | `version: 1`, `kind: 'metric'`, `pinnedKey`, `hiddenSeries`         |
| Trace/profile | `version: 1`, matching `kind`, `pinnedKey`, `collapsed`, `viewport` |

`pinnedKey` can be `null`. The hierarchy viewport is `{ start, end, scrollOffset }`, with horizontal fractions in `[0, 1]` and vertical CSS pixels. `parseViewState` rejects unsupported versions and returns a canonical copy. A component also checks that the family matches. Malformed restoration throws before changing state. Equivalent assignments are idempotent.

`scope-view-state-change` reports `{ state, reason }`, where reason is `interaction`, `restore`, `document` or `reconcile`. Hover, temporary keyboard reading and metric tooltip lock are not saved. Restoring a view does not move DOM focus.

## Preserve state across data updates

Use `updateDocument(input, { preserveViewState: true })` for a new snapshot of the same logical source. Compatible pins, visibility, collapsed nodes and viewport survive. Missing sources are cleared; a pin is not moved to the next row. A pin below a collapsed ancestor is also cleared. Assigning `document` directly resets state.

In trace/profile components, accepted keyboard navigation or Escape supersedes an older pending pin restoration. This applies to both preserved document state and an assigned `viewState`; Escape also cancels a pin retained during loading. A new restoration requested by a notification callback takes precedence over the earlier keyboard action.

Navigation applies the saved viewport and current row bounds before revealing the requested target. Custom toolbar widgets can stop Escape propagation to retain their own focus and the chart's reading; an unconsumed Escape still dismisses the chart.

For an initialized chart hidden by its container, `focusNode()` retains valid viewport measurements and reveals the node again at the current size when the chart becomes visible. A newer dismissal, viewport command, document or restored state cancels the older deferred positioning. `scope-viewport-change` listeners observe nested changes in broadcast order; callbacks that replace the viewport, view state or document cancel older pending reports.

Identity continuity is the caller's responsibility. A reused span ID in another trace is not the same source. Metric row-index keys are local to their snapshot, so row reordering may make preservation inappropriate. Keep source identity alongside the saved view.

## Share semantic state

`ChartLinkGroup` is DOM-free. Members exchange a cursor, time window and explicitly mapped selection, while each host decides how to display them:

```ts
import { ChartLinkGroup } from '@scopedb/scopeview';

const group = new ChartLinkGroup();
const first = group.connect('first', (update) => console.log('first receives', update.state));
const second = group.connect('second', (update) => console.log('second receives', update.state));
first.cursor('1767225600000000000');
first.select({ namespace: 'operation', id: 'read' });
second.window({ startTimeNs: '1767225600000000000', endTimeNs: '1767225601000000000' });
first.disconnect();
second.disconnect();
```

| Channel        | Format                                                     |
| -------------- | ---------------------------------------------------------- |
| `cursorTimeNs` | Exact integer-string nanoseconds, or `null`                |
| `window`       | Positive half-open `{ startTimeNs, endTimeNs }`, or `null` |
| `selection`    | `{ namespace, id }`, or `null`                             |

Updates carry `origin`, `changed` and a copied full state. A new connection receives the current state. Equivalent updates are deduplicated; publishers do not receive their own echo. Only the current cursor owner may clear it. Disconnecting that owner clears the cursor; window and selection persist. Disconnected members cannot publish.

`group.state` can be read or restored. Persist window/selection with the analysis and clear the transient cursor. An identity namespace is meaningful only with an explicit mapping.

## Bind components

`bindChartLinks` from `/element` wires events to a group. Supply a unique `id` and a `project(update)` function returning `LinkedHighlight | null`. Optional callbacks map inspection to `cursor`, selection to `selection`, and viewport events to `viewportWindow`. `receive(update)` can update an application's accepted window.

A `LinkedHighlight` has `inspectionKey: string | null` and `cursor: number | null`. The cursor is a fraction of the current plot width. Convert shared nanoseconds using the current chart domain and return `null` outside it. Profile width measures weight, so it needs an entity mapping rather than a time projection.

The binding reprojects on `scope-ready` and guards synchronous feedback. Call its returned `disconnect()` on unmount. Passive highlights do not pin, open an inspector or move focus; local hover and selection take precedence. The same `linkedHighlight` property is available on `ChartRuntime` for custom hosts. See the complete consumer in [`examples/linked-analysis.html`](../examples/linked-analysis.html).

## Controlled metric ranges

`scope-chart.rangeSelection` supports a caller-controlled time range when the document has explicit bucket semantics and an executed window:

```ts
import type { ScopeChartElement } from '@scopedb/scopeview/element';
import type { TimeWindow } from '@scopedb/scopeview';

export function bindRange(chart: ScopeChartElement, snapshot: object) {
  let value: TimeWindow | null = null;
  const apply = () => {
    chart.rangeSelection = {
      snapshot,
      value,
      onCommit(next, origin) {
        if (origin !== snapshot) return;
        value = next;
        apply();
      },
      onDismiss() {
        value = null;
        apply();
      }
    };
  };
  apply();
}
```

Pointer previews are local. Commits request a host update; assigning the accepted value acknowledges it. Ranges are half-open, snap outward to epoch bucket boundaries and clip to the executed window. Shift+arrows and endpoint handles support keyboard refinement; Enter requests commit and Escape cancels/dismisses.

Assigning a new document clears the old range binding. Rebind with the new snapshot object; stale gestures cannot commit into it. The range is not part of `ViewState` and never runs a query by itself. `RangeSelectionSession` and `snapTimeRange` expose the DOM-free contract.
