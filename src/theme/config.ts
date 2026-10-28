import { object, choice, fail } from '../data/validation.js';
import { bodySize } from './visual-tokens.js';

export type ThemeMode = 'light' | 'dark' | 'system';
export interface ThemeConfig {
  readonly mode?: ThemeMode;
  readonly fontFamily?: string;
  /** Base size in CSS pixels, 8–32; the default is 13. */
  readonly fontSize?: number;
  /** One to ten categorical colors. Short palettes repeat across the ten slots. */
  readonly palette?: readonly string[];
  readonly colors?: {
    readonly surface?: string;
    readonly text?: string;
    readonly mutedText?: string;
  };
}
export type ChartTheme = ThemeMode | ThemeConfig;

const fontFamilies =
  /^\s*(?:(?:"[^"\\\r\n\0]+"|'[^'\\\r\n\0]+'|[-_\p{L}][-_\p{L}\p{N} ]*)\s*(?:,\s*(?!$)|$))+$/u;

const modes = ['light', 'dark', 'system'] as const;
const roles = {
  surface: '--color-surface',
  text: '--color-text-primary',
  mutedText: '--color-text-secondary'
} as const;
function color(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value))
    fail(path, 'Expected #rgb or #rrggbb.');
  return value;
}
const rules: Record<keyof ThemeConfig, (value: unknown, path: string) => unknown> = {
  mode: (value, path) => choice(value, modes, path),
  fontFamily(value, path) {
    if (typeof value !== 'string' || value.length > 256 || !fontFamilies.test(value))
      fail(path, 'Expected font families (1–256 chars).');
    return value;
  },
  fontSize(value, path) {
    if (typeof value !== 'number' || !(value >= 8 && value <= 32))
      fail(path, 'Expected a number (8–32).');
    return value;
  },
  palette(value, path) {
    if (!Array.isArray(value) || !value.length || value.length > 10)
      fail(path, 'Expected 1–10 colors.');
    return Object.freeze([...value].map((value, i) => color(value, `${path}[${i}]`)));
  },
  colors(value, path) {
    const colors = object(value, path, Object.keys(roles));
    for (const [key, value] of Object.entries(colors))
      if (value !== undefined) color(value, `${path}.${key}`);
    return Object.freeze({ ...colors });
  }
};
/** Validate and snapshot a host theme. No DOM, downloads or document mutation. */
export function defineTheme(value: ChartTheme, path = 'theme'): ChartTheme {
  if (typeof value === 'string') return choice(value, modes, path);
  const input = object(value, path, Object.keys(rules));
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(input) as (keyof ThemeConfig)[])
    if (input[key] !== undefined) result[key] = rules[key](input[key], `${path}.${key}`);
  return Object.freeze(result) as ThemeConfig;
}

export const themeMode = (theme: ChartTheme): ThemeMode =>
  typeof theme === 'string' ? theme : (theme.mode ?? 'light');

/** Only validated theme fields become CSS; semantic status paints stay independent. */
export function themeProperties(theme: ChartTheme): Record<string, string> {
  if (typeof theme === 'string') return {};
  const values: Record<string, string> = {};
  if (theme.fontFamily !== undefined) values['--font-sans'] = theme.fontFamily;
  if (theme.fontSize !== undefined)
    values['--scope-chart-font-scale'] = String(theme.fontSize / bodySize);
  if (theme.palette)
    for (let i = 0; i < 10; i++) {
      const color = theme.palette[i % theme.palette.length];
      values[`--color-chart-series-${i + 1}`] = values[`--color-chart-series-${i + 1}-line`] =
        color;
    }
  for (const key of Object.keys(roles) as (keyof typeof roles)[])
    if (theme.colors?.[key] !== undefined) values[roles[key]] = theme.colors[key];
  return values;
}
