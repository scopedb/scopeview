# Design tokens

ScopeView shares one token source across metric charts, traces, profiles and HTML values. Use public CSS variables for host customization.

## Consume tokens

```ts
import { SCOPEVIEW_DESIGN_TOKENS, CHART_TOKENS } from '@scopedb/scopeview/tokens';

const reading = SCOPEVIEW_DESIGN_TOKENS.component.tooltip.fontSize;
const labelSize = CHART_TOKENS.labelSize;
console.log(reading.css, labelSize);
```

`SCOPEVIEW_DESIGN_TOKENS` contains the typed catalog. `CHART_TOKENS` contains resolved numeric constants. The authoring JSON is available at `@scopedb/scopeview/tokens.json`. These entries are DOM-free; importing metadata does not register elements.

A leaf's `css` field names a public custom property. A `runtime` field generates a numeric constant and does not imply a CSS override. Foundation tokens have neither. The catalog is a read-only description, not a runtime theme setter. See [styling](styling.md) for host use.

## Shared roles

| Role                        | Public names or catalog group                                 |
| --------------------------- | ------------------------------------------------------------- |
| Categorical identity        | `--color-chart-series-1` through `-10`, with `-line` variants |
| Status/severity             | `--color-chart-semantic-ROLE`, with `-line` variants          |
| Surfaces and text           | `semantic.surface`, `semantic.text`, `semantic.border`        |
| Rulers                      | `component.axis`                                              |
| Hover, selection and ranges | `component.inspection`                                        |
| Compact readings            | `component.tooltip`                                           |
| Headless density            | `component.report`                                            |
| Entity labels and contours  | `component.hierarchy`                                         |

Categorical slots represent identity, not a numeric gradient. Status colors have fixed meanings. Action/focus color remains separate from neutral selection. CSS uses native `light-dark()` against the view's selected scheme.

The exported catalog contains the complete palette. To change the library defaults, follow [token maintenance](../development/design-tokens.md).
