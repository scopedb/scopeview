# CLI example

This worked example creates a bar-chart document, applies a reusable theme and exports offline HTML. It shows every command and output, followed by the required fields in both files. For command signatures, all options, defaults and exit codes, use the [CLI reference](cli.md).

The transcript uses ScopeView 0.1.0, a POSIX shell and the macOS ARM64 archive. Its starting directory is `/tmp`; your absolute output paths will reflect your own directory. Commands exit 0 unless another exit code is shown.

## 1. Make the CLI available

Start in the directory containing your platform archive. Extract the whole archive and add its launcher directory to PATH:

```sh
tar -xzf scopeview-v0.1.0-darwin-arm64.tar.gz
export PATH="$PWD/scopeview-v0.1.0-darwin-arm64/bin:$PATH"
```

Both commands produce no output. Choose the archive matching your platform; see [installation and invocation](cli.md#installation-and-invocation) for other platforms, npm and source-checkout usage. The archive includes Node, so this example does not require a separate Node/npm installation.

```sh
scopeview --version
```

stdout:

```text
0.1.0
```

## 2. Create a working directory

```sh
mkdir scopeview-demo
cd scopeview-demo
```

Both commands produce no output. The remaining commands run in this directory:

```sh
pwd
```

stdout:

```text
/tmp/scopeview-demo
```

## 3. Generate chart.json

Discover the available examples:

```sh
scopeview example --help
```

stdout:

```text
Usage: scopeview example <name>
  --help, -h  Show usage
Examples: line, area, bar, horizontal-bar, scatter, pie, top-list, treemap, big-number, trace, profile
```

Generate the bar example:

```sh
scopeview example bar > chart.json
```

No terminal output: stdout was redirected into `chart.json`. Read the complete file:

```sh
cat chart.json
```

stdout, the complete `chart.json`:

```json
{
  "version": 1,
  "title": "Requests by service",
  "data": {
    "fields": [
      {
        "name": "service",
        "data_type": "string"
      },
      {
        "name": "requests",
        "data_type": "number"
      }
    ],
    "rows": [
      [
        "api",
        "120"
      ],
      [
        "worker",
        "80"
      ],
      [
        "idle",
        "0"
      ],
      [
        "missing",
        null
      ]
    ]
  },
  "spec": {
    "visualization": "bar",
    "encoding": {
      "x": "service",
      "y": [
        "requests"
      ]
    }
  }
}
```

`data` contains `fields` and `rows` directly. Numeric cells are strings such as `"120"` and `"0"`; the missing value is JSON `null`. Adding a row requires no separate row count.

## 4. Validate the document

```sh
scopeview validate chart.json
```

stdout:

```text
Valid metric document: 4 records, 2 fields.
```

This checks the document only. Rendering also validates it, so this separate step is optional. A theme is validated by `render --theme`, not by `validate`.

## 5. Write theme.json

Create a reusable theme with a base font size of 16, a custom palette and surface colors:

```sh
cat > theme.json <<'JSON'
{
  "mode": "light",
  "fontFamily": "Inter, system-ui, sans-serif",
  "fontSize": 16,
  "palette": ["#3979ce", "#16a38d", "#a57ccd", "#c48c23"],
  "colors": {
    "surface": "#f4f6fa",
    "text": "#18212b",
    "mutedText": "#68758a"
  }
}
JSON
```

No output. Read the complete file:

```sh
cat theme.json
```

stdout, the complete `theme.json`:

```json
{
  "mode": "light",
  "fontFamily": "Inter, system-ui, sans-serif",
  "fontSize": 16,
  "palette": ["#3979ce", "#16a38d", "#a57ccd", "#c48c23"],
  "colors": {
    "surface": "#f4f6fa",
    "text": "#18212b",
    "mutedText": "#68758a"
  }
}
```

Every theme field is optional. Keep this file separate from `chart.json` so the same data can be rendered with different themes. Font size is a base size: text roles scale proportionally rather than all becoming exactly 16px.

## 6. Export HTML

```sh
scopeview render chart.json -o chart.html --theme ./theme.json --fonts
```

stdout:

```text
/tmp/scopeview-demo/chart.html
```

`chart.json` and `-o chart.html` are required. `--theme` and `--fonts` are optional. Open `chart.html` in a browser. It includes the data, renderer, styles, resolved theme and Inter Latin fonts, and works offline without the JSON files beside it. The caption shows "Requests by service". Focus the plot and use the arrow keys or Home/End to inspect its numeric rows, including the zero value. The `missing` row remains `null` in the embedded data and paints no bar; keyboard inspection in this vertical bar example visits the three numeric rows.

`--fonts` embeds Inter 400/600, while Chinese and other CJK glyphs use available system fonts. A theme's `fontFamily` does not download or embed additional fonts. Time-series labels, when present, use the viewer browser's local time zone. See [time display and fonts](embedding.md#appearance-and-interaction).

## 7. Replace an existing export

Repeating the previous command fails because the output already exists:

```sh
scopeview render chart.json -o chart.html --theme ./theme.json --fonts
```

Exit 4. stdout is empty; stderr:

```text
ERR_SCOPEVIEW_OUTPUT_EXISTS: Output already exists. Use --force to replace the regular file.
```

The existing file remains intact. Request replacement explicitly:

```sh
scopeview render chart.json -o chart.html --theme ./theme.json --fonts --force
```

stdout:

```text
/tmp/scopeview-demo/chart.html
```

## 8. Reuse the document

Export the same data with the default light appearance and system font fallbacks:

```sh
scopeview render chart.json -o chart-default.html
```

stdout:

```text
/tmp/scopeview-demo/chart-default.html
```

Or create a fragment with the custom theme and fonts, without its caption:

```sh
scopeview render chart.json -o chart-fragment.html --format fragment --theme ./theme.json --fonts --no-caption
```

stdout:

```text
/tmp/scopeview-demo/chart-fragment.html
```

Fragments are for hosts that permit their inline scripts/styles. See [fragment requirements](embedding.md#fragments).

## 9. Use JSON, schema and stdin

Ask for a machine-readable validation receipt:

```sh
scopeview validate chart.json --json
```

stdout is one JSON line, formatted here for readability:

```json
{
  "schemaVersion": 1,
  "scopeviewVersion": "0.1.0",
  "input": {
    "path": "/tmp/scopeview-demo/chart.json",
    "bytes": 579,
    "sha256": "6c511bdf1e6ce99149dbdefda0e42e0be9b99560122ecbb46ee2bd3f45db8d06"
  },
  "status": "validated",
  "document": {
    "version": 1,
    "kind": "metric",
    "records": 4,
    "fields": 2
  },
  "diagnostics": []
}
```

Save the complete document schema for an editor or another validator:

```sh
scopeview schema > document.schema.json
```

No terminal output: stdout is redirected into the schema file. The schema covers chart documents; theme validation remains part of rendering.

Use `-` to validate a document from stdin:

```sh
scopeview example line | scopeview validate -
```

stdout:

```text
Valid metric document: 5 records, 2 fields.
```

## 10. Observe a configuration error

Create a file with a misspelled theme key:

```sh
printf '{"fontSzie":16}\n' > invalid-theme.json
```

No output. Try to use it:

```sh
scopeview render chart.json -o invalid.html --theme ./invalid-theme.json
```

Exit 3. stdout is empty; stderr:

```text
ERR_SCOPEVIEW_THEME: theme.fontSzie: Unknown option.
```

No `invalid.html` is created. The error identifies the exact unknown key. Correct it to `fontSize`, or use the valid `theme.json` from step 5. Unknown document and nested configuration keys are also errors; they are never silently ignored.

## Required fields

### chart.json

For the bar document shown above:

| Field                     | Required?   | Contract                                               |
| ------------------------- | ----------- | ------------------------------------------------------ |
| `version`                 | Yes         | Number `1`                                             |
| `data`                    | Yes         | Object containing `fields` and `rows`                  |
| `data.fields`             | Yes         | Nonempty ordered field list                            |
| `data.fields[].name`      | Yes         | Field name; unique names allow the shorthand used here |
| `data.fields[].data_type` | Yes         | Exactly `string`, `number` or `timestamp`              |
| `data.rows`               | Yes         | Row arrays in field order; may be `[]`                 |
| `spec`                    | Yes         | Visualization and its field-role mappings              |
| `spec.visualization`      | Yes         | `bar` in this example                                  |
| `spec.encoding`           | Yes         | Required roles for the selected visualization          |
| `spec.encoding.x`         | Yes for bar | Field name or full field reference                     |
| `spec.encoding.y`         | Yes for bar | Nonempty array of numeric field names/references       |
| `title`                   | No          | Caption shown by default in the HTML export            |

Every row must have exactly as many cells as there are fields. Cells are strings or `null`, including cells in a `number` column. `"0"` and `null` have different meanings. `title` is the only optional field present in this example; removing it still leaves a valid document. `kind` defaults to metric when omitted. Other optional document fields and the required roles for other chart types are listed in the [data reference](data.md).

### theme.json

The file itself is optional: omit `--theme` to use the default light appearance. Within a theme file, **no fields are required**, and `{}` is valid.

| Field              | Required? | Contract                                                    |
| ------------------ | --------- | ----------------------------------------------------------- |
| `mode`             | No        | `light` (default), `dark` or `system`                       |
| `fontFamily`       | No        | CSS family list, 1–256 characters; no URLs or CSS variables |
| `fontSize`         | No        | Number from 8 through 32 CSS px; base default 13            |
| `palette`          | No        | 1–10 opaque hex colors, each `#rgb` or `#rrggbb`            |
| `colors`           | No        | Object containing only the three optional roles below       |
| `colors.surface`   | No        | Opaque `#rgb` or `#rrggbb` surface color                    |
| `colors.text`      | No        | Opaque `#rgb` or `#rrggbb` primary text color               |
| `colors.mutedText` | No        | Opaque `#rgb` or `#rrggbb` secondary text color             |

These are the complete allowed theme keys. A theme file has no `version` field, and putting `theme` inside `chart.json` is an unknown document setting. Use [`render --theme`](cli.md#theme-files) to select it.
