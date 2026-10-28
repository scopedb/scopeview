---
description: Document formats, field mappings, time semantics and precision for metrics, traces and profiles.
---

# Data format

ScopeView consumes a complete snapshot. A document describes data, chart mappings and optional display settings.

Fetching, aggregation and application state stay with the caller. All document families use `version: 1` and accept optional `title` and `description` strings. Headless views leave those captions to the application; components and HTML exports show them by default. Configure their UI at the host, separately from document options.

## Choose a document

| Your data                      | Document             | Start with                              |
| ------------------------------ | -------------------- | --------------------------------------- |
| Columns and rows               | `ChartDocumentInput` | [Metric documents](#metric-documents)   |
| Spans with start and end times | `TraceDocument`      | [Trace documents](#trace-documents)     |
| Call frames with self weights  | `ProfileDocument`    | [Profile documents](#profile-documents) |

If you are choosing how to visualize a table, use the [chart family guide](charts.md).

## Authoring resources and validation

`scopeview example <name>` prints a complete synthetic document; the package includes `line`, `area`, `bar`, `horizontal-bar`, `scatter`, `pie`, `top-list`, `treemap`, `big-number`, `trace` and `profile` under `examples/documents/`. The `pie` example renders a donut.

::: code-group

```sh [npm]
npx scopeview schema > document.schema.json
npx scopeview validate chart.json --json
```

```sh [pnpm]
pnpm exec scopeview schema > document.schema.json
pnpm exec scopeview validate chart.json --json
```

```sh [Bun]
bunx scopeview schema > document.schema.json
bunx scopeview validate chart.json --json
```

:::

The schema is also exported as `@scopedb/scopeview/schema/v1.json`, with ID `urn:scopedb:scopeview:document:1`. One schema covers all three families through local `$defs`; no hosted resolver is needed. It describes structural requirements and rejects unknown properties in configuration records. `compileVisualization` checks references, row widths, eligibility, cycles, intervals and other semantic constraints without depending on a schema engine at runtime. Package, document and CLI protocol versions are independent; the document format uses `version: 1` and an omitted `kind` defaults to metric.

Compiler limits are 10,000 metric rows, 64 columns, 100,000 cells, 100,000 hierarchy nodes, 64 attributes per node, 40-digit hierarchy integers and 4,096 UTF-16 code units per text value. JSON Schema counts Unicode code points for `maxLength`; astral-character boundaries can therefore pass schema and fail the compiler. Trace timestamps, profile weights and metric numeric cells are strings rather than numeric JSON. NULLs, zero, source order and explicit gaps survive validation and export unchanged. The CLI separately limits input bytes; see [CLI input limits](cli.md#input-and-file-protection).

## Metric documents

Use `ChartDocumentInput` from `@scopedb/scopeview` when authoring a document. Its fields are:

| Field                | Meaning                                          |
| -------------------- | ------------------------------------------------ |
| `version`            | `1`                                              |
| `kind`               | Optional `'metric'`                              |
| `data.fields`        | Ordered `{ name, data_type }` column definitions |
| `data.rows`          | Arrays of strings or `null`, in column order     |
| `spec.visualization` | Required chart type                              |
| `spec.encoding`      | Required field roles for that chart type         |
| `semantics`          | Optional time/bucket facts and provenance        |
| `options`            | Optional plot settings                           |

```ts
import type { ChartDocumentInput } from '@scopedb/scopeview';

export const latency: ChartDocumentInput = {
  version: 1,
  title: 'Request latency',
  data: {
    fields: [
      { name: 'time', data_type: 'timestamp' },
      { name: 'latency', data_type: 'number' }
    ],
    rows: [
      ['2026-01-01T00:00:00Z', '12.5'],
      ['2026-01-01T00:01:00Z', null],
      ['2026-01-01T00:02:00Z', '18.25']
    ]
  },
  spec: {
    visualization: 'line',
    encoding: { x: 'time', y: ['latency'] }
  },
  options: { values: [{ field: 'latency', divisor: '1', unit: 'ms', decimals: 2 }] }
};
```

The middle sample is an explicit gap. Line and area charts connect supplied samples with straight segments; they do not interpolate missing observations.

`ChartDocumentInput` and `ChartSpecInput` accept field names. The parser returns an owned `ChartDocument` with full field references, which can be passed back to the parser. Row count is always `rows.length`. Only the document has a `version`; `spec.visualization` selects the encoding roles. The TypeScript types and JSON Schema enforce those associations.

Unknown properties are errors at every document level, including `data`, field definitions, nested options, field references and semantics. `data` contains only `fields` and `rows`. A typo such as `options.toolip` throws `ChartValidationError` with path `options.toolip`. Arbitrary names are allowed only in the `colors` and entity `attributes` maps.

### Fields and encodings

`data_type` accepts exactly three values:

| Type        | Use                                     | Cell example                   |
| ----------- | --------------------------------------- | ------------------------------ |
| `string`    | Labels and categories                   | `"api"`                        |
| `number`    | Integers, decimals, counts and measures | `"9007199254740993"`, `"12.5"` |
| `timestamp` | Date/time observations                  | `"2026-01-01T00:00:00Z"`       |

Every cell is still a string or `null`; `number` describes the column and does not turn cells into JSON numbers. Source digits remain exact in readings. Database type names such as `int64`, `float64`, `decimal(...)`, `datetime` and `date` are rejected, as are unknown names, different casing and surrounding whitespace. Use explicit UTC or offset timestamps for time series. TypeScript exports the same three-value `ChartDataType` union.

A unique field name can be used in every field slot. When names repeat, use a `ChartFieldRef`:

```ts
import type { ChartFieldRef } from '@scopedb/scopeview';

const valueField: ChartFieldRef = {
  name: 'value',
  data_type: 'number',
  occurrence: 1
};
```

`occurrence` is zero-based among columns with the same name and data type. Preserve their relative order when names and types are identical. Parsing turns shorthand names into full references. Column positions identify rows in one snapshot; field references keep chart mappings meaningful when columns are reordered.

| Visualization                | Required roles                                                       |
| ---------------------------- | -------------------------------------------------------------------- |
| `line`, `area`, `bar`        | `x`, one or more numeric `y`; optional categorical `series`          |
| `scatter`                    | Numeric `x` and `y`; optional numeric `size` and categorical `color` |
| `pie`, `treemap`, `top-list` | `category`, numeric `value`                                          |
| `big-number`                 | One or more numeric `values`, from at most one row                   |

`pie` renders a donut. `top-list` retains supplied row order. A horizontal category bar uses `bar` with `options.orientation: 'horizontal'`, one measure and no series breakdown. Donut and treemap weights must be non-negative and non-NULL; zero does not create invented area. See [chart families](charts.md) for examples and the matching import paths.

### Time display

Temporal axes and inspection display instants in the viewer browser's local time zone. An input's `Z` or explicit offset identifies the instant; it does not select the display time zone. For example, `2026-10-27T00:02:00Z` displays as `08:02` in `Asia/Singapore` (`GMT+8`). Axes include date/time-zone context, and inspection retains the original timestamp string.

The same exported HTML can show different clock labels in different viewing time zones. Export preserves the source timestamps and does not fix the display to the exporting machine's time zone. `--lang` sets HTML language metadata and does not select a time zone or date/time locale.

### Time semantics

Without declared buckets, timestamps are point observations. To describe counts over a fixed interval, add time semantics. For example, this describes one-minute UTC buckets:

```ts
import type { ResultSemantics } from '@scopedb/scopeview';

const semantics: ResultSemantics<string> = {
  time: {
    kind: 'buckets',
    field: 'time',
    intervalMs: 60_000,
    window: { start: 1767225600000, end: 1767225780000 },
    coverage: 'complete',
    valueKind: 'count',
    completeThrough: 1767225720000
  },
  provenance: { kind: 'bins', scope: 'returned', description: 'One-minute counts' }
};
```

Assign this object to a compatible document's `semantics`. Bucket starts are aligned to elapsed epoch milliseconds. `window` is half-open and may clip edge buckets. `coverage` is `complete`, `limited` or `unknown`; it describes supplied coverage. `completeThrough` is a caller-supplied watermark: later buckets are still accumulating. The library does not infer an interval or watermark from adjacent rows or the current clock.

Provenance uses `kind: 'rows' | 'bins' | 'entities'` and `scope: 'returned' | 'sample' | 'matching'`, with optional `approximate` and `description`. A bin's source is the supplied bin row, not the records that produced it.

### Display options

The [document options reference](options.md) defines accepted values and defaults. Use [metric options](options.md#metric-options) for labels, presentation, orientation, stacking and colors, or [quantity formatting](options.md#quantity-formatting) for per-field divisors, units and decimal places. Trace/profile documents accept only `interactive` and `rowHeight`.

Display conversions affect geometry and formatted quantities while retaining original source strings. Field roles remain in `spec.encoding`. Component UI is configured through `configure()`, separately from document options; see [component UI](options.md#component-ui). Headless `axes` and `tooltip` belong to factory options. See [styling](styling.md) for host CSS and themes.

## Trace documents

```ts
import type { TraceDocument } from '@scopedb/scopeview';

export const trace: TraceDocument = {
  version: 1,
  kind: 'trace',
  coverage: 'complete',
  spans: [
    { id: 'root', name: 'request', service: 'api', startTimeNs: '1000000000', endTimeNs: '1000000100' },
    { id: 'db', parentId: 'root', name: 'read', service: 'storage', startTimeNs: '1000000020', endTimeNs: '1000000080' }
  ]
};
```

Each span needs a unique `id`, a `name`, and signed integer-string `startTimeNs` and `endTimeNs`. End must be at or after start. Optional fields are `parentId`, `service`, `status: 'unset' | 'ok' | 'error'` and flat `attributes`. Coverage defaults to `unknown`; `partial` is also supported.

Intervals use nanoseconds. Duration and supplied-child coverage use `bigint`; only relative coordinates are converted for drawing. Overlapping spans receive separate lanes. Missing parents and children outside a parent produce relationship warnings without changing the supplied timestamps. Uncovered time subtracts the union of supplied direct-child intervals; it is not a claim of complete exclusive time.

## Profile documents

```ts
import type { ProfileDocument } from '@scopedb/scopeview';

export const profile: ProfileDocument = {
  version: 1,
  kind: 'profile',
  unit: 'samples',
  frames: [
    { id: 'main', name: 'main', selfWeight: '10' },
    { id: 'read', parentId: 'main', name: 'read', selfWeight: '90', file: 'storage.ts', line: 42 }
  ]
};
```

Each frame needs a unique `id`, a `name` and a non-negative integer-string `selfWeight`. Supply **self weights**. Inclusive weight is self plus descendants; repeated names are not merged. Roots partition the total weight, and sibling order follows the input. `unit` is required. Optional fields are `parentId`, `file`, positive `line` and flat `attributes`. Missing parents remain separate roots with warnings.

For both hierarchy families, `parentId: null` or an omitted parent means root. Attributes are string, finite number, boolean or `null` values. Zero-duration spans and zero-weight frames remain available to keyboard inspection without invented width.

## Precision and validation

The parser copies the supported document fields. Raw source strings remain available in readings, events and exported snapshots. Floating-point coordinates are approximate; nearby values or timestamps can occupy the same pixel. Display conversions of non-integer quantities also use floating-point arithmetic.

| Limit         | Metrics                                     | Traces/profiles   |
| ------------- | ------------------------------------------- | ----------------- |
| Records       | 10,000 rows                                 | 100,000 nodes     |
| Columns/cells | 64 columns; 100,000 cells                   | —                 |
| Text          | 4,096 characters                            | 4,096 characters  |
| Integer input | String values, subject to metric validation | At most 40 digits |
| Attributes    | —                                           | 64 per node       |

Use `parseChartDocument`, `parseTraceDocument` or `parseProfileDocument` to normalize a schema. Use `compileChart`, `compileTrace`, `compileProfile` or `compileVisualization` to validate chart eligibility and hierarchy relationships as well. Duplicate node IDs and cycles are errors. A `ChartValidationError` exposes `path` and `message`.

Factories perform these checks when mounting or updating. Synchronous headless factories throw; `/report` rejects. An invalid headless update leaves the current view intact. Component document assignment instead displays an error and emits `scope-error`.
