import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChartInteraction } from '../../../src/core/scene.js';
import { renderObservations } from '../../../src/ui/inspection-observations.js';
import { renderPreview } from '../../../src/ui/inspection-preview.js';

function readThemeFile(name: string) {
  return readFileSync(resolve(process.cwd(), 'src/theme', name), 'utf8');
}

function collectTokenLeaves(group: Record<string, unknown>, prefix = ''): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(group)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && 'value' in value) paths.push(path);
    else if (value && typeof value === 'object')
      paths.push(...collectTokenLeaves(value as Record<string, unknown>, path));
  }
  return paths;
}

class MockClassList {
  #set = new Set<string>();
  sync(className: string) {
    this.#set = new Set(className.split(/\s+/).filter(Boolean));
  }
  toggle(token: string, force?: boolean) {
    const add = force ?? !this.#set.has(token);
    if (add) this.#set.add(token);
    else this.#set.delete(token);
    return add;
  }
  contains(token: string) {
    return this.#set.has(token);
  }
  toString() {
    return [...this.#set].join(' ');
  }
}

class MockElement {
  #className = '';
  readonly classList = new MockClassList();
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly style = {
    properties: new Map<string, string>(),
    setProperty: (name: string, value: string) => {
      this.style.properties.set(name, value);
    }
  };
  readonly children: MockElement[] = [];
  readonly listeners = new Map<string, (() => void)[]>();
  hidden = false;
  type = '';
  disabled = false;
  title = '';
  #textContent = '';

  constructor(readonly tagName: string) {}

