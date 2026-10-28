---
title: Flame graph
description: Inspect weighted call trees with the optional scope-flame component.
pageClass: component-page
---

# Flame graph

`<scope-flame>` displays weighted call trees with navigation and pinned details. The lightweight [`createFlame`](headless.md) factory accepts the same document.

<ChartDemo component="flame" show-code />

## Copy the example

Follow [Run an example](examples.md#run-an-example) for project setup and the development server. Save this example's **index.html**, **chart.js** and **data.json** together. Replace the frames in **data.json**, and set their unit in **chart.js**. The mount file includes a replaceable toolbar.

## Supply self weights

Each frame needs `id`, `name` and a non-negative integer-string `selfWeight`. Supply **self weights**, not inclusive totals: ScopeView adds descendants to determine each frame's width. Use `parentId` to connect the tree, and `unit` for its weight unit, such as samples or bytes. Optional `file` and `line` fields preserve source locations. Repeated names stay distinct when their IDs differ. See [profile documents](data.md#profile-documents).

Root widths partition the total supplied weight. Sibling order follows the input. Collapsing changes visibility without changing weight; zero-weight frames retain keyboard readings.

## Read and navigate

Hover shows self weight, inclusive weight and share of the supplied profile. Click or Enter pins details below the controls. Another frame stays hoverable. Drag pans, Ctrl/Command-wheel zooms, and the toolbar provides zoom/reset actions. Color identifies a frame name, not weight.

To reveal an initial frame, register before assigning its document:

```ts
import type { ScopeFlameElement } from '@scopedb/scopeview/element';

export function revealFrame(chart: ScopeFlameElement, id: string) {
  chart.addEventListener('scope-ready', () => chart.focusNode(id, { pin: true }), { once: true });
}
```

Inspection events contain the original frames in `detail.sources`. See [component API](api.md) for disclosure and navigation controls, [view state](view-state.md) for persistence, and [styling](styling.md) for appearance.
