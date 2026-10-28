# Maintaining design tokens

ScopeView generates shared CSS and TypeScript defaults from one authoring catalog. For the public token API and host customization, see [design tokens](../docs/design-tokens.md) and [styling](../docs/styling.md).

## Source structure

Edit [`src/theme/design-tokens.json`](../src/theme/design-tokens.json). Its version 1 format uses nested groups, typed leaf values and `{path.to.token}` aliases.

| Layer        | Responsibility                                                     |
| ------------ | ------------------------------------------------------------------ |
| `foundation` | Raw palettes, fonts, sizes, spacing, radii, strokes and durations  |
| `semantic`   | Shared text/surface/border, categorical series and status meanings |
| `component`  | Reading density, rulers, controls and family paint parameters      |

Aliases may refer within a layer or toward a more foundational one. Foundation references are resolved into generated values. Public semantic aliases remain live CSS references, so overriding a role can also affect roles that intentionally alias it.

Colors have paired light/dark values. Dimensions use CSS pixels; durations use milliseconds; ratios and opacity are unitless. The generator rejects missing references, cycles, type mismatches, invalid units and duplicate CSS/runtime output names.

## Generate and verify

```sh
pnpm tokens:generate
pnpm check
```

Generation writes `src/theme/tokens.css`, `headless-tokens.css`, `metric-tokens.css`, `scalar-tokens.css` and `src/theme/visual-tokens.ts`. The smaller sheets retain referenced token roles and their dependencies, including every categorical slot; defaults are identical. `scale: true` marks text dimensions that follow the host font scale. Internal named constants let consumers retain only the defaults they use; the public `CHART_TOKENS` catalog is unchanged. Never edit those outputs directly. `pnpm check` and builds reject stale generated files.

Review changes in light/dark and narrow hosts, including a persistent selection while hovering another source. Font and density changes affect both measurement and drawing; update their shared source together. Run the design regressions and document any intentional baseline revision. Preserve source geometry, gaps, identities and interaction ownership.

The [design baseline](design-baseline.md) defines the rendering behavior to preserve.
