# ScopeView

A small Canvas chart library for metrics, traces and profiles, with a CLI for exporting offline HTML. ScopeView preserves exact source readings, shares a light/dark theme and has no runtime npm dependencies.

## Install the library

The package ships ESM and TypeScript declarations. In your web application:

```sh
npm install @scopedb/scopeview
# or: pnpm add @scopedb/scopeview
# or: bun add @scopedb/scopeview
```

## Export HTML with the CLI

Run the CLI without adding a project dependency. Choose your package manager; all three commands require Node.js 24+. For npm, `--yes` keeps installation prompts out of `chart.json`.

```sh
# npm
npx --yes @scopedb/scopeview example bar > chart.json
npx --yes @scopedb/scopeview render chart.json --output chart.html

# pnpm
pnpm dlx @scopedb/scopeview example bar > chart.json
pnpm dlx @scopedb/scopeview render chart.json --output chart.html

# Bun
bunx @scopedb/scopeview example bar > chart.json
bunx @scopedb/scopeview render chart.json --output chart.html
```

Open `chart.html` in a browser. It contains the data and renderer and works offline. If the package is already installed in your project, use `npx scopeview`, `pnpm exec scopeview` or `bunx scopeview`. Add `--help` to list commands.

For machines without Node.js or Bun, download a platform archive from [GitHub Releases](https://github.com/scopedb/scopeview/releases). Extract the complete directory and run `bin/scopeview` (`bin\scopeview.cmd` on Windows); the archive includes its own Node runtime.

## Draw a chart

Add a host to your HTML:

```html
<div id="chart" style="--scope-chart-height: 280px"></div>
```

Then add this to your application's browser entry:

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

See [getting started](docs/getting-started.md) for setup and [framework integration](docs/frameworks.md) for mounting and cleanup.

## Documentation

| Task                                  | Guide                                                              |
| ------------------------------------- | ------------------------------------------------------------------ |
| Choose chart types and interfaces     | [Overview](docs/overview.md)                                       |
| Prepare data and preserve precision   | [Data format](docs/data.md)                                        |
| Export HTML or use the CLI            | [CLI reference](docs/cli.md), [HTML export API](docs/embedding.md) |
| Update charts and handle interactions | [Headless API](docs/headless.md)                                   |
| Customize themes, fonts and colors    | [Styling](docs/styling.md)                                         |
| Try complete examples                 | [Gallery](docs/examples.md)                                        |

For development, see [Contributing](CONTRIBUTING.md). Release history and publication instructions are in [CHANGELOG.md](CHANGELOG.md) and [RELEASE.md](RELEASE.md).

## License

[Apache License, Version 2.0](LICENSE). Optional Inter font assets retain their own license in `dist/fonts/LICENSE`.
