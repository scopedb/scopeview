# Contributing to ScopeView

Use Node.js 24+ and the pnpm version in `package.json`. Install dependencies with `pnpm install --frozen-lockfile` and Chromium with `pnpm exec playwright install chromium`.

## Design and architecture

Read [module ownership](development/architecture.md) before changing architecture and the [design baseline](development/design-baseline.md) before changing rendering or interaction. Shared defaults are maintained through [design tokens](development/design-tokens.md).

## Everyday commands

Run `pnpm verify` before submitting a change. It checks formatting and types, runs unit tests, builds the package, and then tests the built Node API, consumer bundles, browser behavior and installed npm package. Run `pnpm docs:build` when changing documentation.

| Command                             | Purpose                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Browse the example gallery locally                                                       |
| `pnpm build`                        | Build public ESM entries, TypeScript declarations, the standalone script and font assets |
| `pnpm check`                        | Check generated design tokens and library, example, test and documentation types         |
| `pnpm format` / `pnpm lint`         | Apply or check Biome formatting and lint rules                                           |
| `pnpm test`                         | Test data validation, exact values, layout and state transitions                         |
| `pnpm test:node`                    | Test the built compiler, HTML exporter and CLI contracts                                 |
| `pnpm test:bundle`                  | Test real consumers, explicit registration, tree shaking and fixed gzip limits           |
| `pnpm test:browser`                 | Test actual Canvas/HTML, keyboard and pointer input, loading and disposal in Chromium    |
| `pnpm test:package`                 | Install the actual npm tarball offline and inspect relocated exported HTML               |
| `pnpm docs:dev` / `pnpm docs:build` | Develop or build the documentation site                                                  |
| `pnpm tokens:generate`              | Regenerate theme files; `pnpm check` verifies them                                       |
| `pnpm build:cli`                    | Build a platform archive carrying the package and its own Node runtime                   |
| `pnpm test:cli --directory <dir>`   | Check the relocated platform archive                                                     |

The `prepack` lifecycle runs the build for ordinary `pnpm pack`. Acceptance tests use `npm pack --ignore-scripts` after an explicit build so the tested bytes are the bytes retained for publication. Run `pnpm build` before any narrow Node, bundle, browser or package check.

## Tests and their boundaries

Unit tests cover exact integers/timestamps, NULL versus zero, invalid documents, chart geometry, hierarchy and state reconciliation. Node tests exercise real files and streams: validation errors, safe HTML escaping, output receipts, overwrite protection, concurrent publication and broken pipes. These tests do not need database credentials or network access.

Browser tests check painted output and actual interaction rather than screenshots alone. They cover source readings, themes, narrow layouts, high-DPI rendering, async updates, keyboard navigation and cleanup. Chromium runs in the background; CI uses one worker and retains traces on failure.

Package acceptance installs the tarball into a temporary consumer with an isolated offline npm cache. It checks public imports and declarations, CLI resources and exports, then opens copied HTML with network requests blocked. A source-checkout test cannot establish these installation guarantees.

Native archive acceptance checks the launcher and bundled runtime on the target operating system, including relocation into a directory with spaces and failure when the bundled runtime is missing. Browser behavior belongs to the package/browser suites; platform packaging does not need another independent renderer test suite.

Keep tests for observable failure modes. Avoid repeating fixtures merely to exercise another command alias. See [bundle checks](development/bundle-size.md) for the consumer size limits.

## Build and distribution scripts

| File                       | Why it exists                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `scripts/build.mjs`        | Derives public entries from package exports, runs the ESM and standalone builds, and copies fonts, tokens and licenses |
| `scripts/tokens.mjs`       | Generates shared CSS and TypeScript defaults from one design-token document                                            |
| `scripts/distribution.mjs` | Verifies a pinned official Node archive and packages it with the accepted npm tarball and launcher                     |
| `tests/package/run.mjs`    | Runs installed-package acceptance and optionally retains the accepted tarball/checksum                                 |
| `tests/distribution.mjs`   | Exercises the actual platform archive and its launcher                                                                 |

Builds and tests run from the current checkout without requiring earlier Git history.

## Local artifacts

Build an npm package with `pnpm pack`. To try it in another application, install that local `.tgz` with `pnpm add /absolute/path/to/package.tgz`.

For a platform archive, use `pnpm build:cli`, or pass an accepted tarball with `node scripts/distribution.mjs --package <tarball> --output <directory>`. The archive includes `app/`, `runtime/`, `licenses/` and `bin/`; keep the complete directory together. The runtime version and official checksums live in `.node-version` and `scripts/distribution/node-shasums.txt`. Updating them requires native acceptance on every supported target.

Generated packages and test evidence live under `.local/`; installed test consumers use temporary directories. None of these commands publishes to npm or creates a GitHub Release.

## Continuous integration

`ci.yml` runs one Ubuntu job on pull requests, main pushes and manual requests. It runs `pnpm verify` and the documentation build, then retains the tested npm tarball and checksum for seven days. Failure artifacts contain browser traces and package diagnostics. The same workflow can be called by release verification.

The [release guide](RELEASE.md) describes npm trusted publishing, the first-publication bootstrap and native artifacts. Native packaging runs for releases and packaging-related PRs, not every source change.
