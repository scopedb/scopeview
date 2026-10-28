import type {
  ChartDocument,
  ChartFieldRef,
  TraceDocument,
  ProfileDocument,
  MetricComponentOptions,
  EntityComponentOptions
} from '../../../src/index.js';
import type { ScopeChartAction } from '../../../src/element.js';
import toolbarStyles from './chart-controls.css?raw';

export const toolbarLabels: Partial<Record<ScopeChartAction, string>> = {
  'zoom-in': '+',
  'zoom-out': '−'
};

export type SourceLanguage = 'html' | 'javascript' | 'json';

export interface DemoSourceFile {
  language: SourceLanguage;
  name: string;
  label: string;
  copyLabel: string;
  code: string;
}

function literal(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/^(\s*)"([A-Za-z_$][\w$]*)":/gm, '$1$2:');
}

/** Show the authoring form: unique field names instead of full field references. */
function namedFields(document: ChartDocument) {
  const names = document.data.fields.map((field) => field.name);
  const name = (ref: ChartFieldRef) =>
    names.filter((candidate) => candidate === ref.name).length === 1 ? ref.name : ref;
  const named = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(named)
      : value && typeof value === 'object' && 'occurrence' in value
        ? name(value as ChartFieldRef)
        : value;
  const encoding = Object.fromEntries(
    Object.entries(document.spec.encoding).map(([key, value]) => [key, named(value)])
  );
  const time = document.semantics?.time;
  return {
    ...document,
    spec: { ...document.spec, encoding },
    ...(time
      ? { semantics: { ...document.semantics, time: { ...time, field: name(time.field) } } }
      : {}),
    ...(document.options?.values
      ? {
          options: {
            ...document.options,
            values: document.options.values.map((value) => ({ ...value, field: name(value.field) }))
          }
        }
      : {})
  };
}

export function demoSourceFiles(
  document: ChartDocument | TraceDocument | ProfileDocument,
  tag: string,
  hostStyle: Record<string, string>,
  ui: MetricComponentOptions | EntityComponentOptions = {}
): DemoSourceFile[] {
  const metric = 'data' in document;
  const dataKey = metric ? 'data' : document.kind === 'trace' ? 'spans' : 'frames';
  const data = metric
    ? document.data
    : document.kind === 'trace'
      ? document.spans
      : document.frames;
  const source = metric ? namedFields(document) : document;
  const properties = Object.entries(source).map(([key, value]) => {
    if (key === dataKey) return key === 'data' ? '  data' : `  ${key}: data`;
    return `  ${key}: ${literal(value).replaceAll('\n', '\n  ')}`;
  });
  const configuration = `import data from './data.json';\n\nexport default {\n${properties.join(',\n')}\n};`;
  const styles = Object.entries(hostStyle)
    .map(([key, value]) => `    ${key}: ${value};`)
    .join('\n');
  const mount = `<${tag} id="chart">
  <nav slot="toolbar" class="chart-controls" aria-label="Chart controls"></nav>
</${tag}>

<script type="module">
  import '@scopedb/scopeview/register';
  import chartDocument from './chart.js';

  const chart = document.querySelector('#chart');
  const toolbar = chart.querySelector('[slot="toolbar"]');
  const labels = ${literal(toolbarLabels)};

  function renderToolbar() {
    const controls = chart.controls;
    for (const button of toolbar.querySelectorAll('[data-action]')) {
      if (!controls.some((control) => control.action === button.dataset.action)) button.remove();
    }
    for (const control of controls) {
      let button = toolbar.querySelector('[data-action="' + control.action + '"]');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.action = control.action;
        button.addEventListener('click', () => chart.performAction(control.action));
        toolbar.append(button);
      }
      button.textContent = labels[control.action] || control.label;
      button.setAttribute('aria-label', control.label);
      button.disabled = control.disabled;
      if (control.expanded !== undefined) button.setAttribute('aria-expanded', String(control.expanded));
      else button.removeAttribute('aria-expanded');
    }
  }

  chart.addEventListener('scope-controls-change', renderToolbar);
  chart.configure(${literal(ui)});
  chart.document = chartDocument;
  renderToolbar();
\x3c/script>

<style>
  #chart {
${styles}
  }
${toolbarStyles}
</style>`;

  return [
    {
      language: 'html',
      name: 'index.html',
      label: 'Chart mount code',
      copyLabel: 'Copy code',
      code: mount
    },
    {
      language: 'javascript',
      name: 'chart.js',
      label: 'Chart configuration',
      copyLabel: 'Copy configuration',
      code: configuration
    },
    {
      language: 'json',
      name: 'data.json',
      label: 'Example data',
      copyLabel: 'Copy JSON',
      code: JSON.stringify(data, null, 2)
    }
  ];
}