  get className() {
    return this.#className;
  }
  set className(value: string) {
    this.#className = value;
    this.classList.sync(value);
  }
  get childNodes() {
    return this.children;
  }
  get textContent() {
    return this.#textContent;
  }
  set textContent(value: string) {
    this.#textContent = value;
    this.children.length = 0;
  }
  append(...nodes: (MockElement | string)[]) {
    for (const item of nodes) {
      if (typeof item === 'string') continue;
      this.children.push(item);
    }
  }
  replaceChildren(...nodes: MockElement[]) {
    this.children.length = 0;
    this.children.push(...nodes);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  toggleAttribute(name: string, force?: boolean) {
    const present = force ?? !this.attributes.has(name);
    if (present) this.attributes.set(name, '');
    else this.attributes.delete(name);
    return present;
  }
  addEventListener(type: string, listener: () => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  click() {
    for (const listener of this.listeners.get('click') ?? []) listener();
  }
  querySelectorAll(selector: string): MockElement[] {
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    const found: MockElement[] = [];
    const visit = (node: MockElement) => {
      for (const child of node.children) {
        if (className ? child.classList.contains(className) : child.tagName === selector)
          found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
}

const originalDocument = globalThis.document;
afterEach(() => {
  if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
  else globalThis.document = originalDocument;
});

function installMockDocument() {
  globalThis.document = {
    createElement: (tag: string) => new MockElement(tag)
  } as unknown as Document;
}

describe('design tokens and CSS styling parity', () => {
  it('wires every foundation token and keeps tooltip light/dark shadows valid', () => {
    const raw = readThemeFile('design-tokens.json');
    const doc = JSON.parse(raw) as { foundation: Record<string, unknown> };
    const foundationLeaves = collectTokenLeaves(doc.foundation, 'foundation');
    const unused = foundationLeaves.filter((path) => !raw.includes(`{${path}}`));
    expect(unused).toEqual([]);

    const tokensCss = readThemeFile('tokens.css');
    const headlessTokensCss = readThemeFile('headless-tokens.css');
    const scalarTokensCss = readThemeFile('scalar-tokens.css');
    const componentsCss = readThemeFile('components.css');
    const expectedShadow = [
      '0 4px 16px light-dark(rgb(0 0 0 / 8%), rgb(0 0 0 / 42%))',
      '0 1px 3px light-dark(rgb(0 0 0 / 5%), rgb(0 0 0 / 28%))'
    ];
    for (const css of [tokensCss, headlessTokensCss]) {
      for (const part of expectedShadow) expect(css).toContain(part);
    }
    expect(tokensCss).toContain('--scope-chart-tooltip-inset: 8px;');
    expect(componentsCss).toMatch(/var\(--scope-chart-tooltip-inset\)\s*\*\s*2/);
    for (const name of [
      '--scope-chart-font-weight-regular',
      '--scope-chart-font-weight-strong',
      '--radius-chart-small',
      '--scope-chart-swatch-width',
      '--scope-chart-tooltip-inset',
      '--scope-chart-space-large'
    ]) {
      expect(tokensCss).toContain(`${name}:`);
      expect(componentsCss).toContain(`var(${name})`);
      expect(headlessTokensCss).not.toContain(`${name}:`);
      expect(scalarTokensCss).not.toContain(`${name}:`);
    }
    for (const name of ['--color-surface-hover', '--color-surface-pressed']) {
      expect(tokensCss).toContain(`${name}:`);
      expect(headlessTokensCss).not.toContain(`${name}:`);
    }
  });

  it('keeps headless.css aligned with components.css reading rhythm and structure', () => {
    const headless = readThemeFile('headless.css');
    expect(headless).toMatch(
      /font:\s*var\(--scope-chart-font-size-body\)\s*\/\s*1\.5\s+var\(--font-sans\)/
    );
    expect(headless).toContain('var(--scope-chart-tooltip-width,');
    expect(headless).toMatch(/calc\(\s*100vw\s*-\s*16px\s*\)/);
    expect(headless).toMatch(/overscroll-behavior:\s*contain/);
    expect(headless).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1\.8fr\)/);
    expect(headless).toContain('.tooltip-row[data-format="number"]');
    expect(headless).toContain('.tooltip-row[data-format="code"]');
    expect(headless).toContain('.tooltip-row[data-tone]');
    expect(headless).toContain('var(--font-mono)');
    expect(headless).toContain('.tooltip.compact .tooltip-heading strong');
    expect(headless).toContain('.tooltip.compact .tooltip-context');
    expect(headless).toContain('.center strong');
    expect(headless).toMatch(/max-width:\s*35%/);
    expect(headless).toMatch(
      /\.decoration\s*\{[^}]*pointer-events:\s*none[^}]*overflow:\s*hidden/s
    );
    expect(headless).toMatch(/\.status\.error\s*\{[^}]*color:\s*var\(--color-text-danger\)/s);
  });

  it('keeps components.css inspector, metric card, and toolbar fixes consistent', () => {
    const components = readThemeFile('components.css');
    expect(components).not.toMatch(/calc\(\s*100(?:vw|dvh)\s*-\s*16px\s*\)/);
    expect(components).toContain('12cqi');
    expect(components).not.toContain('6vw');
    expect(components).toContain('.tooltip.docked.pinned .tooltip-content > .tooltip-context');
    expect(components).toContain('.tooltip.docked.pinned .tooltip-heading:has(.swatch)');
    expect(components).toContain('.tooltip-observation-pages');
    expect(components).toMatch(/calc\(\s*17px\s*\*\s*var\(--scope-chart-font-scale\)\s*\)/);
  });

  it('aligns scalar.css typography without breaking metric font-size scaling', () => {
    const scalar = readThemeFile('scalar.css');
    expect(scalar).toMatch(/font-size:\s*var\(--scope-chart-font-size-metric\)/);
    expect(scalar).toMatch(/font-weight:\s*600/);
    expect(scalar).toMatch(/letter-spacing:\s*-0\.035em/);
    expect(scalar).toMatch(/gap:\s*var\(--scope-chart-space-micro\)/);
    expect(scalar).toMatch(/font-size:\s*var\(--scope-chart-font-size-control\)/);
  });
});

describe('UI inspection DOM parity', () => {
  it('omits empty tooltip-heading in renderPreview when both title and color are absent', () => {
    installMockDocument();
    const tooltip = new MockElement('div');
    const target: ChartInteraction<unknown> = {
      key: 'row-1',
      sources: [],
      tooltip: {
        rows: [{ label: 'requests', value: '42', format: 'number' }]
      }
    };
    renderPreview(tooltip as unknown as HTMLElement, target);
    expect(tooltip.querySelectorAll('.tooltip-heading')).toHaveLength(0);
    expect(tooltip.querySelectorAll('strong')).toHaveLength(0);
    expect(tooltip.querySelectorAll('.tooltip-body')).toHaveLength(1);

    renderPreview(tooltip as unknown as HTMLElement, {
      ...target,
      key: 'row-2',
      tooltip: {
        color: '#418be6',
        rows: [{ label: 'requests', value: '42', format: 'number' }]
      }
    });
    expect(tooltip.querySelectorAll('.tooltip-heading')).toHaveLength(1);
    expect(tooltip.querySelectorAll('.swatch')).toHaveLength(1);
    expect(tooltip.querySelectorAll('strong')).toHaveLength(0);

    renderPreview(tooltip as unknown as HTMLElement, {
      ...target,
      key: 'row-3',
      tooltip: {
        title: 'api',
        context: 'service',
        rows: [{ label: 'requests', value: '42', format: 'number' }]
      }
    });
    expect(tooltip.querySelectorAll('.tooltip-heading')).toHaveLength(1);
    expect(tooltip.querySelectorAll('strong')).toHaveLength(1);
    expect(tooltip.querySelectorAll('.tooltip-context')).toHaveLength(1);
  });

  it('renders observation pagination without the tooltip-footer class', () => {
    installMockDocument();
    const neighbors: ChartInteraction<unknown>[] = Array.from({ length: 6 }, (_, i) => ({
      key: `obs-${i}`,
      sources: [],
      tooltip: {
        title: `Point ${i + 1}`,
        rows: [{ label: 'x', value: String(i) }]
      }
    }));
    const state = {
      value: neighbors[0],
      pinned: true,
      page: 0,
      options: { neighbors, onChoose: () => {} }
    };
    const chooser = renderObservations(() => state) as unknown as MockElement;
    expect(chooser).not.toBeNull();
    expect(chooser.querySelectorAll('.tooltip-footer')).toHaveLength(0);
    const pages = chooser.querySelectorAll('.tooltip-observation-pages');
    expect(pages).toHaveLength(1);
    expect(pages[0].hidden).toBe(false);
    const buttons = pages[0].querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(false);
    buttons[1].click();
    expect(state.page).toBe(1);
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
  });
});
