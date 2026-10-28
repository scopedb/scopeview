# ScopeView

A small Canvas chart library for metrics, traces and profiles. ScopeView renders supplied data, preserves exact source readings and provides a shared light/dark theme. It has no runtime npm dependencies.

Import the chart type you need, mount it in an element, and dispose it when that element leaves your application. Titles, filters and surrounding UI belong to your application.

## Install

```sh
npm install @scopedb/scopeview
```

ScopeView ships ESM and TypeScript declarations. Use Node.js 24+ for the HTML exporter and local development. See [development](CONTRIBUTING.md) to build and test a package from source.

## Export an offline report

```sh
pnpm exec scopeview example top-list > chart.json
pnpm exec scopeview render chart.json --output chart.html --theme system --json
```

`scopeview schema` prints the structural JSON Schema. Eleven synthetic document examples are included. Rendering validates the document; use `scopeview validate chart.json` to check it separately. Reports show authored captions by default (`--no-caption` hides them), contain their data and renderer, and work offline with exact pointer and keyboard readings. Existing files require `--force`; input defaults to a 64 MiB cap, overridable with `--max-input-bytes`. `scopeview` is the single CLI command. See [local tooling and export](docs/embedding.md) for stdin/stdout, fragments, machine receipts and the string-returning Node API.

Use `--theme ./theme.json` for shared font, size, palette and surface settings. The same strict theme object works with browser factories, components and `createEmbed`; keep it outside the chart document. See [styling](docs/styling.md).

For a machine without Node.js or npm, use a platform archive from the [GitHub Release](https://github.com/scopedb/scopeview/releases). Extract the complete directory and run `bin/scopeview` (`bin\scopeview.cmd` on Windows), or add its `bin/` directory to PATH. The archive includes the Node runtime and uses the same accepted npm package. Keep its `app/`, `runtime/` and `licenses/` directories together; the complete directory can be moved.

## Draw a chart

Add a host to your HTML:

```html
<div id="chart" style="--scope-chart-height: 280px"></div>
```

Then run this in your application's browser entry:

```ts
import { createChart } from '@scopedb/scopeview/chart';

const chart = createChart(document.querySelector<HTMLElement>('#chart')!, {
  version: 1,
  data: {
    fields: [
      { name: 'service', data_type: 'string' },
      { name: 'requests', data_type: 'number' }
    ],
    rows: [
      ['api', '120'],
      ['worker', '80']
    ]
  },
  spec: {
    visualization: 'bar',
    encoding: { x: 'service', y: ['requests'] }
  }
});
// Call chart.update(document) for new data and chart.dispose() on unmount.
```

`data` contains `fields` and `rows` directly. Column `data_type` is `string`, `number` or `timestamp`. Values in tabular documents are strings or `null`. Large integers and original timestamps remain available in readings; drawing coordinates use floating-point numbers. Hover and keyboard inspection are included. Persistent selection and trace/profile navigation are available through the optional `/interactions` entry.

Row counts come from `rows.length`; spec versions and encoding kinds are not document fields. Unknown configuration is an error. `/chart` supports all metric layouts, including updates from vertical to horizontal bars.

## Choose an entry

| Import from `@scopedb/scopeview` | Use                                                         |
| -------------------------------- | ----------------------------------------------------------- |
| `/chart`                         | Default metric entry; all layouts, with synchronous updates |
| `/trace`, `/flame`               | Trace timelines and profile flame graphs                    |
| `/scalar`                        | HTML values without Canvas                                  |
| `/report`                        | Load the required family and metric layout on demand        |
| `/headless`                      | All families, with synchronous mounting                     |
| `/register`                      | Optional Web Components with built-in controls and details  |
| `/embed`                         | Node.js HTML export                                         |
| `/schema/v1.json`                | Self-contained JSON Schema 2020-12 authoring resource       |

For bundle optimization when layouts stay fixed, use `/chart/axis` (line, area, vertical bar) or `/chart/scatter`, `/chart/donut`, `/chart/top-list`, `/chart/treemap`. These entries reject other layouts on mount and update.

The package root contains DOM-free document, validation and compilation APIs. Each JavaScript entry ships TypeScript declarations. The standalone `scopeview.js` exposes the headless factories as `ScopeView` for classic scripts.

## Documentation

- [Getting started](docs/getting-started.md): installation, first chart and updates.
- [Data format](docs/data.md): metrics, traces, profiles and precision.
- [Headless API](docs/headless.md): imports, lifecycle, loading and interactions.
- [Styling](docs/styling.md) and [frameworks](docs/frameworks.md).
- [HTML export](docs/embedding.md): self-contained files and fragments.
- [Component API](docs/api.md): optional controls, events and saved views.
- [Development](CONTRIBUTING.md): local examples, checks, builds and packaging.
- [Releasing](RELEASE.md): release artifacts, npm trusted publishing and publication steps.

Run `pnpm docs:dev` for the documentation site or `pnpm dev` for the examples. Run `pnpm verify` for the validation suite after installing Playwright's Chromium.

## License

[Apache License, Version 2.0](LICENSE). Optional Inter font assets retain their own license in `dist/fonts/LICENSE`.
