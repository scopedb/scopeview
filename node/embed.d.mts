export function serializeDocument(value: unknown): string;
export interface EmbedDiagnostic {
  severity: 'warning';
  code: string;
  path: string;
  message: string;
}
export function createEmbed(
  input: unknown,
  options?: {
    format?: 'html' | 'fragment';
    fonts?: boolean;
    /** Include the authored title and description; defaults to true. */
    caption?: boolean;
    legend?: boolean;
    tooltip?: boolean;
    theme?: ChartTheme;
    /** One BCP 47 language tag; canonicalized, defaults to en. Does not translate text. */
    lang?: string;
    /** Receive the same warnings as CLI render; HTML remains the return value. */
    onDiagnostic?: (diagnostic: EmbedDiagnostic) => void;
  }
): Promise<string>;
import type { ChartTheme } from '../dist/theme.js';
export type { ChartTheme, ThemeConfig, ThemeMode } from '../dist/theme.js';
