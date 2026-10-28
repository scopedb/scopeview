---
description: Install ScopeView, create a data document and mount, update and dispose your first chart.
---

# Getting started

This guide creates a bar chart, changes its data and releases its resources. The same lifecycle works for line charts, scatter plots, traces and profiles.

For a file-based workflow, follow the [CLI example](cli-example.md) to create JSON documents, apply a theme and export offline HTML. See the [CLI reference](cli.md) for commands and options.

## Install

In your application:

```sh
npm install @scopedb/scopeview
```

For Bun projects, use `bun add @scopedb/scopeview`. The imports and browser examples below are the same with either package manager.

ScopeView has no runtime npm dependencies and ships ESM with TypeScript declarations. Keep the complete installed package so its shared ESM chunks remain available. Use Node.js 24+ for the HTML exporter and local development; see the [development guide](../CONTRIBUTING.md) for building and testing a local tarball.

## Create a document

Save this as `chart.ts` in your application. Each row follows the field order. Numeric values are strings so the source snapshot can retain digits beyond JavaScript's safe integer range.

```ts
import type { ChartDocumentInput } from '@scopedb/scopeview';

export const requests: ChartDocumentInput = {
  version: 1,
  data: {
    fields: [
      { name: 'service', data_type: 'string' },
      { name: 'requests', data_type: 'number' }
    ],
    rows: [
      ['api', '120'],
      ['worker', '80'],
      ['storage', '0']
    ]
  },
  spec: {
    visualization: 'bar',
    encoding: { x: 'service', y: ['requests'] }
  }
};
```

`spec.encoding` maps fields to roles. Unique field names are sufficient; duplicate names need a full field reference. `data` contains `fields` and `rows`; row count is `rows.length`, and the visualization determines the encoding roles. See [data format](data.md) for other encodings and families.

## Mount the chart

Add a host with a visible width:

```html
<div id="chart" style="--scope-chart-height: 280px"></div>
```

In your browser entry, import the document and the chart factory:

```ts
import { createChart } from '@scopedb/scopeview/chart';
import { requests } from './chart.js';

const host = document.querySelector<HTMLElement>('#chart')!;
const chart = createChart(host, requests, { theme: 'system' });
```

The plot follows its host width and uses 240px height unless overridden. Hover or click to read a value. Focus the plot and use arrow keys or Home/End for keyboard readings; Escape dismisses the reading. The default view contains the plot and a compact tooltip. Put a title, legend or details panel beside the host when your application needs one.

## Update and dispose

Use the existing view for new data or another metric layout:

```ts
const next = {
  ...requests,
  data: { ...requests.data, rows: [...requests.data.rows, ['cache', '20']] }
};
chart.update(next);
chart.update({ ...next, options: { orientation: 'horizontal' } });
chart.theme = 'dark';
```

The same `/chart` import handles both bar orientations. Invalid updates throw before replacing the chart. Keep your input document in application state; the view exposes `update`, `refresh`, `theme` and `dispose`.

On unmount:

```ts
chart.dispose();
```

Disposal removes the view's DOM and listeners. See [frameworks](frameworks.md) for lifecycle wrappers, or [headless API](headless.md) for asynchronous loading and selection.

## Browser requirements

Use a modern browser with Canvas 2D, ES modules and native CSS `light-dark()`. The tooltip uses the Popover API when available; its fixed-position fallback can be clipped by a transformed or overflow-clipped ancestor. Test those embedding surfaces in your application.

The browser suite runs on Playwright Chromium in CI and releases. Node.js is needed for building and HTML export, not for rendering in the browser.

## Next steps

- [Chart families](charts.md): choose a visualization and its factory import.
- [Examples](examples.md): try the gallery and copy a working example.
- [Data format](data.md): map your own columns, spans or weighted frames.
- [Frameworks](frameworks.md): use the chart lifecycle in your application.

For built-in legends, toolbars and data tables, start with the [Web Component API](api.md).
