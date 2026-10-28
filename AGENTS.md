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
