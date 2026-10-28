# CLI reference

`scopeview` validates chart documents and exports offline HTML. For a complete worked transcript, including every command, output and both JSON files, see the [CLI example](cli-example.md). The [HTML export API](embedding.md) covers Node.js callers.

## Installation and invocation

The package provides one executable and requires Node.js 24+:

::: code-group

```sh [npm]
npm install @scopedb/scopeview
npx scopeview --help
```

```sh [pnpm]
pnpm add @scopedb/scopeview
pnpm exec scopeview --help
```

```sh [Bun]
bun add @scopedb/scopeview
bunx scopeview --help
```

:::

To run without adding a project dependency:

::: code-group

```sh [npm]
npx --yes @scopedb/scopeview example bar > chart.json
npx --yes @scopedb/scopeview render chart.json --output chart.html
```

```sh [pnpm]
pnpm dlx @scopedb/scopeview example bar > chart.json
pnpm dlx @scopedb/scopeview render chart.json --output chart.html
```

```sh [Bun]
bunx @scopedb/scopeview example bar > chart.json
bunx @scopedb/scopeview render chart.json --output chart.html
```

:::

To select a specific release, append its version to the package name, for example `bunx @scopedb/scopeview@0.1.0 --help`.

All three commands run the same CLI with Node.js; `bunx` respects its Node.js shebang. The package contains the library and CLI resources and needs no install script or separate binary download.

A platform archive includes the same accepted npm package and a pinned official Node runtime. Extract the complete archive, then invoke `bin/scopeview` on macOS/Linux or `bin\scopeview.cmd` on Windows. No external Node/npm, browser installation or network connection is required to validate or export after extraction. Opening the resulting HTML requires a browser.

Keep `app/`, `runtime/` and `licenses/` together. The directory can be moved; the Unix launcher also supports a symlink on PATH. Release files include SHA-256 checksums and runtime/package integrity in `manifest.json`, plus the Node, ScopeView and font licenses. The release workflow targets macOS, Linux and Windows on x64/ARM64. Linux uses the official Node glibc runtime; Alpine/musl needs a compatible environment. Platform requirements follow Node 24.

From a built source checkout, use `node node/cli.mjs ...`. Run `pnpm build` before invoking the checkout's CLI.

## Command overview

```text
scopeview <command> [options]
scopeview --help
scopeview --version
```

| Command    | Required operands                     | Result                                                          |
| ---------- | ------------------------------------- | --------------------------------------------------------------- |
| `validate` | One document path, or `-`             | Compile and report the family, record/field counts and warnings |
| `render`   | One document path, or `-`; `--output` | Export complete HTML or a fragment                              |
| `schema`   | None                                  | Print the complete version-1 document JSON Schema               |
| `example`  | One example name                      | Print one complete synthetic document                           |

`scopeview --help` lists commands. `scopeview <command> --help` or `-h` prints that command's usage; `scopeview example --help` also lists every example name. Root `--help` and `--version` accept no additional arguments.

## validate

```sh
scopeview validate <input|-> [--json] [--max-input-bytes <bytes>]
```

The input is one UTF-8 JSON [document](data.md). `-` reads stdin. Validation compiles the document, including semantic checks such as field references, row widths and hierarchy relationships; it does not write a file.

Human success output has this form:

```text
Valid metric document: 4 records, 2 fields.
```

Trace/profile summaries contain record counts without a metric field count. Warnings go to stderr. With `--json`, stdout contains a validation receipt and its diagnostics. Success, including nonfatal warnings, exits 0.

`validate` checks the document only. It accepts no `--theme`; a theme file is validated when `render` reads it.

## render

```sh
scopeview render <input|-> --output <path|-> [options]
```

The document is required. Rendering validates it before export; running `validate` first is optional. A theme, caption, legend and tooltip are exporter settings rather than fields in `chart.json`.

| Option                         | Required? | Default    | Contract                                                        |
| ------------------------------ | --------- | ---------- | --------------------------------------------------------------- |
| `--output <path>`, `-o <path>` | Yes       | None       | Destination file; `-` writes HTML to stdout                     |
| `--format html\|fragment`      | No        | `html`     | Complete HTML document or embeddable fragment                   |
| `--theme <mode\|path>`         | No        | `light`    | `light`, `dark`, `system`, or a theme JSON file path            |
| `--fonts`                      | No        | Off        | Embed Inter Latin font bytes at weights 400 and 600             |
| `--no-caption`                 | No        | Off        | Hide the authored title/description and caption legend          |
| `--no-legend`                  | No        | Off        | Hide the caption's axis-series legend                           |
| `--no-tooltip`                 | No        | Off        | Hide floating readings                                          |
| `--lang <tag>`                 | No        | `en`       | Canonical HTML language metadata, e.g. `zh-cn` becomes `zh-CN`  |
| `--force`                      | No        | Off        | Atomically replace an existing regular output file              |
| `--json`                       | No        | Off        | Print a machine receipt on stdout, or an error object on stderr |
| `--max-input-bytes <bytes>`    | No        | `67108864` | Positive safe integer document transport cap                    |
| `--help`, `-h`                 | No        | Off        | Print command usage                                             |

