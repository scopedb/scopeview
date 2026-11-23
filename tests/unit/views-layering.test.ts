import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAxisMode, parseViewOptions } from '../../src/views/options.js';
import { ViewHost } from '../../src/views/host.js';
import { createMetric } from '../../src/views/metric.js';
import { createHierarchy } from '../../src/views/hierarchy.js';
import { createReport } from '../../src/report.js';
import { createScalar } from '../../src/views/scalar.js';
import { compileChart } from '../../src/families/metrics/document.js';
import { layoutChart } from '../../src/families/metrics/layout.js';
import { compileTrace, createTraceView } from '../../src/families/trace.js';
import { traceInspectionContext } from '../../src/families/hierarchy/inspection-context.js';
import { ChartSession } from '../../src/core/session.js';
import type { ChartInteraction } from '../../src/core/scene.js';
import type { CanvasRenderer } from '../../src/renderers/canvas/renderer.js';
import { ChartRuntime } from '../../src/runtime/chart-runtime.js';
import { handleInspectionKey, inspectionDirection } from '../../src/runtime/keyboard.js';
import {
  DATA_TABLE_PAGE_SIZE,
  dataTablePage,
  renderDataTable,
  setDataTableOpen,
  type DataTableElements
} from '../../src/elements/data-table.js';
import sample from '../../examples/requests.json';

class FakeStyle {
  #values = new Map<string, string>();
  calls: { op: 'set' | 'remove'; name: string; value?: string }[] = [];
  colorScheme = '';
  touchAction = '';
  pointerEvents = '';
  left = '';
  top = '';
  width = '';
  height = '';
  cssText = '';

  setProperty(name: string, value: string) {
    this.#values.set(name, value);
    this.calls.push({ op: 'set', name, value });
  }
  removeProperty(name: string) {
    this.#values.delete(name);
    this.calls.push({ op: 'remove', name });
  }
  getPropertyValue(name: string) {
    return this.#values.get(name) ?? '';
  }
  snapshot() {
    return Object.fromEntries(this.#values);
  }
  clearCalls() {
    this.calls = [];
  }
}

class FakeClassList {
  #set = new Set<string>();
  constructor(initial = '') {
    for (const token of initial.split(/\s+/).filter(Boolean)) this.#set.add(token);
  }
  add(...tokens: string[]) {
    for (const token of tokens) this.#set.add(token);
  }
  contains(token: string) {
    return this.#set.has(token);
  }
  toggle(token: string, force?: boolean) {
    const next = force ?? !this.#set.has(token);
    if (next) this.#set.add(token);
    else this.#set.delete(token);
    return next;
  }
}

let onMeasureText: ((text: string) => void) | null = null;
class FakeElement extends EventTarget {
  readonly style = new FakeStyle();
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly classList: FakeClassList;
  #queried = new Map<string, FakeElement>();
  parentElement: FakeElement | null = null;
  shadowRoot: FakeElement | null = null;
  host: FakeElement | null = null;
  hidden = false;
  disabled = false;
  tabIndex = -1;
  type = '';
  scope = '';
  title = '';
  popover = '';
  scrollTop = 0;
  isConnected = true;
  #text = '';

