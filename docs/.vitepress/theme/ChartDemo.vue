<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useId,
  watch
} from 'vue';
import { useData } from 'vitepress';
import { VPButton } from 'vitepress/theme';
import CodeBlock from './CodeBlock.vue';
import DemoFamilies from './DemoFamilies.vue';
import DemoAppearance from './DemoAppearance.vue';
import { demoRouteVersion } from './demo-route.js';
import { demoSourceFiles, toolbarLabels, type SourceLanguage } from './demo-source.js';
import './chart-controls.css';
import './chart-demo.css';
import type {
  ScopeChartElement,
  ScopeTraceElement,
  ScopeFlameElement,
  ScopeInspectionDetail,
  HierarchyInspectionDetail,
  ScopeChartControl,
  ScopeControlsChangeDetail
} from '../../../src/element.js';
import type { MetricComponentOptions, EntityComponentOptions } from '../../../src/index.js';
import {
  demoComponent,
  demoDocument,
  demoUI,
  demoHostStyle,
  families,
  type DemoComponent,
  type DemoFamily
} from './demo-data.js';

const props = withDefaults(
  defineProps<{ initialFamily?: DemoFamily; component?: DemoComponent; showCode?: boolean }>(),
  { initialFamily: 'line', showCode: false }
);
const { isDark } = useData();
const id = useId();
const availableFamilies = computed(() =>
  families.filter((item) => !props.component || demoComponent(item.value) === props.component)
);
const defaultFamily =
  availableFamilies.value.find((item) => item.value === props.initialFamily)?.value ||
  availableFamilies.value[0].value;
const family = ref<DemoFamily>(defaultFamily);
const routeVersion = inject(demoRouteVersion, ref(0));
const surface = ref<'auto' | 'light' | 'dark'>('auto');
const theme = computed(() =>
  surface.value === 'auto' ? (isDark.value ? 'dark' : 'light') : surface.value
);
const chart = shallowRef<ScopeChartElement | ScopeTraceElement | ScopeFlameElement>();
const controls = shallowRef<ScopeChartControl[]>([]);
const registered = ref(false);
const failure = ref('');
const selection = ref('');
const copyStatus = ref('');
const codeExpanded = ref(false);
const codeFormat = ref<SourceLanguage>('html');
type DemoOptions = MetricComponentOptions & EntityComponentOptions & { interactive?: boolean };
type OptionKey =
  | 'header'
  | 'tooltip'
  | 'legend'
  | 'summary'
  | 'inspector'
  | 'dataTable'
  | 'toolbar'
  | 'interactive';
const optionsOpen = ref(false);
const optionPatch = ref<DemoOptions>({});
const source = computed(() => {
  const document = demoDocument(family.value);
  return optionPatch.value.interactive === undefined
    ? document
    : {
        ...document,
        options: { ...document.options, interactive: optionPatch.value.interactive }
      };
});
const ui = computed(() => {
  const { interactive: _, ...patch } = optionPatch.value;
  return {
    ...demoUI(family.value),
    ...(props.showCode ? { dismissOnOutside: false } : {}),
    ...patch
  };
});
const optionItems = computed(
  () =>
    [
      { key: 'header', label: 'Header' },
      { key: 'tooltip', label: 'Tooltips' },
      ...(demoComponent(family.value) === 'chart'
        ? [{ key: 'legend', label: 'Legend' }]
        : [
            { key: 'summary', label: 'Summary' },
            { key: 'inspector', label: 'Pinned details' }
          ]),
      { key: 'dataTable', label: 'Data table' },
      { key: 'toolbar', label: 'Toolbar' },
      { key: 'interactive', label: 'Interactive' }
    ] as { key: OptionKey; label: string }[]
);
function optionEnabled(key: OptionKey) {
  return (key === 'interactive' ? source.value.options?.interactive : ui.value[key]) !== false;
}
function setOption(key: OptionKey, event: Event) {
  const patch = { [key]: (event.target as HTMLInputElement).checked };
  optionPatch.value = { ...optionPatch.value, ...patch };
  if (key === 'interactive') chart.value?.updateDocument(source.value, { preserveViewState: true });
  else chart.value?.configure(patch);
  copyStatus.value = '';
}
const tag = computed(() => `scope-${demoComponent(family.value)}`);
const componentLink = computed(
  () => `/${demoComponent(family.value)}-component.html?family=${encodeURIComponent(family.value)}`
);
const hint = computed(() => families.find((item) => item.value === family.value)!.description);
const hostStyle = computed(() => demoHostStyle(theme.value, family.value));
const files = computed(() => demoSourceFiles(source.value, tag.value, hostStyle.value, ui.value));
const activeFile = computed(() => files.value.find((file) => file.language === codeFormat.value)!);
let disposed = false;
let mounted = false;

function restoreFamily() {
  if (!mounted || disposed) return;
  const requested = new URLSearchParams(window.location.search).get('family');
  family.value =
    availableFamilies.value.find((item) => item.value === requested)?.value ?? defaultFamily;
}
function rememberFamily() {
  const url = new URL(window.location.href);
  if (url.searchParams.get('family') === family.value) return;
  url.searchParams.set('family', family.value);
  window.history.replaceState(window.history.state, '', url);
}

