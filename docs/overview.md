---
description: Understand ScopeView's chart families, embedding options and source readings before creating your first chart.
---

# Overview

ScopeView is a small chart library for metric charts, trace timelines and flame graphs. Provide a data document and a container. The view handles rendering, resizing, light and dark appearance, and exact source readings.

The package has no runtime npm dependencies and ships ESM with TypeScript declarations. Fetching data, aggregation and application state stay with your application.

## What you can render

| Your data                      | Views                                                                 | Reference                                      |
| ------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------- |
| Columns and rows               | Line, area, bar, scatter, donut, treemap, top list and numeric values | [Chart families](charts.md)                    |
| Spans with start and end times | Trace timeline with parent/child relationships                        | [Trace documents](data.md#trace-documents)     |
| Call frames with self weights  | Flame graph with inclusive widths                                     | [Profile documents](data.md#profile-documents) |

Use the [live gallery](examples.md#live-gallery) to try each chart with synthetic data.

## Choose an interface

All interfaces accept the same document families and preserve their source readings.

| Interface                   | What it provides                                                     | Choose it when                                                               |
| --------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Headless API](headless.md) | A plot or HTML numeric values, compact readings and a view lifecycle | Your application owns titles, legends, controls and selected-source details. |
| [Web Components](api.md)    | Built-in headers, legends, toolbars, data tables and pinned details  | You want a complete chart component.                                         |
| [HTML export](embedding.md) | A self-contained page or fragment with embedded data and rendering   | You need a chart that opens offline or can be embedded in a report.          |

Headless views are the default integration. Import a specific chart factory when you know the chart type, or use the asynchronous report API to load layouts on demand.

## Documents and readings

A document contains a complete data snapshot, its field mappings and optional display settings. Metric documents map table columns to visual roles; trace and profile documents describe spans and weighted frames. The [data format](data.md) explains each schema.

Readings come from original observations. Line and area charts connect supplied samples with straight segments and preserve explicit gaps. Inspection keeps zero, NULL and missing observations distinct. Update an existing view with a new snapshot, then dispose it when its host is removed.

## Start building

Follow [getting started](getting-started.md) to install ScopeView, mount a bar chart and update its data. Then use [framework integration](frameworks.md) for your application's client lifecycle and [styling](styling.md) for size, themes and fonts.
