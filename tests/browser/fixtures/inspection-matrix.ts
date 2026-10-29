import type { InspectionContext, ChartScene } from '../../../src/index.js';
import type { ChartView, ViewOptions } from '../../../src/headless.js';
import type {
  ScopeChartElement,
  ScopeTraceElement,
  ScopeFlameElement
} from '../../../src/element.js';

type Family = 'metric' | 'trace' | 'profile';
type Surface = 'component' | 'direct' | 'headless' | 'report';
type Layout = 'axis' | 'scatter' | 'donut' | 'top-list' | 'treemap';
export interface InspectionEntry {
  name: string;
  family: Family;
  surface: Surface;
  layout?: Layout;
  module?: string;
}

// This module is also imported by Playwright's Node collector: runtime imports stay in the fixture.
export const inspectionEntries: InspectionEntry[] = [
  ...(['metric', 'trace', 'profile'] as const).flatMap((family) =>
    (['component', 'headless', 'report'] as const).map((surface) => ({
      name: `${surface}/${family}`,
      family,
      surface
    }))
  ),
  { name: '/chart', family: 'metric', surface: 'direct', module: 'chart' },
  ...(['axis', 'scatter', 'donut', 'top-list', 'treemap'] as const).map((layout) => ({
    name: `/chart/${layout}`,
    family: 'metric' as const,
    surface: 'direct' as const,
    layout,
    module: `chart-${layout}`
  })),
  { name: '/trace', family: 'trace', surface: 'direct', module: 'trace' },
  { name: '/flame', family: 'profile', surface: 'direct', module: 'flame' }
];

export function inspectionDocument(entry: InspectionEntry, value: string, empty = false, id = 'a') {
  if (entry.family === 'trace')
    return {
      version: 1,
      kind: 'trace',
      coverage: 'complete',
      spans: empty
        ? []
        : [
            { id, name: id, startTimeNs: '0', endTimeNs: value },
            { id: 'child', parentId: id, name: 'child', startTimeNs: '0', endTimeNs: '0' }
          ]
    };
  if (entry.family === 'profile')
    return {
      version: 1,
      kind: 'profile',
      unit: 'samples',
      frames: empty
        ? []
        : [
            { id, name: id, selfWeight: value },
            { id: 'child', parentId: id, name: 'child', selfWeight: '0' }
          ]
    };
  const scatter = entry.layout === 'scatter';
  const distribution = entry.layout && !['axis', 'scatter'].includes(entry.layout);
  return {
    version: 1,
    data: {
      fields: [
        { name: 'category', data_type: scatter ? 'number' : 'string' },
        { name: 'value', data_type: 'number' }
      ],
      rows: empty
        ? []
        : [
            [scatter ? '1' : id, value],
            [scatter ? '2' : 'b', '50']
          ]
    },
    spec: {
      visualization: scatter
        ? 'scatter'
        : distribution
          ? entry.layout === 'donut'
            ? 'pie'
            : entry.layout
          : 'bar',
      encoding: distribution
        ? { category: 'category', value: 'value' }
        : { x: 'category', y: scatter ? 'value' : ['value'] }
    }
  };
}

export function hierarchyDocument(family: 'trace' | 'profile') {
  const nodes = Array.from({ length: 50 }, (_, i) => ({
    id: `node-${i}`,
    name: `node-${i}`,
    ...(i ? { parentId: `node-${i - 1}` } : {})
  }));
  return family === 'trace'
    ? {
        version: 1,
        kind: family,
        spans: nodes.map((node) => ({ ...node, startTimeNs: '0', endTimeNs: '10000' }))
      }
    : {
        version: 1,
        kind: family,
        unit: 'samples',
        frames: nodes.map((node) => ({ ...node, selfWeight: '1' }))
      };
}

export function inspectionValue(context: InspectionContext | null) {
  return !context
    ? null
    : context.kind === 'metric'
      ? context.rows[0][1]
      : context.kind === 'trace'
        ? context.durationNs
        : context.totalWeight;
}

export interface Notification {
  channel: 'inspect' | 'select';
  key: string | null;
  context: InspectionContext | null;
}
type Component = ScopeChartElement | ScopeTraceElement | ScopeFlameElement;

