---
description: Export self-contained chart pages and HTML fragments with the Node.js API or CLI.
---

# HTML export

Export a document as complete offline HTML or an embeddable fragment. Both contain the normalized document, renderer, styles, resolved theme and optional Inter fonts. They open without a database, local service or network connection. Captions and applicable legends are included by default.

For command-line use, follow the [CLI example](cli-example.md) for a complete transcript and both JSON files. The [CLI reference](cli.md) documents commands, options, output, exit codes and file protection. This page covers the Node.js API and shared HTML behavior. The Node.js API requires Node 24+.

## Node.js API

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { createEmbed, serializeDocument } from '@scopedb/scopeview/embed';

const document = JSON.parse(await readFile('chart.json', 'utf8'));
const html = await createEmbed(document, {
  theme: 'system',
  fonts: false,
  format: 'html',
  caption: true,
  legend: true,
  tooltip: true,
  lang: 'en',
  onDiagnostic: (diagnostic) => console.warn(diagnostic.path, diagnostic.message)
});
await writeFile('chart.html', html);
const safeScriptData = serializeDocument(document);
```

`createEmbed(input, options?)` validates and snapshots its input and returns `Promise<string>`. Defaults are `format='html'`, `theme='light'`, `fonts=false`, `caption=true`, `legend=true`, `tooltip=true` and `lang='en'`. `{ caption: false }` exports only the plot, and `{ legend: false }` hides its caption legend. These apply to full HTML and fragments. Unknown export keys, including the removed `fragment` boolean, throw an error with their path. Language must be one nonempty string accepted by `Intl.getCanonicalLocales`. It sets canonical `html.lang`, or root `lang` for a fragment; it does not translate authored text, field names or built-in UI strings, or select a display time zone or date/time locale. The [CLI byte cap and file publication policy](cli.md#input-and-file-protection) do not apply to object-input calls.

`onDiagnostic` receives the same ordered relationship warnings as CLI `render`, without changing the `Promise<string>` return. Its exported type is `EmbedDiagnostic` (`severity`, `code`, `path`, `message`). Without a callback, the API remains silent. Invalid documents reject with `ChartValidationError` and its path/message. Missing installed rendering assets throw `ERR_SCOPEVIEW_ASSET_MISSING`, directing callers to install a complete matching package. No source-path or network fallback is attempted. Importing `/embed` does not parse arguments, run the CLI, print or write anything. Build before using it from a checkout.

## Fragments

Use `--format fragment` or `{ format: 'fragment' }` when a host accepts inline HTML. The host must permit its scripts and styles. A script-only sandboxed iframe can render without a network. Apply normal attribute escaping to a complete fragment when placing it in an attribute such as `srcdoc`.

Fragments must be strictly smaller than 1,000,000 UTF-8 bytes, including runtime, styles, fonts and data. Larger output throws a `RangeError` with `ERR_SCOPEVIEW_FRAGMENT_SIZE`. Request complete HTML explicitly when needed; the exporter never changes format, samples, aggregates or truncates data to fit. `serializeDocument` preserves original parsed strings while escaping HTML script data; it is not a sanitizer for arbitrary HTML.

## Appearance and interaction

Light and system fonts remain the defaults. With `theme: 'system'`, exports follow a single CSS `color-scheme` declared on the document root, or the OS preference when both schemes are allowed. Explicit light/dark options remain local to each figure.

Caption legends use compiled axis-series source colors. Exported reports retain fitted trace/profile layouts and transient inspection. Persistent selection and application controls belong to [browser components and host applications](headless.md). Both paths use the same compiler, source semantics, geometry, painter and accepted design baseline.

### Time display

Time-series axes and inspection use the viewer browser's local time zone, including in offline HTML. For example, `2026-10-27T00:02:00Z` displays as `08:02` in `Asia/Singapore` (`GMT+8`), with the source timestamp retained in inspection. The same file can show different clock labels on another viewer's device; exporting does not bake in a display time zone. See [time display](data.md#time-display).

### Fonts

`--fonts` and `createEmbed(document, { fonts: true })` embed Inter's Latin subset at weights 400 and 600. Chinese and other CJK glyphs use fonts available on the viewer's device, so an offline report's CJK appearance can vary between machines. `fontFamily` in a theme selects a family list; it does not load or embed additional fonts.
