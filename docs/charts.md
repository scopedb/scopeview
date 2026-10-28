---
description: Choose a chart family and factory import for your data, then open its interactive example.
---

# Chart families

Choose a chart by the relationship in your data, then import its factory. Each family uses the same tokens, compact readings and lifecycle.

## Live gallery

Open the [examples gallery](examples.md#live-gallery) to try charts and copy their source. The tables below help you choose a visualization and its smallest factory import.

## Metric charts

| Chart                                                 | Typical use                                   | Visualization | Smallest entry                                      |
| ----------------------------------------------------- | --------------------------------------------- | ------------- | --------------------------------------------------- |
| [Line](/examples.html?family=line#live-gallery)       | Change across supplied times/categories       | `line`        | `/chart/axis`                                       |
| [Area](/examples.html?family=area#live-gallery)       | Filled or stacked time series                 | `area`        | `/chart/axis`                                       |
| [Bar](/examples.html?family=bar#live-gallery)         | Category comparisons or explicit time buckets | `bar`         | `/chart/axis`                                       |
| [Scatter](/examples.html?family=scatter#live-gallery) | Two numeric coordinates, optional size/color  | `scatter`     | `/chart/scatter`                                    |
| [Donut](/examples.html?family=donut#live-gallery)     | Non-negative category weights and share       | `pie`         | `/chart/donut`                                      |
| [Top list](/examples.html?family=ranked#live-gallery) | Rows in supplied rank order                   | `top-list`    | `/chart/top-list`                                   |
| [Treemap](/examples.html?family=treemap#live-gallery) | Non-negative weights as proportional cells    | `treemap`     | `/chart/treemap`                                    |
| [Value](/examples.html?family=value#live-gallery)     | One-row aggregate quantities                  | `big-number`  | `/scalar` for direct values; `/chart` for documents |

Paths are relative to `@scopedb/scopeview`. Horizontal category bars also use `/chart/top-list`. `/report` chooses and loads a layout when the type is not known ahead of time.

## Traces and profiles

| Family                                                     | Typical use                          | Document kind | Entry    |
| ---------------------------------------------------------- | ------------------------------------ | ------------- | -------- |
| [Trace timeline](/examples.html?family=trace#live-gallery) | Span timing and parent relationships | `trace`       | `/trace` |
| [Flame graph](/examples.html?family=profile#live-gallery)  | Inclusive weight across a call tree  | `profile`     | `/flame` |

The [data format](data.md) defines metric encodings, span timestamps and frame weights.

## Reading behavior

Line/area charts connect samples with straight segments and preserve explicit gaps. Stacked inspection reports individual source quantities. Top lists preserve input order; they do not sort or aggregate. Trace timing uses supplied nanoseconds, and profile width comes from self weight plus descendants. Small marks retain keyboard access to their exact readings.

## Next steps

- [Getting started](getting-started.md): mount your first chart and update its data.
- [Headless API](headless.md): choose a factory, enable interactions or load layouts on demand.
- [Web Component API](api.md): use built-in controls, events and saved views.