Boolean flags take no value. Caption, applicable legend and readings are enabled by default. `--no-caption` also hides the legend because it belongs to the caption. Temporal bars, source values, plot geometry and document options remain those of the input document; export does not aggregate or truncate data.

Default file-export stdout is the absolute output path. `--json` selects a receipt instead. `--output -` emits only HTML on stdout; it cannot be combined with `--json`. Fragments must be strictly smaller than 1,000,000 UTF-8 bytes, including runtime, styles, fonts and data. Oversize fragments fail; the CLI does not switch formats.

`--lang` sets `html.lang`, or the root `lang` for a fragment. It does not translate authored text or built-in UI strings, or choose a date/time locale or display time zone. Time-series labels use the viewer browser's local time zone. `--fonts` embeds only Inter Latin; CJK glyphs depend on available fallback fonts. See [time display and fonts](embedding.md#appearance-and-interaction).

### Theme files

Use `--theme ./theme.json` to share appearance across documents. The path resolves from the current working directory. The file must be UTF-8 JSON and at most 65,536 bytes (64 KiB), independently of `--max-input-bytes`. `--theme -` is rejected because stdin is reserved for the document. A value other than `light`, `dark` or `system` is treated as a file path; prefix `./` to refer to a file with one of those names.

A theme file can contain a mode string such as `"dark"`, or a configuration object. Every object field, including every nested color, is optional; `{}` selects the default light appearance. Unknown keys are errors. These are the complete accepted object keys:

| Field              | Required? | Default / accepted values                                                       |
| ------------------ | --------- | ------------------------------------------------------------------------------- |
| `mode`             | No        | `light`; accepts `light`, `dark`, `system`                                      |
| `fontFamily`       | No        | Library font stack; CSS family list, 1–256 characters, no URLs or CSS variables |
| `fontSize`         | No        | Base size 13 CSS px; accepts numbers from 8 through 32                          |
| `palette`          | No        | Built-in categorical palette; accepts 1–10 opaque `#rgb` or `#rrggbb` colors    |
| `colors`           | No        | Optional object containing only the three roles below                           |
| `colors.surface`   | No        | Default theme surface; opaque `#rgb` or `#rrggbb`                               |
| `colors.text`      | No        | Default primary text; opaque `#rgb` or `#rrggbb`                                |
| `colors.mutedText` | No        | Default secondary text; opaque `#rgb` or `#rrggbb`                              |

