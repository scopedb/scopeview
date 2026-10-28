# Design baseline

**Baseline v1** defines ScopeView's accepted geometry, paint and interaction behavior. This page consolidates the current rules; its revision is independent of package/document versions. Refactoring or documentation work does not change those rules.

The library favors exact readings, stable source colors, quiet structure and compact inspection. Shared defaults come from the [token catalog](../docs/design-tokens.md). Host overrides are explicit and do not redefine the baseline. A host `theme.fontSize` deliberately scales the text hierarchy from the 13px base, including Canvas measurement and label fitting. Default sizes below apply at the 13px base; source geometry and state paint are preserved. Host categorical palettes do not override semantic status roles or explicit document colors.

## Geometry and sources

- Line and area connect supplied samples with straight segments. Bucket samples sit at interval centers. Explicit NULL/missing runs remain gaps. Preserve stack/baseline policy; styling never adds steps, smoothing or extrapolation.
- Values in readings come from the supplied source, not interpolated coordinates or cumulative stack heights. Keep zero, NULL and absent observations distinct.
- Trace intervals retain timestamps, parentage and durations. Profiles retain source order and self/inclusive weights. Zero-width sources remain reachable without invented area.
- Label fitting, viewport culling and pixel alignment never change source identity or event ownership. Exact values remain available when marks or labels are too small.
- Align rectangle fills and straight rules at native DPR while keeping continuous path and hit geometry. Quiet axes, grids and baselines stay beneath the data.

## Default headless view

The default surface contains marks, sparse rulers, essential labels and transient readings. Titles, toolbars, legends, tables, summaries and fixed details belong to the host. Click reads a value. Persistent selection and hierarchy navigation require `/interactions`.

- Scalars use intrinsic HTML with shared quantity typography and no Canvas runtime. Their surface follows the host theme, including dark mode, so quantities stay readable on mixed-mode pages.
- Plots default to 240px. Numeric/time rulers keep at most three references without grid or tick strokes. Keep the bar baseline, units, date/timezone context and scatter titles.
- Small single-series category bars may use direct values and omit the value ruler only when every reading fits. Crowding retains a sparse ruler. `axes: 'full' | 'none'` is explicit.
- Trace/profile reports fit all depths. Preserve interval proportions and parentage while adapting row height. Disabling optional navigation clears selection and restores that fit.

Complete components default to full rulers and navigation controls. Explicit `configure({ axes: 'minimal' })` uses the shared sparse ruler rules, retaining unit/date context and report label fitting. All surfaces share source semantics, tokens and the painter.

Exported HTML acts as a document host around this headless view. It shows authored titles, descriptions and applicable series legends by default. Export options `caption: false` and `legend: false` (CLI `--no-caption` and `--no-legend`) control those disclosures. This host disclosure does not change plot geometry or readings. Captions use the plot's surface and text roles so differently themed fragments remain readable together.

## Color and state

Ten categorical families have paired fill/line and light/dark values. Status/severity colors keep fixed meanings, including during error/warning inspection. Preserve identity under visibility and inspection changes for the chosen strategy. Hover keeps source hues; persistent selection uses neutral paint.

Brand blue identifies actions, keyboard focus and controlled ranges. Hover, pin/selection, reading lock, keyboard focus and range are independent states. Another source remains hoverable while a source is pinned. Leaving hover restores base paint and keeps persistent state. Local hover/pin takes precedence over passive linked highlights.

Ordinary line/area comparison retains 35% of competing paint; scatter retains 65%. The library's shared values govern those ratios. Light is the default; dark uses paired readable host roles and system mode follows the OS preference. Do not infer theme from background color.

## Typography and readings

| Role                                              | Accepted default                                     |
| ------------------------------------------------- | ---------------------------------------------------- |
| Body/title                                        | 13px / 14px                                          |
| Controls, numeric legends and tooltip             | 12px                                                 |
| Axis and ordinary metric labels                   | 11px                                                 |
| Tooltip context/hints                             | 10px                                                 |
| Fitted treemap labels                             | 11–18px                                              |
| Trace/profile labels                              | 12px, 8px horizontal and at least 2px vertical inset |
| Tooltip line height / row padding                 | 1.4 / 3px vertically                                 |
| Control / inspector radius                        | 4px / 6px                                            |
| Temporal line/area hover width                    | 128–320px                                            |
| Other metric and selected/locked/partial readings | 176–320px                                            |
| Entity hover width                                | 260px, bounded by the viewport                       |
| Pinned entity details                             | Component width, scrollable to 300px maximum height  |

