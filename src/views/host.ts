import { defineTheme, themeMode, themeProperties, type ChartTheme } from '../theme/config.js';
import { node } from '../ui/dom.js';
export type { ChartTheme, ThemeConfig, ThemeMode } from '../theme/config.js';
export interface ChartView {
  /** Invalid input throws before replacing the current view. */
  update(document: unknown): void;
  refresh(): void;
  theme: ChartTheme;
  dispose(): void;
}
/** Report updates may need to download a different metric layout. */
export interface ReportView extends ChartView {
  update(document: unknown): Promise<void>;
}

const tokenNamesCache = new Map<string, readonly string[]>();
function parseTokenNames(tokens: string): readonly string[] {
  let names = tokenNamesCache.get(tokens);
  if (!names) {
    names = [...new Set(tokens.match(/--[\w-]+(?=\s*:)/g) ?? [])];
    tokenNamesCache.set(tokens, names);
  }
  return names;
}

/** Shared token inheritance and owned DOM, without a Canvas or interaction dependency. */
export class ViewHost {
  readonly element = node('div', 'scopeview-view');
  readonly root = this.element.attachShadow({ mode: 'open' });
  readonly events = new AbortController();
  disposed = false;
  repaint = () => {};
  #theme: ChartTheme = 'light';
  #tokens: readonly string[];
  #overrides: Record<string, string> = {};

  constructor(
    private host: HTMLElement,
    styles: string,
    tokens: string,
    theme: ChartTheme = 'light'
  ) {
    this.root.append(node('style', '', tokens + styles));
    this.#tokens = parseTokenNames(tokens);
    this.theme = theme;
    host.append(this.element);
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => this.refresh(), { signal: this.events.signal });
  }
  get theme() {
    return this.#theme;
  }
  set theme(value: ChartTheme) {
    this.#theme = defineTheme(value);
    const mode = themeMode(this.#theme);
    this.element.style.colorScheme = mode === 'system' ? 'light dark' : mode;
    this.element.dataset.theme = mode;
    this.refresh();
  }
  refresh() {
    if (this.disposed) return;
    for (const name of Object.keys(this.#overrides)) this.element.style.removeProperty(name);
    const computed = getComputedStyle(this.host);
    const ownSize = typeof this.#theme !== 'string' && this.#theme.fontSize !== undefined;
    for (const name of this.#tokens) {
      const value = ownSize && name.includes('font-size') ? '' : computed.getPropertyValue(name);
      if (value) this.element.style.setProperty(name, value);
      else this.element.style.removeProperty(name);
    }
    // Explicit fields override copied host tokens. Replacing a theme restores inheritance.
    this.#overrides = themeProperties(this.#theme);
    for (const [name, value] of Object.entries(this.#overrides))
      this.element.style.setProperty(name, value);
    this.repaint();
  }
  assertActive() {
    if (this.disposed) throw new Error('This chart has been disposed.');
  }
  dispose() {
    this.disposed = true;
    this.events.abort();
    this.element.remove();
  }
}
