# Bundle checks

Run `pnpm build` followed by `pnpm test:bundle`. Tests bundle consumers through the package's public exports, keeping the exports they use reachable. Sizes include all emitted JavaScript and CSS, compressed with gzip; imported chunks are not measured as empty entry stubs.

The tests verify that the root API runs without browser globals, unused imports disappear, scalar imports avoid chart rendering, Web Components register only through the explicit registration entry, and font imports retain their CSS and files. Fixed metric entries are measured independently. The optional report loader remains lazy.

| Consumer                          | Maximum gzip |
| --------------------------------- | -----------: |
| Scalar                            | 4 KiB        |
| Axis charts                       | 31 KiB       |
| Scatter, donut, top-list, treemap | 29 KiB each  |
| All metrics                       | 35 KiB       |
| Trace                             | 22 KiB       |
| Profile                           | 21 KiB       |
| All-family standalone             | 41 KiB       |
| Initial report loader             | 2 KiB        |

These limits exclude caller data and optional fonts. Font retention is checked separately. Platform archives also include a Node executable, so browser budgets do not describe their download sizes.

The +1 to +2 KiB headroom for the Canvas-backed metric, trace, profile, and standalone entries supports cached scatter and hovered-point rendering, zero-allocation viewport transforms, CSS Color 4 (`color(srgb ...)`) contrast and emphasis resolution, dark-mode tooltip elevation, and shared keyboard/viewport orchestration while leaving `Scalar` (4 KiB) and `Initial report loader` (2 KiB) unchanged.

The checks work in a shallow clone or a source archive without requiring Git history. Change a limit only when the added capability justifies the download cost.