Use Inter/system sans, shared aligned reading rows, tabular numbers, monospace exact details, slim series keys and complete source labels. Hover follows the pointer, flipping/clamping at viewport edges; keyboard readings use target anchors. Pinned entity details occupy normal flow below controls, keeping axes, neighboring charts and toolbars available.

Temporal hover uses a compact time heading. Full timestamp/date/zone context remains accessible in the heading title and expanded selected/locked/partial reading. Do not replace exact source values with rounded visual coordinates.

Entity labels use soft dark/light ink when it reaches 4.5:1 contrast, with a readable black/white fallback. Truncation keeps four graphemes before an ellipsis, while complete short names remain visible. A narrower named interval shows a centered `…` if it fits with 4px inset per side; smaller or vertically compacted marks defer text to inspection.

## Family treatments

| Family                | Hover and persistent state                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bar                   | Whole-column reading band; source-colored lightness step for the hit segment. Preserve seams and height. Zero gets a reading without invented height. Multiple compatible segments can show an exact Total; a single quantity has no duplicate total. Selection uses a neutral band/rail and gutter cue.                 |
| Line                  | Quiet 2px round-ended strokes. Continuous series have no resting dots; isolated/category-colored samples use 2px dots. Neutral time guide plus source-colored inspection point. Selection retains the source stroke.                                                                                                     |
| Area                  | Straight boundaries over quiet fills: 1px inner stack strokes, 2px final layer or overlap stroke. Opacity is 0.48 for stacks and 0.12 for overlap. Inspect individual source quantities, including coincident boundaries.                                                                                                |
| Donut                 | Outer expansion capped at 4px/4% of radius; preserve hole, center and seams. Persistent selection uses a neutral 1px contour.                                                                                                                                                                                            |
| Treemap               | Hue-preserving 0.04 Oklab lightness step; labels above emphasis. Neutral 2px selection contour.                                                                                                                                                                                                                          |
| Scatter               | Opaque source-colored resting points with a 1.5px surface separator; no translucent halo. Source-colored hover point/ring; encoded size and hit geometry stay stable. Neutral persistent ring. Overlapping-source disclosure keeps each original reading in an in-flow chooser below controls and pages at four choices. |
| Ranked/horizontal bar | Quiet hover row band, neutral selected rail, supplied ordering and exact zero/NULL rows.                                                                                                                                                                                                                                 |
| Value                 | Original quantities in HTML; no invented plot targets.                                                                                                                                                                                                                                                                   |
| Trace/profile         | Two-tone source interval contour that preserves label ink and fill. Tiny intervals use a gutter cue. Neutral pinned contour/badge and unclipped time guides; another interval remains hoverable.                                                                                                                         |

Line/area inspection radii are 2.5px or 3px for the active series, with a 1px source stroke. Filled-shape seams use 1.5px. Labels and numeric legend summaries remain optional; avoid duplicating the same primary quantity across several resting surfaces. Donut share is read against the visible total, as on treemap; outer donut labels show name/count. Incomplete intervals require an explicit host watermark and remain separate from selection.

## Component controls

A host toolbar uses `slot="toolbar"` and the component's control snapshots/actions. It stays inside the interaction boundary; updating controls must not reset the document, pin or focus. Disclosure options may hide headers, readings, summaries, tables and controls while retaining source emphasis and events. Entity pinned details have an independent `inspector` switch.

`configure()` keeps compatible state. Disabling chart input also disables inspection, viewport and collapse actions. Filtering toolbar buttons retains keyboard access and a visible focus target. Outside pointer/focus dismissal is the default; a host can explicitly opt out with `dismissOnOutside: false` while retaining in-chart dismissal.

## Review changes

Use the production examples: `report.html`, `headless.html`, `mark-inspection.html`, `color-system.html`, `interaction.html`, `linked-analysis.html` and `embedding.html`. Review light/dark at desktop and 320–390px widths, including default, hover, selection plus another hover, and dismissal. Include native DPR, exact readings and neighboring plots.

Run `pnpm verify` for the token checks, build, unit tests and Chromium regressions. Tests cover geometry, state, paint, readings and embeds. Screenshots are review evidence, not replacement expectations. An intentional design revision must name the changed rule and reason, update tokens/documentation/regressions together, and show the affected examples. Never refresh expectations solely to make a failing check pass.