export async function createInspectionFixture(entry: InspectionEntry) {
  const outside = document.createElement('button');
  outside.textContent = 'Outside';
  const host = document.createElement('div');
  host.style.cssText = 'width:600px;--scope-chart-height:240px';
  document.body.append(outside, host);
  const events: Notification[] = [];
  const latest: Record<Notification['channel'], InspectionContext | null> = {
    inspect: null,
    select: null
  };
  let hook: ((notification: Notification) => void) | undefined;
  const receive = (
    channel: Notification['channel'],
    key: string | null,
    context: InspectionContext | null
  ) => {
    const notification = { channel, key, context };
    events.push(notification);
    latest[channel] = context;
    hook?.(notification);
  };
  let chart: Component | undefined;
  let view: ChartView | undefined;
  let source = inspectionDocument(entry, '100');
  if (entry.surface === 'component') {
    const module = '/src/register.ts';
    await import(module);
    chart = document.createElement(
      entry.family === 'metric'
        ? 'scope-chart'
        : entry.family === 'trace'
          ? 'scope-trace'
          : 'scope-flame'
    );
    chart.style.cssText = host.style.cssText;
    for (const channel of ['inspect', 'select'] as const)
      chart.addEventListener(`scope-${channel}`, (event) => {
        const detail = (
          event as CustomEvent<{ key: string | null; context: InspectionContext | null }>
        ).detail;
        receive(channel, detail.key, detail.context);
      });
    host.append(chart);
    const ready = new Promise((resolve) =>
      chart!.addEventListener('scope-ready', resolve, { once: true })
    );
    chart.document = source;
    await ready;
  } else {
    const module = `/src/${entry.module ?? entry.surface}.ts`;
    const factories = await import(module);
    const create =
      entry.surface === 'headless'
        ? factories.createVisualization
        : entry.surface === 'report'
          ? factories.createReport
          : entry.family === 'trace'
            ? factories.createTrace
            : entry.family === 'profile'
              ? factories.createFlame
              : factories.createChart;
    const options: ViewOptions<unknown> = {
      onInspect: (target, context) => receive('inspect', target?.key ?? null, context),
      onSelect: (target, context) => receive('select', target?.key ?? null, context)
    };
    view = await create(host, source, options);
    const interactions = '/src/interactions.ts';
    const { enableInteractions } = await import(interactions);
    enableInteractions(view!);
  }
  const settle = async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  };
  await settle();
  const root = chart?.shadowRoot ?? host.querySelector('.scopeview-view')!.shadowRoot!;
  const canvas = root.querySelector<HTMLElement>('.canvas')!;
  const plot = root.querySelector('.plot')!;
  const input =
    chart && entry.family === 'metric' ? root.querySelector<HTMLElement>('.viewport')! : canvas;
  const fixture = {
    entry,
    host,
    chart,
    view,
    root,
    canvas,
    input,
    outside,
    events,
    latest,
    settle,
    set hook(value: typeof hook) {
      hook = value;
    },
    key(key: string) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    },
    pin() {
      fixture.key('Home');
      fixture.key('Enter');
    },
    async replace(value: string, preserve = true, empty = false, id = 'a') {
      source = inspectionDocument(entry, value, empty, id);
      if (chart) chart.updateDocument(source, { preserveViewState: preserve });
      else await view!.update(source);
    },
    dismiss() {
      outside.focus({ preventScroll: true });
    },
    leave() {
      plot.dispatchEvent(new PointerEvent('pointerleave'));
    },
    repaint() {
      if (chart) {
        chart.theme = 'dark';
        chart.refresh();
      } else {
        view!.theme = 'dark';
        view!.refresh();
      }
      host.style.width = '640px';
    },
    dispose() {
      if (chart) chart.remove();
      else view!.dispose();
    },
    get tooltipHidden() {
      return root.querySelector<HTMLElement>('.tooltip')!.hidden;
    },
    async point() {
      const module = '/src/index.ts';
      const api: typeof import('../../../src/index.js') = await import(module);
      const frame = canvas.getBoundingClientRect();
      const measure = document.createElement('canvas').getContext('2d')!;
      measure.font = `11px ${getComputedStyle(canvas).fontFamily}`;
      const text = (value: string) => measure.measureText(value).width;
      const axes = chart ? 'full' : 'minimal';
      let scene: ChartScene<unknown>;
      if (entry.family === 'metric')
        scene = api.layoutChart(
          api.compileChart(source),
          new Set(),
          frame.width,
          frame.height,
          text,
          axes
        );
      else {
        const layoutModule = '/src/families/hierarchy/layout.ts';
        const { layoutHierarchy }: typeof import('../../../src/families/hierarchy/layout.js') =
          await import(layoutModule);
        scene =
          entry.family === 'trace'
            ? layoutHierarchy(
                api.createTraceView(api.compileTrace(source)),
                frame.width,
                frame.height,
                text,
                undefined,
                axes,
                !chart
              )
            : layoutHierarchy(
                api.createProfileView(api.compileProfile(source)),
                frame.width,
                frame.height,
                text,
                undefined,
                axes,
                !chart
              );
      }
      const target = scene.interactions[0];
      const bar = target.bars?.[0];
      const point = bar
        ? { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 }
        : (target.points[0] ?? target.anchor);
      return { x: frame.x + point.x, y: frame.y + point.y, key: target.key };
    }
  };
  return fixture;
}

declare global {
  interface Window {
    notificationFixture: Awaited<ReturnType<typeof createInspectionFixture>>;
  }
}