  constructor(
    readonly tagName = 'div',
    className = ''
  ) {
    super();
    this.classList = new FakeClassList(className);
  }
  get className() {
    return '';
  }
  set className(value: string) {
    for (const token of value.split(/\s+/).filter(Boolean)) this.classList.add(token);
  }
  get textContent() {
    return this.#text;
  }
  set textContent(value: string | null) {
    this.#text = value ?? '';
  }
  set innerHTML(_value: string) {}
  assignedElements() {
    return [];
  }
  attachShadow() {
    const root = new FakeElement('#shadow-root');
    root.host = this;
    this.shadowRoot = root;
    return root;
  }
  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }
  prepend(...nodes: FakeElement[]) {
    for (const node of nodes.toReversed()) {
      node.parentElement = this;
      this.children.unshift(node);
    }
  }
  replaceChildren(...nodes: FakeElement[]) {
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
    this.append(...nodes);
  }
  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    this.#notifyAttribute(name);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
    this.#notifyAttribute(name);
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  toggleAttribute(name: string, force?: boolean) {
    const next = force ?? !this.attributes.has(name);
    if (next) this.attributes.set(name, '');
    else this.attributes.delete(name);
    this.#notifyAttribute(name);
    return next;
  }
  #notifyAttribute(name: string) {
    const ctor = this.constructor as { observedAttributes?: string[] };
    const cb = (this as unknown as { attributeChangedCallback?(n: string): void })
      .attributeChangedCallback;
    if (ctor.observedAttributes?.includes(name) && typeof cb === 'function') cb.call(this, name);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 400, height: 240, right: 400, bottom: 240 };
  }
  getClientRects() {
    return [{ left: 0, top: 0, width: 400, height: 240 }];
  }
  getRootNode() {
    return this.parentElement ?? this;
  }
  contains(node: FakeElement | null): boolean {
    if (!node) return false;
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }
  matches() {
    return false;
  }
  querySelector(selector: string): FakeElement | null {
    if (selector.startsWith(':scope')) return null;
    let found = this.#queried.get(selector);
    if (!found) {
      found = new FakeElement(selector.startsWith('slot') ? 'slot' : 'div');
      this.#queried.set(selector, found);
    }
    return found;
  }
  querySelectorAll() {
    return [];
  }
  getContext() {
    return {
      canvas: this,
      font: '',
      measureText: (text: string) => {
        onMeasureText?.(text);
        return { width: text.length * 6 };
      },
      reset() {},
      setTransform() {},
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      fillRect() {},
      fillText() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      setLineDash() {},
      getLineDash: () => [],
      getTransform: () => ({ a: 1, d: 1 }),
      arc() {},
      fill() {},
      translate() {},
      rotate() {}
    };
  }
}

function installFakeDOM() {
  const globals = globalThis as Record<string, unknown>;
  const saved = {
    document: globals.document,
    window: globals.window,
    HTMLElement: globals.HTMLElement,
    MutationObserver: globals.MutationObserver,
    getComputedStyle: globals.getComputedStyle,
    ResizeObserver: globals.ResizeObserver,
    requestAnimationFrame: globals.requestAnimationFrame,
    cancelAnimationFrame: globals.cancelAnimationFrame,
    matchMedia: globals.matchMedia,
    devicePixelRatio: globals.devicePixelRatio
  };
  const win = new EventTarget() as EventTarget & {
    matchMedia(query: string): EventTarget & { matches: boolean; media: string };
    addEventListener: EventTarget['addEventListener'];
  };
  const matchMedia = (query: string) =>
    Object.assign(new EventTarget(), { matches: false, media: query });
  win.matchMedia = matchMedia;
  const doc = Object.assign(new EventTarget(), {
    createElement: (tag: string) => new FakeElement(tag),
    documentElement: { clientWidth: 1024, clientHeight: 768 },
    fonts: new EventTarget()
  });
  let rafId = 0;
  const rafQueue = new Map<number, () => void>();
  globals.document = doc;
  globals.window = win;
  globals.HTMLElement = FakeElement;
  globals.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globals.matchMedia = matchMedia;
  globals.devicePixelRatio = 1;
  globals.getComputedStyle = (el: FakeElement) => ({
    color: 'rgb(0, 0, 0)',
    fontFamily: 'Inter, sans-serif',
    visibility: 'visible',
    getPropertyValue: (name: string) => el.style.getPropertyValue(name)
  });
  globals.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  globals.requestAnimationFrame = (cb: () => void) => {
    const id = ++rafId;
    rafQueue.set(id, cb);
    return id;
  };
  globals.cancelAnimationFrame = (id: number) => {
    rafQueue.delete(id);
  };
  const flushRAF = () => {
    const pending = [...rafQueue.values()];
    rafQueue.clear();
    for (const cb of pending) cb();
  };
  return {
    flushRAF,
    restore() {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete globals[key];
        else globals[key] = value;
      }
    }
  };
}

let restoreDOM: (() => void) | null = null;
afterEach(() => {
  restoreDOM?.();
  restoreDOM = null;
});

