import {
  defineTheme,
  themeMode,
  themeProperties,
  type ChartTheme,
  type ThemeMode
} from '../theme/config.js';
import { node } from '../ui/dom.js';

/** Replay own properties assigned before custom-element registration, in setter order. */
export function upgradeProperties<T extends HTMLElement>(
  host: T,
  properties: readonly (keyof T)[]
) {
  for (const property of properties) {
    if (!Object.hasOwn(host, property)) continue;
    const value = host[property];
    delete host[property];
    host[property] = value;
  }
}
/** Only embedded document changes should reparse JSON; slotted host UI is independent. */
export function documentMutated(records: MutationRecord[]): boolean {
  const selector = 'script[type="application/json"]';
  return records.some((record) => {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    if (target?.closest(selector)) return true;
    return [...record.addedNodes, ...record.removedNodes].some(
      (node) => node instanceof Element && (node.matches(selector) || node.querySelector(selector))
    );
  });
}

/** Built-in host theme. `system` follows the operating system preference. */
export type ScopeTheme = ChartTheme;
/** Unknown or absent values keep the light default. */
export function themeAttribute(host: HTMLElement): ThemeMode {
  const value = host.getAttribute('theme');
  return value === 'dark' || value === 'system' ? value : 'light';
}

/** One owned stylesheet applies a theme atomically without rewriting host inline styles. */
export class ElementTheme {
  #value: ChartTheme = 'light';
  #style = node('style');
  constructor(private host: HTMLElement) {}
  get value(): ChartTheme {
    const mode = themeAttribute(this.host);
    return typeof this.#value === 'string' ? mode : { ...this.#value, mode };
  }
  set value(value: ChartTheme) {
    const next = defineTheme(value);
    // Important shadow declarations outrank inherited and inline host role overrides.
    this.#style.textContent = `:host{${Object.entries(themeProperties(next))
      .map(([key, value]) => `${key}:${value}!important`)
      .join(';')}}`;
    this.host.shadowRoot!.append(this.#style);
    this.#value = next;
    this.host.setAttribute('theme', themeMode(next));
  }
}
/** Canvas ink is resolved at paint time, so repaint when the system scheme changes. */
export function watchColorScheme(repaint: () => void, signal: AbortSignal) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint, { signal });
}
