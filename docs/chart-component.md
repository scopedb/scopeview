---
title: Metric charts
description: Tabular charts with the optional scope-chart component.
pageClass: component-page
---

# Metric charts

`<scope-chart>` adds controls, a legend, raw data and persistent readings to metric charts. Use a [headless factory](headless.md) when your application already supplies those surfaces.

<ChartDemo component="chart" show-code />

## Copy the example

Follow [Run an example](examples.md#run-an-example) for project setup and the development server. Save this example's three files beside each other. **index.html** mounts the component and toolbar, **chart.js** configures the chart, and **data.json** contains its rows.

Replace field definitions and rows together, keeping every row in field order. Update the encoding's field names to match. Values are strings or `null`; row count is `rows.length`. The [data format](data.md#metric-documents) lists all encodings and limits.

## Configure display

Set plot options in the document. Set component UI with `configure()`:

```ts
import type { ScopeChartElement } from '@scopedb/scopeview/element';

export function configureChart(chart: ScopeChartElement) {
  const document = chart.document!;
  chart.updateDocument({ ...document, options: { ...document.options, labels: 'auto' } },
    { preserveViewState: true });
  chart.configure({
    legend: true
  });
}
```

Axis and distribution documents can also show numeric legend summaries. Use this only with line, area, bar, donut, treemap or top-list documents; scatter and aggregate values do not accept summary columns:

```ts
import type { ScopeChartElement } from '@scopedb/scopeview/element';

export function configureSummary(chart: ScopeChartElement) {
  chart.configure({ legend: { columns: ['last', 'avg', 'max'] } });
}
```

Use `legend: true` for names, or `false` to hide it. `stack` controls bars/areas. Set `orientation: 'horizontal'` on a category bar with one measure and no breakdown to obtain horizontal rows. Source values and original field mappings remain available in the document. The [metric options reference](options.md#metric-options) lists all accepted values and defaults.

## Updates and selection

Set `document` to reset the view. Use `updateDocument(input, { preserveViewState: true })` when refreshing the same source. `scope-inspect` and `scope-select` carry copied `rows`, `rowIndices`, the target key and pin state. Temporal targets may also expose time information.

Use the example's **Options** controls to try disclosure settings; its copyable source updates with the preview. See [component API](api.md) for custom toolbars and events, and [styling](styling.md) for theme, height and fonts.