function renderDocument() {
  if (!chart.value) return;
  optionPatch.value = {};
  chart.value.configure({
    header: true,
    tooltip: true,
    dataTable: true,
    toolbar: true,
    dismissOnOutside: true,
    ...(demoComponent(family.value) === 'chart'
      ? { legend: true }
      : { summary: true, inspector: true }),
    axes: 'full',
    ...ui.value
  });
  chart.value.document = source.value;
  selection.value = '';
  copyStatus.value = '';
}
function onSelect(event: Event) {
  const detail = (event as CustomEvent<ScopeInspectionDetail | HierarchyInspectionDetail>).detail;
  if (!detail.pinned) {
    selection.value = '';
    return;
  }
  selection.value =
    'sources' in detail
      ? detail.sources.map((item) => item.name).join(', ')
      : detail.rows.map((row) => row.join(' · ')).join('; ');
}
function onControls(event: Event) {
  controls.value = (event as CustomEvent<ScopeControlsChangeDetail>).detail.controls;
}
function onCodeKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = files.value.findIndex((file) => file.language === codeFormat.value);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? files.value.length - 1
        : (index + (event.key === 'ArrowLeft' ? -1 : 1) + files.value.length) % files.value.length;
  codeFormat.value = files.value[next].language;
  document.getElementById(`${id}-${codeFormat.value}`)?.focus();
  copyStatus.value = '';
}
async function copyCode() {
  try {
    await navigator.clipboard.writeText(activeFile.value.code);
    copyStatus.value = 'Copied';
  } catch {
    copyStatus.value = 'Select and copy the code below.';
  }
}
onMounted(async () => {
  mounted = true;
  restoreFamily();
  try {
    await import('../../../src/register.js');
    if (disposed) return;
    registered.value = true;
    await nextTick();
    if (!disposed) renderDocument();
  } catch {
    if (!disposed) failure.value = 'The chart could not load. Reload this page to retry.';
  }
});
watch(family, async () => {
  if (mounted && !disposed) rememberFamily();
  await nextTick();
  if (!disposed) renderDocument();
});
watch(routeVersion, restoreFamily, { flush: 'post' });
watch(theme, async () => {
  copyStatus.value = '';
  await nextTick();
  if (!disposed) chart.value?.refresh();
});
onBeforeUnmount(() => {
  disposed = true;
});
</script>

<template>
  <section class="chart-demo" aria-label="Interactive chart example" :data-code-expanded="codeExpanded">
    <div class="demo-workbench">
      <div class="demo-toolbar">
        <DemoFamilies v-model="family" :items="availableFamilies" />
        <div class="demo-toolbar-actions">
          <DemoAppearance v-model="surface" />
          <div class="demo-controls">
            <VPButton v-if="showCode" type="button" text="Options" theme="alt" :aria-expanded="optionsOpen" :aria-controls="`${id}-options`" @click="optionsOpen = !optionsOpen" />
            <VPButton type="button" text="Reset" theme="alt" aria-label="Reset chart" @click="renderDocument" />
            <VPButton v-if="!showCode" class="demo-docs-link" text="Docs" theme="alt" :href="componentLink" />
          </div>
        </div>
      </div>
      <fieldset v-if="showCode && optionsOpen" :id="`${id}-options`" class="demo-option-panel">
        <legend class="demo-sr-only">Example options</legend>
        <label v-for="item in optionItems" :key="item.key"><input type="checkbox" :checked="optionEnabled(item.key)" @change="setOption(item.key, $event)">{{ item.label }}</label>
      </fieldset>
      <div class="demo-stage" :data-theme="theme" :style="{ background: hostStyle['--color-surface'] || '#ffffff' }">
        <component v-if="registered" :is="tag" :key="family" ref="chart" class="demo-chart" :style="hostStyle" @scope-select="onSelect" @scope-controls-change="onControls">
          <nav slot="toolbar" class="chart-controls" aria-label="Chart controls">
            <button v-for="control in controls" :key="control.action" type="button" :data-action="control.action" :disabled="control.disabled" :aria-label="control.label" :aria-expanded="control.expanded" @click="chart?.performAction(control.action)">{{ toolbarLabels[control.action] || control.label }}</button>
          </nav>
        </component>
        <p v-else class="demo-loading" role="status">{{ failure || 'Loading interactive chart…' }}</p>
      </div>
      <div class="demo-caption">
        <p>{{ hint }}</p>
        <p v-if="optionEnabled('interactive')" :title="`${hint} Activate Inspect chart for keyboard navigation.`">{{ optionEnabled('tooltip') ? 'Hover to read' : 'Hover to highlight' }} <span>·</span> Click to select</p>
        <p v-else>Static chart</p>
      </div>
      <p v-if="selection" class="demo-selection" role="status">Selected: {{ selection }}</p>
      <div v-if="showCode" class="demo-source">
        <div class="demo-source-actions">
          <div class="demo-code-formats" role="tablist" aria-label="Source files" @keydown="onCodeKeydown">
            <button v-for="file in files" :key="file.language" :id="`${id}-${file.language}`" type="button" role="tab" :aria-selected="codeFormat === file.language" :tabindex="codeFormat === file.language ? 0 : -1" :aria-controls="`${id}-code`" @click="codeFormat = file.language; copyStatus = ''">{{ file.name }}</button>
          </div>
          <span role="status">{{ copyStatus }}</span>
          <VPButton type="button" :text="codeExpanded ? 'Collapse code' : 'Expand code'" theme="alt" :aria-expanded="codeExpanded" :aria-controls="`${id}-code`" @click="codeExpanded = !codeExpanded" />
          <VPButton type="button" :text="copyStatus === 'Copied' ? 'Copied' : 'Copy code'" theme="alt" :aria-label="activeFile.copyLabel" @click="copyCode" />
        </div>
        <div :id="`${id}-code`" role="tabpanel" :aria-labelledby="`${id}-${codeFormat}`">
          <CodeBlock :code="activeFile.code" :language="activeFile.language" :label="activeFile.label" />
        </div>
      </div>
    </div>
  </section>
</template>
