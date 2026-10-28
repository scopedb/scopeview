---
description: Accepted values, defaults and interface-specific behavior for metric, trace and profile document options.
---

# Document options

Set these fields in a document's `options` object. Metrics use `ChartOptions`; traces and profiles use `EntityOptions`, both exported by `@scopedb/scopeview`.

For a headless view, update the complete document with `view.update(document)`. For a Web Component, set or update its document for plot settings. Use `chart.configure(ui)` for component UI separately; it preserves compatible document/view state and merges top-level UI fields, replacing nested objects and arrays. Unknown configuration keys are errors at both boundaries.

Theme, host size and headless factory options are separate: see [styling](styling.md) and the [headless view options](headless.md#options-and-readings). Component UI is rejected inside documents and does not add headers, controls or detail panels to a headless view.

## Shared options

These fields are accepted by all three document families. Interaction settings apply to plots; HTML numeric values have no plot input.

| Option        | Accepted values and default                           | Behavior                                                                                                           |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `interactive` | Boolean; defaults to `true`, except metric sparklines | Enables inspection and navigation input. `false` disables those actions; raw data access is controlled separately. |

## Component UI

Pass these settings to a Web Component's `configure(ui)` method. They are not document options. For headless views, use factory options and host UI instead.

| Option             | Accepted values and default                                      | Behavior                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `axes`             | `'full'`, `'minimal'` or `'none'`; default `'full'`              | Selects component ruler density.                                                                                                                             |
| `tooltip`          | Boolean; default `true`                                          | Shows built-in floating readings. `false` keeps source callbacks/events available.                                                                           |
| `header`           | Boolean; default `true`                                          | Components show a supplied title/description. Empty captions and metric sparkline captions remain hidden. Headless hosts supply their own captions.          |
| `dataTable`        | Boolean; default `true`                                          | Components can open the raw data table. `false` removes that action.                                                                                         |
| `toolbar`          | Boolean or toolbar object; default enabled                       | Components show their toolbar when chart input is enabled. `false` hides built-in and slotted controls. See [toolbar configuration](#toolbar-configuration). |
| `dismissOnOutside` | Boolean; default `true`                                          | Components dismiss readings on outside pointer/focus input. `false` retains the reading. Headless views always dismiss on outside input.                     |
| `legend`           | Metrics only; boolean or `{ columns: [...] }`; default automatic | Controls the component legend. See [legends](#legends).                                                                                                      |
| `summary`          | Trace/profile only; boolean; default `true`                      | Shows node counts, trace coverage and relationship-warning counts when applicable.                                                                           |
| `inspector`        | Trace/profile only; boolean; default `true`                      | Shows pinned entity details below the controls. `false` preserves selection events.                                                                          |

### Toolbar configuration

`toolbar` accepts `true`, `false`, or an object with these fields:

| Field         | Accepted values and default                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| `actions`     | An array of unique supported action names; omitted means all family actions. `[]` hides all action buttons. |
| `attribution` | Boolean; default `true`. Set `false` to hide the built-in attribution.                                      |

Metric actions are `inspect`, `toggle-data` and `show-all`. Trace/profile actions are `inspect`, `zoom-in`, `zoom-out`, `reset-view`, `toggle-collapse` and `toggle-data`. The standard toolbar retains its canonical action order. Filtering buttons does not disable keyboard shortcuts or programmatic actions; use `interactive` or `dataTable` for that. See [custom toolbars](api.md#custom-toolbar) for rendering controls in a host slot.

### Legends

`legend: true` requests series names; `false` hides the component legend. With no explicit setting, components show a names-only legend when there are at least two series, except in sparkline or non-interactive views. Aggregate numeric values have no plot legend. Sparkline and non-interactive component views keep the legend hidden even when requested.

For numeric summaries, use `{ columns: ['last', 'avg', 'sum', 'min', 'max'] }` with any 1–5 unique names in the desired column order. This form requires axis or distribution encoding and can show a single series. Arithmetic excludes NULL values. Configure these columns on the component; they are not accepted inside `document.options`.

## Metric options

These fields belong to metric documents, in addition to the shared options.

| Option          | Accepted values and default                                                   | Behavior                                                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `labels`        | `'auto'` or `'none'`; omission uses the host's automatic policy               | `auto` fits optional labels for applicable families; `none` hides them. With no explicit value, small single-series headless category bars may show direct values; other optional labels are not forced on. |
| `presentation`  | `'full'` or `'sparkline'`; default `'full'`                                   | Selects the metric layout treatment. See [presentation](#presentation).                                                                                                                                     |
| `orientation`   | `'vertical'` or `'horizontal'`; default `'vertical'`                          | Horizontal bars require categorical `x`, one numeric `y` field and no series breakdown.                                                                                                                     |
| `stack`         | Boolean; bars stack unless `false`                                            | `false` groups bars side by side or overlays areas. Area stacking requires one `y` field; multiple `y` fields remain overlaid. Line connections stay unchanged.                                             |
| `colors`        | A record from series/category name to a supported color; default no overrides | Accepts hex colors with 3, 4, 6 or 8 digits and palette tokens wrapped in `var(...)`. See [color assignment](#color-assignment).                                                                            |
| `colorStrategy` | `'auto'`, `'consistent'`, `'ranked'` or `'semantic'`; default `'auto'`        | Selects palette assignment. Explicit `colors` entries take precedence. See [color assignment](#color-assignment).                                                                                           |
| `values`        | An array of display policies; default no conversion                           | Applies at most one policy per numeric field. See [quantity formatting](#quantity-formatting).                                                                                                              |

### Presentation

| Value       | Treatment                                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `full`      | Standard metric framing; full rulers when the host requests full axes.                                                                                                     |
| `sparkline` | Miniature framing without rulers or optional data labels. Metric components also hide captions and legends. Plot input is disabled unless `interactive: true` is supplied. |

The headless factory's `axes: 'minimal'` default is independent of `presentation`. Use its `axes: 'full'` or `'none'` option when the surrounding application needs a different ruler treatment. Presentation never introduces curves, steps or inferred samples.

### Color assignment

| Strategy     | Assignment                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto`       | Uses semantic roles for recognized level, severity, status and HTTP status-code fields; otherwise stable categorical colors, or the theme color for a single metric without a category.                          |
| `consistent` | Assigns categorical palette slots by stable source identity.                                                                                                                                                     |
| `ranked`     | Assigns categorical palette slots by descending source totals; ties use source identity. Changing totals can change the assigned slots.                                                                          |
| `semantic`   | Interprets category values as semantic roles, with unknown values using the neutral role. Without a category field, falls back to the theme color for a single metric or consistent colors for multiple metrics. |

Supported color tokens are `--color-chart-series-1` through `--color-chart-series-10` and `--color-chart-semantic-info`, `-success`, `-warning`, `-error`, `-critical`, `-debug`, `-trace` and `-unknown`. Each also accepts a `-line` suffix. For example, `colors: { api: 'var(--color-chart-series-1)' }` overrides that source's assignment. See [data colors](styling.md#data-colors) for changing palette tokens on a host.

### Quantity formatting

Each `values` entry accepts:

| Field      | Accepted values and default                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| `field`    | Required numeric field reference or unique field name. See [field references](data.md#fields-and-encodings). |
| `divisor`  | Required finite positive integer string, such as `'1000'`.                                                   |
| `unit`     | Optional string appended to formatted readings.                                                              |
| `decimals` | Integer from 0 to 8; default 2 when a display policy is supplied.                                            |

Division changes plotted quantities as well as displayed values. Original source strings remain available. Omitting `values` retains the default source-reading formatter.

```ts
import type { ChartOptions } from '@scopedb/scopeview';

export const options: ChartOptions<string> = {
  labels: 'auto',
  presentation: 'full',
  values: [{ field: 'latency', divisor: '1000', unit: 's', decimals: 3 }]
};
```

Assign this object to a compatible document with a numeric `latency` field. Options do not fetch data, sort returned rows or change source identity.

## Trace and profile options

These fields belong to trace/profile documents, in addition to the shared options.

| Option      | Accepted values and default                          | Behavior                                                                                                                                          |
| ----------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rowHeight` | A finite number from 18 to 64 CSS pixels; default 24 | Preferred hierarchy row height. Fitted headless reports may compress rows to show every depth; navigation-enabled views use the preferred height. |

Use [trace documents](data.md#trace-documents) and [profile documents](data.md#profile-documents) for their source schemas. Persistence, linked views and controlled ranges are described in [view state and coordination](view-state.md).