describe('view & axis option parsing', () => {
  it('normalizes axes defaults once on parse and validates view options', () => {
    expect(parseAxisMode('minimal', 'options.axes')).toBe('minimal');
    expect(() => parseAxisMode('compact', 'options.axes')).toThrow('options.axes');

    expect(parseViewOptions({})).toEqual({ axes: 'minimal' });
    expect(parseViewOptions({}, 'full')).toEqual({ axes: 'full' });
    expect(parseViewOptions({ axes: 'none', tooltip: false, theme: 'dark' })).toEqual({
      axes: 'none',
      tooltip: false,
      theme: 'dark'
    });
    expect(() => parseViewOptions({ axes: 'compact' as never })).toThrow('options.axes');
    expect(() => parseViewOptions({ onInspect: 'nope' as never })).toThrow('options.onInspect');
    expect(() => parseViewOptions({ unknown: true } as never)).toThrow(
      'options.unknown: Unknown option.'
    );
  });
});

describe('ViewHost token inheritance & view factory contract', () => {
  it('inherits host tokens, applies theme overrides, and clears omitted palette overrides on reset', () => {
    restoreDOM = installFakeDOM().restore;
    const host = new FakeElement('div');
    host.style.setProperty('--color-surface', '#112233');
    const viewHost = new ViewHost(
      host as unknown as HTMLElement,
      '',
      ':host{--color-surface:#fff;--color-text:#000;--color-surface:#fff}',
      'light'
    );
    const style = (viewHost.element as unknown as FakeElement).style;
    expect(style.getPropertyValue('--color-surface')).toBe('#112233');

    viewHost.theme = { colors: { surface: '#abcdef' } };
    expect(style.getPropertyValue('--color-surface')).toBe('#abcdef');

    // Palette overrides not listed in scalar/headless token CSS must still clear on theme reset.
    viewHost.theme = { palette: ['#123456', '#654321'] };
    expect(style.getPropertyValue('--color-chart-series-1')).toBe('#123456');
    expect(style.getPropertyValue('--color-chart-series-1-line')).toBe('#123456');

    host.style.removeProperty('--color-surface');
    viewHost.theme = 'dark';
    expect(style.getPropertyValue('--color-surface')).toBe('');
    expect(style.getPropertyValue('--color-chart-series-1')).toBe('');
    expect(style.getPropertyValue('--color-chart-series-1-line')).toBe('');
    viewHost.dispose();
  });

  it('preserves theme across aggregate <-> plotted transitions and omits configure() on headless views', async () => {
    const dom = installFakeDOM();
    restoreDOM = dom.restore;
    const host = new FakeElement('div');
    const scalar = createScalar(host as unknown as HTMLElement, { value: '42', label: 'Count' });
    expect('configure' in scalar).toBe(false);
    scalar.dispose();

    const compiled = compileChart(sample);
    const metric = createMetric(
      host as unknown as HTMLElement,
      compiled,
      layoutChart,
      compileChart,
      { axes: 'minimal', tooltip: true, theme: 'dark' }
    );
    expect('configure' in metric.view).toBe(false);
    const innerView = (host.children[0] as unknown as { tagName: string }).tagName;
    expect(innerView).toBe('div');

    // Aggregate <-> plotted transitions keep configured theme.
    const aggregateDoc = {
      version: 1,
      data: { fields: [{ name: 'n', data_type: 'number' }], rows: [['7']] },
      spec: { visualization: 'big-number', encoding: { values: ['n'] } }
    };
    metric.view.update(aggregateDoc);
    expect(metric.view.theme).toBe('dark');
    metric.view.update(sample);
    expect(metric.view.theme).toBe('dark');
    metric.view.dispose();

    const traceDoc = {
      version: 1,
      kind: 'trace',
      spans: [{ id: 'root', name: 'Root', startTimeNs: '0', endTimeNs: '100' }]
    };
    const hierarchy = createHierarchy(
      host as unknown as HTMLElement,
      traceDoc,
      compileTrace,
      createTraceView,
      traceInspectionContext,
      { axes: 'minimal' }
    );
    expect('configure' in hierarchy).toBe(false);
    hierarchy.dispose();

    const report = await createReport(host as unknown as HTMLElement, sample);
    expect('configure' in report).toBe(false);
    report.dispose();
  });
});

