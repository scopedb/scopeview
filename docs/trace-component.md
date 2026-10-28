---
title: Trace timeline
description: Inspect span timing with the optional scope-trace component.
pageClass: component-page
---

# Trace timeline

`<scope-trace>` displays span timing, hierarchy, viewport controls and pinned details. The lightweight [`createTrace`](headless.md) factory accepts the same document.

<ChartDemo component="trace" show-code />

## Copy the example

Follow [Run an example](examples.md#run-an-example) for project setup and the development server. Save this example's **index.html**, **chart.js** and **data.json** together. Replace the span array in **data.json**; keep the trace document's configuration in **chart.js**. The mount file includes a custom toolbar. Remove its `slot="toolbar"` content to use the built-in controls.

Each span needs `id`, `name`, `startTimeNs` and `endTimeNs`. Nanoseconds are integer strings. Use `parentId` for parentage, `service` for color identity and `status: 'error'` for failures. Set `coverage` to describe the supplied snapshot. See [trace documents](data.md#trace-documents) for exact timing, warnings and limits.

## Read and navigate

Hover for the compact duration reading; click or press Enter to pin complete details below the controls. Another span stays hoverable. Arrow keys inspect and Home/End jump; Escape dismisses. Drag pans, Ctrl/Command-wheel zooms, and the toolbar offers zoom/reset actions. The component scrolls rows when the hierarchy exceeds its height.

To reveal an initial span, register a one-time ready listener before assigning the document:

```ts
import type { ScopeTraceElement } from '@scopedb/scopeview/element';

export function revealSpan(chart: ScopeTraceElement, id: string) {
  chart.addEventListener('scope-ready', () => chart.focusNode(id, { pin: true }), { once: true });
}
```

Inspection events contain original spans in `detail.sources`. Uncovered time reflects supplied direct children, so partial traces cannot establish complete exclusive time. See [component API](api.md) for viewport/collapse methods and [view state](view-state.md) for preserving a reading across updates.
