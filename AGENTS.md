# ScopeView contributor instructions

ScopeView is an independent Canvas chart library for metric charts, trace timelines and profile flame graphs.

## Architecture

Follow [module ownership](development/architecture.md). Shared DOM and reading primitives belong in `src/ui/`; headless views must not depend on component shells in `src/elements/`. Keep root/model imports DOM-free, scalar HTML-only and registration explicit.

## Markdown

- Keep each prose paragraph and each list item's prose on one source line in all Markdown files. Do not insert hard line breaks merely to satisfy a line-width limit.
- Format Markdown tables with aligned columns and consistent delimiter rows.
- Preserve meaningful paragraph boundaries, explicit line breaks, nested lists, code blocks, and other syntax that requires newlines. Keep links to files in this repository relative.

## Pull requests

Use `<type>[optional scope]: <description>` for every new or renamed PR title, for example `docs: clarify CLI installation` or `fix(cli): preserve input files`. Allowed types are defined in [.github/semantic.yml](.github/semantic.yml): `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore` and `revert`. Semantic PR checks the title only; valid commit messages do not compensate for an invalid PR title. Use the same convention for commit messages.

## Changelog

- Update [CHANGELOG.md](CHANGELOG.md) in the same pull request for significant user-visible changes. Compare the final behavior with the latest release tag rather than recording the sequence of commits that produced it.
- Include public API migrations, new capabilities, correctness or compatibility changes, and meaningful performance improvements. Exclude tests, internal refactors, documentation, CI, tooling, and dependency maintenance unless they change supported or observable behavior.
- Keep the permanent `## Unreleased` section at the top. Group entries under `### Breaking changes`, `### New features`, `### Improvements`, and `### Bug fixes` in that order, and include only categories that contain entries.
- Write one bullet for each coherent behavior. Combine related commits, describe the observable impact, and give the required migration for breaking changes. Do not include pull request numbers, issue numbers, discarded intermediate APIs, or implementation history.
- Write from the user's perspective: name the affected public API, element, CLI command, or workload and its observable result. Omit implementation mechanics unless users need them to migrate, understand compatibility, or assess risk.
- Scope performance claims to the workload supported by evidence. Distinguish broad improvements from scenario-specific benchmark results, and do not generalize a microbenchmark into a library-wide claim.
- During release preparation, move the accumulated entries from `## Unreleased` into `## vX.Y.Z (YYYY-MM-DD)` immediately below `## Unreleased`, using the actual UTC release date; keep `## Unreleased` in place for subsequent changes.

## Build and package boundaries

Keep the root API usable without browser globals, scalar imports free of Canvas, and Web Component registration explicit. `pnpm test:bundle` checks real bundled consumers and fixed gzip limits without depending on Git history. Do not increase a limit simply to make a failure pass; explain the user-facing benefit of added bytes.

## Design stability

Read [the accepted design baseline](development/design-baseline.md) before changing chart appearance, geometry, typography or interaction. Baseline v1 records the current design; use the existing tokens, painter and shared inspector to implement it.

- A request to polish styling, clean code or improve sharpness keeps sample connections, stacking, color meanings and state behavior unchanged. Line and area connect supplied samples with straight segments; retain explicit gaps. Do not silently add steps or curves.
- Preserve source hues during hover and neutral persistent selection. Keep hover available while another source is selected/pinned, and keep labels and exact readings intact.
- Keep the compact 12px tooltip and shared reading rhythm. Metric, trace and profile hover readings follow the pointer; pinned entity details remain outside the plot.
- Author shared values in `src/theme/design-tokens.json`, then run `pnpm tokens:generate`. Do not edit generated files or repair library styles with example-only overrides.
- User instructions take precedence. For an intentional design change, state which baseline rule changes and why, update its documentation and regression expectations together, and show the affected examples. Routine fixes can restore the baseline directly.

Run `pnpm lint`, `pnpm check` and the relevant tests. `pnpm verify` builds the library and runs the unit, Node and Chromium suites; Chromium runs in the background. CI uses the same command. Run `git diff --check` and review intended changes before handoff. Do not refresh design expectations simply to make a failing check pass.