describe('runtime refresh priority, text cache, coalesced paint/viewport, and shared session', () => {
  it('prioritizes layout > viewport > paint, keeps keepColors false when paint coalesces with viewport, and preserves injected session hidden set', () => {
    const dom = installFakeDOM();
    restoreDOM = dom.restore;
    const canvas = new FakeElement('div');
    const decoration = new FakeElement('div');
    const session = new ChartSession<unknown>('compare');
    session.setHidden(['api']);
    let layouts = 0;
    let measureCalls = 0;
    onMeasureText = () => {
      measureCalls++;
    };
    const runtime = new ChartRuntime(
      canvas as unknown as HTMLElement,
      decoration as unknown as HTMLElement,
      {
        session,
        keyboard: false,
        onError(error) {
          throw error;
        },
        layout: (width, height, measure) => {
          layouts++;
          measure('unique-runtime-label');
          measure('unique-runtime-label');
          return {
            width,
            height,
            rect: { x: 0, y: 0, width, height },
            marks: [],
            xTicks: [],
            yTicks: [],
            hitMode: 'item',
            interactions: [],
            interactionByKey: new Map(),
            ariaLabel: 'runtime-test'
          };
        }
      }
    );
    expect(runtime.session).toBe(session);
    const painter = (runtime as unknown as { painter: CanvasRenderer<unknown> }).painter;
    const painterRenderSpy = vi.spyOn(painter, 'render');

    dom.flushRAF();
    expect(layouts).toBe(1);
    expect(measureCalls).toBe(1);
    expect(painterRenderSpy.mock.calls.at(-1)?.[2]?.keepColors).toBe(false);

    // Paint-only refresh does not re-layout and invalidates colors.
    painterRenderSpy.mockClear();
    runtime.refresh('paint');
    dom.flushRAF();
    expect(layouts).toBe(1);
    expect(painterRenderSpy.mock.calls.at(-1)?.[2]?.keepColors).toBe(false);

    // Pure viewport refresh keeps resolved colors; coalesced paint + viewport must NOT keepColors.
    painterRenderSpy.mockClear();
    runtime.refresh('viewport');
    dom.flushRAF();
    expect(layouts).toBe(2);
    expect(measureCalls).toBe(1);
    expect(painterRenderSpy.mock.calls.at(-1)?.[2]?.keepColors).toBe(true);

    painterRenderSpy.mockClear();
    runtime.refresh('paint');
    runtime.refresh('viewport');
    dom.flushRAF();
    expect(layouts).toBe(3);
    expect(painterRenderSpy.mock.calls.at(-1)?.[2]?.keepColors).toBe(false);

    // Pending paint followed by synchronous viewport paint also drops stale colors.
    painterRenderSpy.mockClear();
    runtime.refresh('paint');
    runtime.paint(undefined, 'viewport');
    expect(painterRenderSpy.mock.calls.at(-1)?.[2]?.keepColors).toBe(false);
    dom.flushRAF();

    // Layout invalidation beats viewport when queued in the same frame; loadingdone clears cache.
    runtime.refresh('viewport');
    runtime.refresh('layout');
    runtime.refresh('paint');
    dom.flushRAF();
    expect(layouts).toBe(5);
    expect(measureCalls).toBe(1);

    document.fonts.dispatchEvent(new Event('loadingdone'));
    dom.flushRAF();
    expect(layouts).toBe(6);
    expect(measureCalls).toBe(2);

    // Equal linkedHighlight skips re-render; updates use lightweight painter.link().
    const renderSpy = vi.spyOn(runtime, 'render');
    const linkSpy = vi.spyOn(painter, 'link');
    runtime.linkedHighlight = { inspectionKey: null, cursor: 0.25 };
    runtime.linkedHighlight = { inspectionKey: null, cursor: 0.25 };
    expect(renderSpy).not.toHaveBeenCalled();
    expect(linkSpy).toHaveBeenCalledTimes(1);
    expect(linkSpy).toHaveBeenCalledWith(null, 0.25);

    onMeasureText = null;
    runtime.dispose();
    expect([...session.hidden]).toEqual(['api']);
  });
});

