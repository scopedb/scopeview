/** DOM-free host theme authoring; chart documents stay independent of appearance. */
import { defineTheme, themeMode, themeProperties, type ChartTheme } from './theme/config.js';
/** Validate a theme and resolve its CSS adapter for a custom host. */
export function resolveTheme(value: ChartTheme) {
  const theme = defineTheme(value);
  return { mode: themeMode(theme), properties: Object.freeze(themeProperties(theme)) };
}
export type { ChartTheme, ThemeConfig, ThemeMode } from './theme/config.js';
