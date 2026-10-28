# Bundle checks

Run `pnpm build` followed by `pnpm test:bundle`. Tests bundle consumers through the package's public exports, keeping the exports they use reachable. Sizes include all emitted JavaScript and CSS, compressed with gzip; imported chunks are not measured as empty entry stubs.

The tests verify that the root API runs without browser globals, unused imports disappear, scalar imports avoid chart rendering, Web Components register only through the explicit registration entry, and font imports retain their CSS and files. Fixed metric entries are measured independently. The optional report loader remains lazy.

| Consumer                          | Maximum gzip |
| --------------------------------- | -----------: |
| Scalar                            | 4 KiB        |
| Axis charts                       | 29 KiB       |
| Scatter, donut, top-list, treemap | 27 KiB each  |
| All metrics                       | 33 KiB       |
| Trace                             | 21 KiB       |
| Profile                           | 20 KiB       |
| All-family standalone             | 39 KiB       |
| Initial report loader             | 2 KiB        |

These limits exclude caller data and optional fonts. Font retention is checked separately. Platform archives also include a Node executable, so browser budgets do not describe their download sizes.

The checks work in a shallow clone or a source archive without requiring Git history. Change a limit only when the added capability justifies the download cost.