describe('HierarchyElement.#repaint() loading/error guard', () => {
  it('skips #runtime.refresh("paint") while loading or error is active', async () => {
    const dom = installFakeDOM();
    restoreDOM = dom.restore;
    const { ScopeTraceElement } = await import('../../src/elements/entity-elements.js');
    const el = new ScopeTraceElement();
    el.document = {
      version: 1,
      kind: 'trace',
      spans: [{ id: 'root', name: 'Root', startTimeNs: '0', endTimeNs: '100' }]
    };
    el.connectedCallback();
    const refreshSpy = vi.spyOn(ChartRuntime.prototype, 'refresh');
    dom.flushRAF();
    dom.flushRAF();
    expect(el.dataset.state).toBe('ready');

    refreshSpy.mockClear();
    el.theme = 'dark';
    expect(refreshSpy).toHaveBeenCalledWith('paint');
    dom.flushRAF();

    // Pending loading must prevent #repaint() from firing #runtime.refresh('paint').
    refreshSpy.mockClear();
    el.loading = true;
    el.theme = 'light';
    expect(refreshSpy).not.toHaveBeenCalled();
    dom.flushRAF();
    expect(el.dataset.state).toBe('loading');

    el.loading = false;
    dom.flushRAF();
    dom.flushRAF();
    expect(el.dataset.state).toBe('ready');

    // Pending error must also suppress #repaint().
    refreshSpy.mockClear();
    el.error = 'boom';
    el.theme = 'dark';
    expect(refreshSpy).not.toHaveBeenCalled();
    dom.flushRAF();
    expect(el.dataset.state).toBe('error');

    el.disconnectedCallback();
  });
});

describe('data-table pagination and lazy rendering', () => {
  it('computes clamped page bounds, skips hidden builds, and renders explicit NULL/empty labels', () => {
    restoreDOM = installFakeDOM().restore;
    expect(dataTablePage(0, 3)).toEqual({ pages: 1, page: 0 });
    expect(dataTablePage(120, -2)).toEqual({ pages: 3, page: 0 });
    expect(dataTablePage(120, 99)).toEqual({ pages: 3, page: 2 });

    const elements: DataTableElements = {
      raw: new FakeElement('div') as unknown as HTMLElement,
      toggle: new FakeElement('button') as unknown as HTMLElement,
      pagination: new FakeElement('div') as unknown as HTMLElement,
      pageLabel: new FakeElement('span') as unknown as HTMLElement,
      previous: new FakeElement('button') as unknown as HTMLButtonElement,
      next: new FakeElement('button') as unknown as HTMLButtonElement
    };
    elements.raw.hidden = true;
    const buildModel = vi.fn(() => ({
      caption: '105 returned rows.',
      headers: ['name', 'val'],
      total: 105,
      rows: (start: number, end: number) =>
        Array.from({ length: Math.max(0, Math.min(105, end) - start) }, (_, offset) => {
          const i = start + offset;
          return [
            { text: `row-${i}` },
            i === 0
              ? { text: 'NULL', ariaLabel: 'SQL NULL' }
              : i === 1
                ? { text: '', ariaLabel: 'Empty string' }
                : { text: String(i) }
          ];
        })
    }));

    // Hidden raw container skips table construction completely.
    expect(renderDataTable(elements, true, 0, buildModel)).toBe(0);
    expect(buildModel).not.toHaveBeenCalled();
    expect(elements.pagination.hidden).toBe(true);

    // Opening builds page 0 with 50 rows and updates button states.
    const page0 = setDataTableOpen(elements, true, true, 0, buildModel);
    expect(page0).toBe(0);
    expect(buildModel).toHaveBeenCalledTimes(1);
    expect(elements.toggle.getAttribute('aria-expanded')).toBe('true');
    expect(elements.toggle.textContent).toBe('Hide data');
    expect(elements.pagination.hidden).toBe(false);
    expect(elements.pageLabel.textContent).toBe('Page 1 of 3');
    expect(elements.previous.disabled).toBe(true);
    expect(elements.next.disabled).toBe(false);

    const table = (elements.raw as unknown as FakeElement).children[0];
    const tbody = table.children[2];
    expect(tbody.children).toHaveLength(DATA_TABLE_PAGE_SIZE);
    expect(tbody.children[0].children[1].getAttribute('aria-label')).toBe('SQL NULL');
    expect(tbody.children[1].children[1].getAttribute('aria-label')).toBe('Empty string');

    // Last page clamps out-of-range page and disables Next.
    const lastPage = renderDataTable(elements, true, 99, buildModel);
    expect(lastPage).toBe(2);
    expect(elements.pageLabel.textContent).toBe('Page 3 of 3');
    expect(elements.previous.disabled).toBe(false);
    expect(elements.next.disabled).toBe(true);
    expect((elements.raw as unknown as FakeElement).children[0].children[2].children).toHaveLength(
      5
    );

    // Disabling dataTable hides and resets toggle label.
    renderDataTable(elements, false, lastPage, buildModel);
    expect(elements.raw.hidden).toBe(true);
    expect(elements.toggle.getAttribute('aria-expanded')).toBe('false');
    expect(elements.toggle.textContent).toBe('View data');
  });
});

