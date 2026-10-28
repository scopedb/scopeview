---
description: Set chart size, light and dark themes, fonts, reading styles and source colors.
---

# Styling

Charts include their own default styles. Set CSS custom properties on the element passed to a factory, then refresh the view after changing inherited values.

## Size

```css
.chart-host {
  width: 100%;
  min-width: 0;
  --scope-chart-height: 280px;
}
```

Plots follow the measured width and device pixel ratio. Headless height defaults to `--scope-report-height: 240px`; `--scope-chart-height` overrides it per host. Scalars size to their HTML content. A host must have a visible width before it can draw usefully.

## Themes

```ts
import { createChart } from '@scopedb/scopeview/chart/axis';
import { requests } from './chart.js';

const host = document.querySelector<HTMLElement>('#chart')!;
const chart = createChart(host, requests, { theme: 'system' });
chart.theme = 'dark';
```

Use a mode shortcut or a small, strictly validated theme object:

```ts
import type { ThemeConfig } from '@scopedb/scopeview/theme';

const theme: ThemeConfig = {
  mode: 'light',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 14,
  palette: ['#418be6', '#209c8c', '#9a75ce'],
  colors: { surface: '#ffffff', text: '#18212b', mutedText: '#68758a' }
};
chart.theme = theme;
```

Every field is optional. `{}` uses the default light appearance. Setting `theme` replaces the previous theme; it does not merge. The view owns a snapshot. Invalid input throws with its exact path and leaves the current theme and chart intact. Theme changes preserve data, selection and viewport. Use the same object as `createChart(host, document, { theme })`, `createReport(host, document, { theme })`, `element.theme = theme`, or `createEmbed(document, { theme })`. Keep it outside `chart.json`.

| Field              | Contract                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `mode`             | `light` (default), `dark`, or `system`; system follows the OS preference                    |
| `fontFamily`       | A CSS family list, 1–256 characters; local families and fallbacks, no URLs or CSS variables |
| `fontSize`         | Base size in CSS pixels, 8–32; default 13. All text roles scale proportionally              |
| `palette`          | 1–10 opaque hex colors (`#rgb` or `#rrggbb`), repeated across the ten categorical slots     |
| `colors.surface`   | Plot/reading surface                                                                        |
| `colors.text`      | Primary text                                                                                |
| `colors.mutedText` | Secondary text                                                                              |

Canvas measurement, fitting, axis labels, treemap and hierarchy labels use the same size and family as paint. DOM readings preserve their hierarchy: at base 13, axes are 11px, tooltips 12px and titles 14px. Font completion triggers measurement and paint again. Large text may reduce visible labels; inspection retains complete source values. Font files are supplied by the host; themes do not download them. Monospace exact details keep the library's monospace family.

Palette changes preserve identity under filtering/inspection and leave semantic info/success/warning/error colors intact. Hex values in `document.options.colors` stay fixed; explicit palette-token references follow the chosen palette. Custom colors are literal values in every mode; the host can switch theme objects for paired brand palettes. Line widths, hit areas, hover opacity and internal spacing stay library-owned.

CSS remains an adapter to a host design system. Paired colors use native `light-dark()`:

```css
.chart-host {
  --color-surface: light-dark(#ffffff, #161b22);
  --color-text-primary: light-dark(#18212b, #eef2f6);
  --font-sans: system-ui, sans-serif;
}
```

After changing host classes or inherited tokens, call `chart.refresh()`. Headless views copy the public token values from the host into their owned child. Resizing and font completion are observed by the rendering runtime.

Explicit theme fields take precedence over inherited host roles. For a custom DOM host, `resolveTheme(theme)` from `@scopedb/scopeview/theme` returns validated `{ mode, properties }`; apply those properties with `style.setProperty`. It has no DOM dependency. CSS itself accepts arbitrary custom property names; strict unknown-key checks belong to the theme API.

## Fonts and readings

System fallbacks work without a font download. To use the optional bundled Inter faces, import this once in your application:

```ts
import '@scopedb/scopeview/fonts.css';
```

The bundled faces are Inter's Latin subset at weights 400 and 600. HTML exports embed these same faces with `--fonts` or `createEmbed(document, { fonts: true })`. Chinese and other CJK characters use available fallback fonts on the viewer's device. A report can work offline while its CJK appearance varies between machines. `theme.fontFamily` only selects a family list; it does not load font files or embed additional fonts in an export. Hosts that need consistent CJK rendering must supply and load suitable fonts themselves.

| Property                                   | Purpose                             |
| ------------------------------------------ | ----------------------------------- |
| `--font-sans`                              | Text family                         |
| `--scope-chart-tooltip-font-size`          | Reading text, 12px by default       |
| `--scope-chart-tooltip-line-height`        | Reading line height, 1.4 by default |
| `--scope-chart-tooltip-width`              | Explicit floating-reading width     |
| `--scope-chart-font-size-metric`           | HTML scalar quantity size           |
| `--color-chart-axis`, `--color-chart-grid` | Neutral plot structure              |

Tooltips remain bounded by their host/viewport rules. Canvas labels and measurements follow the shared font scale; a CSS setting does not replace source geometry or layout algorithms. See the [token catalog](design-tokens.md) for authoring and runtime token distinctions.

## Data colors

Override categorical slots with `--color-chart-series-1` through `-10` and their `-line` variants. A fill and thin line may need different contrast while retaining the same hue. Metric documents can instead specify colors by stable series or category name:

```ts
import type { ChartOptions } from '@scopedb/scopeview';

const options: ChartOptions = {
  colors: { api: '#418be6', worker: '#338d82' }
};
```

Assign those options to the document and update the chart. JSON color values accept hex colors and supported palette tokens. Hover preserves source hues; persistent selection is neutral. Trace colors derive from service/name with an error-role override. Profile colors derive from full frame names. Color indicates identity, not duration or weight.

## Optional Web Components

Set the same variables directly on `scope-chart`, `scope-trace` or `scope-flame`, and use `theme="light|dark|system"` or the `theme` property. Components define local defaults. To use a particular ancestor token, explicitly inherit it:

```css
scope-chart {
  --color-surface: inherit;
  --font-sans: inherit;
  --scope-chart-height: 320px;
}
```

Component style/class and theme changes refresh automatically. Call `refresh()` after changing an ancestor's tokens. The [design baseline](../development/design-baseline.md) records shared appearance and interaction rules for library contributors.