Font size scales text roles proportionally; a short palette repeats across ten stable categorical slots. Theme font families do not load additional fonts. See [styling](styling.md#themes) for sizing, color and precedence details. The [CLI example](cli-example.md#required-fields) marks every required document/theme field.

Theme validation errors use `ERR_SCOPEVIEW_THEME`, an exact `theme.*` path and exit 3. No output is published. The output cannot replace the theme file, including with `--force`. The exported HTML embeds the resolved appearance and does not need the theme file beside it afterward.

## schema

```sh
scopeview schema
scopeview schema > document.schema.json
```

Print one complete self-contained JSON Schema 2020-12 document. Its ID is `urn:scopedb:scopeview:document:1`; local `$defs` cover metric, trace and profile documents. No hosted resolver or family selector is needed. This is a structural authoring resource; the compiler validates references, row widths, intervals, cycles and other semantics.

The schema covers chart documents, including strict configuration keys. It does not describe theme files. `schema` always prints JSON and accepts only `--help`/`-h`; `--json`, positional inputs and other options are usage errors.

## example

```sh
scopeview example <name>
scopeview example bar > chart.json
scopeview example line | scopeview validate -
```

Print one complete synthetic document using the current authoring format.

| Name             | Document                                                  |
| ---------------- | --------------------------------------------------------- |
| `line`           | Time series with zero and an explicit missing observation |
| `area`           | Area time series                                          |
| `bar`            | Category bars, including zero and NULL                    |
| `horizontal-bar` | `bar` with `options.orientation: 'horizontal'`            |
| `scatter`        | Numeric coordinates                                       |
| `pie`            | Donut weights                                             |
| `top-list`       | Rows in supplied rank order                               |
| `treemap`        | Proportional cells                                        |
| `big-number`     | One-row aggregate quantities                              |
| `trace`          | Span timing and parent relationships                      |
| `profile`        | Weighted call frames                                      |

The name is required and must be one of the values above. `example` always prints JSON and accepts only `--help`/`-h`; it does not accept `--json`.

## Argument and stream rules

`validate` and `render` take exactly one input. Both accept `--json` and `--max-input-bytes`; render-only options are rejected by other commands. Standard long equals values (`--theme=dark`) and separate values work.

Unknown, empty and repeated options, repeated aliases, extra operands and incompatible combinations are usage errors. Arguments are checked before input is read or output directories are created. Put options before `--` when an operand starts with `-`.

| Operation             | stdout                                  | stderr                         |
| --------------------- | --------------------------------------- | ------------------------------ |
| `validate`            | Human summary, or receipt with `--json` | Warnings in human mode; errors |
| `render -o file.html` | Absolute path, or receipt with `--json` | Warnings in human mode; errors |
| `render -o -`         | HTML only                               | Warnings and errors            |
| `schema`, `example`   | JSON                                    | Errors                         |
| `--version`           | Package version                         | Errors                         |

No progress banners are emitted. JSON-mode success diagnostics include warnings; JSON-mode failures produce one error object on stderr. Discard partial stdout if a command fails. The CLI awaits stream writes, and a broken downstream pipe exits with an I/O error. Shell redirection can truncate a file before the CLI starts, so output-file protection does not cover a shell's `> file.html` redirection.

## Input and file protection

Inputs must be UTF-8 JSON; one leading UTF-8 BOM is accepted. Size and SHA-256 cover original bytes, including the BOM. Invalid UTF-8, malformed JSON and numeric metric cells fail. Numeric cells must already be strings, as described in the [data format](data.md); this CLI is not a lossless raw-database decoder.

The default document transport cap is 67,108,864 bytes (64 MiB). Reading stops when the cap is exceeded. Override it with a positive safe integer `--max-input-bytes` value. Compiler row, column, cell and text limits are separate; see [data limits](data.md#authoring-resources-and-validation).

An existing regular output requires `--force`. Input/output aliases are rejected, including relative paths, symlinked parents, hard links and regular-file stdin descriptors when available. Input symlinks are allowed. Output symlinks, directories and special files are rejected even with `--force`. Theme input aliases receive the same protection.

The document and theme are validated and HTML is built before missing parents are created. Output is written to an exclusive sibling temporary file and closed before publication. Without `--force`, an exclusive hard link publishes it; an intervening writer's file is preserved. Filesystems without this operation fail explicitly. With `--force`, a same-filesystem atomic rename replaces the checked regular target and retains its permissions. Owned temporary files are cleaned up on failure. These checks are not a sandbox against hostile directory replacement.

## Machine protocol

`--json` receipts have `schemaVersion: 1`, independent of document and package versions.

| Success field      | Meaning                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `scopeviewVersion` | Installed package version                                                                                             |
| `status`           | `validated` or `exported`                                                                                             |
| `input`            | `{ path, bytes, sha256 }`; absolute path or `"-"` for stdin                                                           |
| `document`         | `{ version: 1, kind, records, fields }`; rows/spans/frames and metric field count, or `null` fields for trace/profile |
| `diagnostics`      | Ordered warnings; empty array when there are none                                                                     |
| `theme`            | Export with a theme file only: `{ path, bytes, sha256 }` for that snapshot                                            |
| `format`           | Export only: `html` or `fragment`                                                                                     |
| `output`           | Export to a file only: `{ path, bytes, sha256 }` of the published bytes                                               |

Failures print one object on stderr with `status: 'error'`, `schemaVersion`, `scopeviewVersion` (null only if metadata cannot be read) and `diagnostics`. Each diagnostic has `severity`, `code`, `path` (null without an input location) and `message`. Codes, severity, paths and protocol version are stable; human messages may evolve. The first fatal compiler error retains its original path, such as `data.rows[2][1]`.

Unknown document fields produce `ERR_SCOPEVIEW_DOCUMENT`; unknown theme fields produce `ERR_SCOPEVIEW_THEME`. For example, `options.toolip` reports that exact path and `Unknown option.`; no output is published.

Relationship warnings are `HIERARCHY_MISSING_PARENT` at the original parent field and `TRACE_OUTSIDE_PARENT` at the original span. Warnings are sorted by path/code and do not alter sources. Component UI settings are rejected inside a document, including during export.

Argument errors use JSON if a literal `--json` occurs before `--`, including unsupported uses of that option. A token after `--` is an operand and does not select error formatting. Hashes establish byte integrity, not query provenance. `exported` means file publication succeeded; it does not claim a browser displayed or painted the result.

## Exit codes

| Exit | Meaning / codes                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success, including nonfatal warnings                                                                                                                                            |
| `2`  | `ERR_SCOPEVIEW_USAGE`                                                                                                                                                           |
| `3`  | `ERR_SCOPEVIEW_JSON`, `ERR_SCOPEVIEW_DOCUMENT`, `ERR_SCOPEVIEW_THEME`                                                                                                           |
| `4`  | `ERR_SCOPEVIEW_IO`, `ERR_SCOPEVIEW_OUTPUT_EXISTS`, `ERR_SCOPEVIEW_INPUT_OUTPUT_ALIAS`, `ERR_SCOPEVIEW_OUTPUT_TYPE`, `ERR_SCOPEVIEW_ASSET_MISSING`, `ERR_SCOPEVIEW_NODE_VERSION` |
| `5`  | `ERR_SCOPEVIEW_INPUT_LIMIT`, `ERR_SCOPEVIEW_FRAGMENT_SIZE`                                                                                                                      |
| `1`  | `ERR_SCOPEVIEW_INTERNAL`                                                                                                                                                        |