describe('shared keyboard inspection handler', () => {
  function createSession() {
    const items: ChartInteraction<string>[] = ['a', 'b', 'c'].map((id) => ({
      key: id,
      sources: [id],
      tooltip: { title: id, rows: [{ label: 'v', value: id }] }
    }));
    const session = new ChartSession<string>('compare');
    session.setModel({
      interactions: items,
      interactionByKey: new Map(items.map((item) => [item.key, item])),
      ariaLabel: 'test'
    });
    return session;
  }

  function fakeKey(key: string, mods: Partial<KeyboardEvent> = {}) {
    let prevented = false;
    return {
      event: {
        key,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        preventDefault() {
          prevented = true;
        },
        ...mods
      } as unknown as KeyboardEvent,
      get prevented() {
        return prevented;
      }
    };
  }

  it('commits session before onNavigate, skips onUpdate when aborted, and maps navigation keys', () => {
    expect(inspectionDirection('Home')).toBe('Home');
    expect(inspectionDirection('End')).toBe('End');
    expect(inspectionDirection('ArrowLeft')).toBe('previous');
    expect(inspectionDirection('ArrowUp')).toBe('previous');
    expect(inspectionDirection('ArrowRight')).toBe('next');
    expect(inspectionDirection('ArrowDown')).toBe('next');
    expect(inspectionDirection('Enter')).toBeNull();

    const session = createSession();
    const controller = new AbortController();
    const navigated: [string, string | null, boolean][] = [];
    const updates: [string | null, boolean][] = [];
    const onUpdate = () => updates.push([session.active?.key ?? null, session.pinned]);

    const modified = fakeKey('ArrowRight', { ctrlKey: true });
    expect(
      handleInspectionKey(
        modified.event,
        session,
        true,
        true,
        onUpdate,
        undefined,
        controller.signal
      )
    ).toBe(false);
    expect(modified.prevented).toBe(false);

    const staticKey = fakeKey('Home');
    expect(
      handleInspectionKey(
        staticKey.event,
        session,
        false,
        true,
        onUpdate,
        undefined,
        controller.signal
      )
    ).toBe(false);

    const home = fakeKey('Home');
    expect(
      handleInspectionKey(
        home.event,
        session,
        true,
        false,
        onUpdate,
        (t) => navigated.push([t.key, session.active?.key ?? null, session.pinned]),
        controller.signal
      )
    ).toBe(true);
    expect(home.prevented).toBe(true);
    expect(navigated).toEqual([['a', 'a', false]]);
    expect(updates).toEqual([['a', false]]);

    handleInspectionKey(
      fakeKey('Enter').event,
      session,
      true,
      false,
      onUpdate,
      undefined,
      controller.signal
    );
    expect(updates.at(-1)).toEqual(['a', false]);

    handleInspectionKey(
      fakeKey('Enter').event,
      session,
      true,
      true,
      onUpdate,
      (t) => navigated.push([t.key, session.active?.key ?? null, session.pinned]),
      controller.signal
    );
    expect(navigated.at(-1)).toEqual(['a', 'a', true]);
    expect(updates.at(-1)).toEqual(['a', true]);

    // If onNavigate disposes/aborts the runtime signal, onUpdate must not fire.
    const updatesBeforeAbort = updates.length;
    expect(
      handleInspectionKey(
        fakeKey('End').event,
        session,
        true,
        true,
        onUpdate,
        () => controller.abort(),
        controller.signal
      )
    ).toBe(true);
    expect(updates).toHaveLength(updatesBeforeAbort);

    const alive = new AbortController();
    handleInspectionKey(
      fakeKey('Escape').event,
      session,
      true,
      true,
      onUpdate,
      undefined,
      alive.signal
    );
    expect(updates.at(-1)).toEqual([null, false]);
  });
});
