# Examples

Run `pnpm dev` in the repository and open the paths below. Examples use synthetic snapshots and the public library APIs. Start with the headless report; the other pages exercise specific rendering, component or host behaviors.

| Path                               | Demonstrates                                                         |
| ---------------------------------- | -------------------------------------------------------------------- |
| `/examples/report.html`            | Scalars, axis charts, traces and profiles with optional exploration  |
| `/examples/headless.html`          | Minimal views on light/dark surfaces                                 |
| `/`                                | Metric components, legends, readings and raw data                    |
| `/examples/families.html`          | Trace/profile components, viewport navigation and large/deep inputs  |
| `/examples/infra.html`             | Buckets, units, controlled ranges, compact charts and custom runtime |
| `/examples/embedding.html`         | Narrow, transformed, scrolling, modal and sandboxed iframe hosts     |
| `/examples/linked-analysis.html`   | Saved views, snapshot updates and explicit chart coordination        |
| `/examples/interaction.html`       | Hover and selection states across families                           |
| `/examples/metric-inspection.html` | Grouped/stacked time series, column readings and locking             |
| `/examples/mark-inspection.html`   | Inspection across metric layouts, labels and partial buckets         |
| `/examples/color-system.html`      | Categorical/status roles and light/dark paint                        |
| `/examples/visual-system.html`     | Shared typography, exact readings and source colors                  |
| `/examples/dashboards.html`        | Larger host layouts, date controls and CSV exports                   |

Run `pnpm build` before opening the embedding example: its iframe uses the built standalone runtime and inline fonts. The example owns its height/theme message bridge.

Most pages have a TypeScript entry beside the HTML. `demo.ts` drives the root gallery and `requests.json` is a reusable metric document. Generated screenshots and exports belong in `test-results/` or `.local/`.

For integration code and schema descriptions, use the [documentation index](../docs/README.md).
