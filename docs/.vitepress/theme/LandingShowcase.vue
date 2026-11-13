<script setup lang="ts">
import { useData, withBase } from 'vitepress';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { InspectionContext } from '../../../src/core/inspection-context.js';
import { createVisualization } from '../../../src/headless.js';
import { enableInteractions } from '../../../src/interactions.js';
import type { ChartView } from '../../../src/views/view.js';
import lineDocument from '../../../examples/documents/line.json';
import profileDocument from '../../../examples/documents/profile.json';
import traceDocument from '../../../examples/documents/trace.json';

type ScenarioId = 'trace' | 'line' | 'profile';
type CodeTabId = 'cli' | 'agent' | 'json';

interface ReadingPair {
  label: string;
  value: string;
}

interface Scenario {
  id: ScenarioId;
  tabLabel: string;
  headline: string;
  summary: string;
  document: Record<string, unknown>;
  baselineTitle: string;
  baselineReadings: ReadingPair[];
  cliSnippet: string;
  agentPrompt: string;
}

const scenarios: readonly Scenario[] = [
  {
    id: 'trace',
    tabLabel: 'Trace · 1 ns vs 0 ns',
    headline: 'Nanosecond precision across a 20 ms request trace',
    summary:
      'ScopeView preserves exact startTimeNs and endTimeNs strings so a 1 ns span and a 0 ns span stay distinguishable instead of collapsing under float rounding.',
    document: traceDocument,
    baselineTitle: 'Default fixture highlights (hover or click any span)',
    baselineReadings: [
      { label: 'span.tiny.duration', value: '1 ns' },
      { label: 'span.tiny.endTimeNs', value: '"1803600000015000001"' },
      { label: 'span.zero.duration', value: '0 ns' }
    ],
    cliSnippet: [
      'npx @scopedb/scopeview example trace --output trace.json',
      'npx @scopedb/scopeview validate --input trace.json --json',
      'npx @scopedb/scopeview render --input trace.json --output trace.html --json'
    ].join('\n'),
    agentPrompt: [
      'Use @scopedb/scopeview to visualize this latency trace.',
      'Read https://scopeview.scopedb.io/llms.txt for the v1 schema contract.',
      'Encode startTimeNs and endTimeNs as exact strings (do not cast to Number),',
      'run `scopeview validate --input trace.json --json`, and render a standalone report',
      'with `scopeview render --input trace.json --output trace.html --json`.'
    ].join('\n')
  },
  {
    id: 'line',
    tabLabel: 'Metrics · NULL vs 0',
    headline: 'Explicit null gaps never coerce to zero',
    summary:
      'Missing scrape intervals stay explicit null gaps that break the line cleanly, while real 0 values stay anchored on the baseline as exact source strings.',
    document: lineDocument,
    baselineTitle: 'Default fixture highlights (hover or click any sample)',
    baselineReadings: [
      { label: '00:01Z (zero)', value: '"0"' },
      { label: '00:02Z (gap)', value: 'null' },
      { label: '00:03Z (spike)', value: '"18"' }
    ],
    cliSnippet: [
      'npx @scopedb/scopeview example line --output line.json',
      'npx @scopedb/scopeview validate --input line.json --json',
      'npx @scopedb/scopeview render --input line.json --output line.html --json'
    ].join('\n'),
    agentPrompt: [
      'Use @scopedb/scopeview to plot this metric series.',
      'Read https://scopeview.scopedb.io/llms.txt for the v1 line schema.',
      'Keep numeric strings intact and emit `null` for missing intervals (never substitute 0),',
      'validate with `scopeview validate --input line.json --json`, and render',
      'a standalone HTML report with `scopeview render --input line.json --output line.html --json`.'
    ].join('\n')
  },
  {
    id: 'profile',
    tabLabel: 'Flame graph · > 2^53 weight',
    headline: 'BigInt frame weights above MAX_SAFE_INTEGER',
    summary:
      'CPU and allocation weights like "9007199254740993" alongside 1-unit and 0-unit frames pass through as BigInt totals without IEEE-754 drift.',
    document: profileDocument,
    baselineTitle: 'Default fixture highlights (hover or click any frame)',
    baselineReadings: [
      { label: 'query.selfWeight', value: '"9007199254740993"' },
      { label: 'query.source', value: 'example.ts:12' },
      { label: 'tiny.selfWeight', value: '"1"' }
    ],
    cliSnippet: [
      'npx @scopedb/scopeview example profile --output profile.json',
      'npx @scopedb/scopeview validate --input profile.json --json',
      'npx @scopedb/scopeview render --input profile.json --output profile.html --json'
    ].join('\n'),
    agentPrompt: [
      'Use @scopedb/scopeview to turn this profile tree into a flame graph.',
      'Read https://scopeview.scopedb.io/llms.txt for the v1 profile schema.',
      'Preserve 64-bit integer selfWeight values as strings (avoid Number rounding past 2^53),',
      'validate with `scopeview validate --input profile.json --json`, and render',
      'to HTML via `scopeview render --input profile.json --output profile.html --json`.'
    ].join('\n')
  }
];

const codeTabs: readonly { id: CodeTabId; label: string }[] = [
  { id: 'cli', label: 'Run in terminal' },
  { id: 'agent', label: 'Agent prompt' },
  { id: 'json', label: 'v1 JSON' }
];

const { isDark } = useData();
const activeScenarioId = ref<ScenarioId>('trace');
const activeCodeTab = ref<CodeTabId>('cli');
const chartHost = ref<HTMLElement | null>(null);
const inspected = ref<InspectionContext | null>(null);
const selected = ref<InspectionContext | null>(null);
const renderError = ref<string | null>(null);
const copied = ref(false);

let chartView: ChartView | null = null;
let stopInteractions: (() => void) | null = null;
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

const activeScenario = computed(
  () => scenarios.find((item) => item.id === activeScenarioId.value) ?? scenarios[0]
);

const activeSnippet = computed(() => {
  const scenario = activeScenario.value;
  if (activeCodeTab.value === 'cli') {
    return scenario.cliSnippet;
  }
  if (activeCodeTab.value === 'agent') {
    return scenario.agentPrompt;
  }
  return JSON.stringify(scenario.document, null, 2);
});

const jsonHref = computed(() => withBase(`/downloads/${activeScenario.value.id}.json`));
const htmlHref = computed(() => withBase(`/downloads/${activeScenario.value.id}.html`));

function formatContextReadings(ctx: InspectionContext): {
  mode: string;
  subject: string;
  pairs: ReadingPair[];
} {
  if (ctx.kind === 'trace') {
    return {
      mode: selected.value ? 'Pinned span' : 'Hovering span',
      subject: ctx.span.service ? `${ctx.span.name} (${ctx.span.service})` : ctx.span.name,
      pairs: [
        { label: 'durationNs', value: `${ctx.durationNs} ns` },
        { label: 'startTimeNs', value: `"${ctx.span.startTimeNs}"` },
        { label: 'endTimeNs', value: `"${ctx.span.endTimeNs}"` }
      ]
    };
  }
  if (ctx.kind === 'profile') {
    const location =
      ctx.frame.file && ctx.frame.line !== undefined
        ? `${ctx.frame.file}:${ctx.frame.line}`
        : (ctx.frame.file ?? '—');
    return {
      mode: selected.value ? 'Pinned frame' : 'Hovering frame',
      subject: ctx.frame.name,
      pairs: [
        { label: 'selfWeight', value: `"${ctx.frame.selfWeight}" ${ctx.unit}` },
        { label: 'totalWeight', value: `"${ctx.totalWeight}" ${ctx.unit}` },
        { label: 'source', value: location }
      ]
    };
  }
  const firstRow = ctx.rows[0] ?? [];
  const pairs: ReadingPair[] = ctx.fields.map((field, index) => {
    const raw = firstRow[index];
    const formatted =
      raw === null ? 'null' : typeof raw === 'string' ? `"${raw}"` : String(raw ?? '—');
    return { label: field.name, value: formatted };
  });
  return {
    mode: selected.value ? 'Pinned sample' : 'Hovering sample',
    subject: ctx.series ?? ctx.title ?? ctx.spec.visualization,
    pairs: pairs.slice(0, 4)
  };
}

const activeReadingSummary = computed(() => {
  const ctx = selected.value ?? inspected.value;
  if (!ctx) {
    return {
      mode: 'Exact readings',
      subject: activeScenario.value.baselineTitle,
      pairs: activeScenario.value.baselineReadings,
      isLive: false
    };
  }
  return {
    ...formatContextReadings(ctx),
    isLive: true
  };
});

function destroyView() {
  stopInteractions?.();
  stopInteractions = null;
  chartView?.dispose();
  chartView = null;
}

function mountChart() {
  if (!chartHost.value) {
    return;
  }
  destroyView();
  renderError.value = null;
  inspected.value = null;
  selected.value = null;

  const view = createVisualization(chartHost.value, activeScenario.value.document, {
    theme: isDark.value ? 'dark' : 'light',
    onInspect(_target, context) {
      inspected.value = context as InspectionContext | null;
    },
    onSelect(_target, context) {
      selected.value = context as InspectionContext | null;
    },
    onError(error) {
      renderError.value = error instanceof Error ? error.message : String(error);
    }
  });
  chartView = view;
  stopInteractions = enableInteractions(view);
}

function selectScenario(id: ScenarioId) {
  if (activeScenarioId.value === id) {
    return;
  }
  activeScenarioId.value = id;
}

function handleTabKeydown(event: KeyboardEvent, index: number) {
  let nextIndex = index;
  if (event.key === 'ArrowRight') {
    nextIndex = (index + 1) % scenarios.length;
  } else if (event.key === 'ArrowLeft') {
    nextIndex = (index - 1 + scenarios.length) % scenarios.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = scenarios.length - 1;
  } else {
    return;
  }
  event.preventDefault();
  const nextScenario = scenarios[nextIndex];
  selectScenario(nextScenario.id);
  void nextTick(() => {
    const target = document.getElementById(`sv-tab-${nextScenario.id}`);
    target?.focus();
  });
}

function clearPin() {
  selected.value = null;
  mountChart();
}

async function copySnippet() {
  try {
    await navigator.clipboard.writeText(activeSnippet.value);
    copied.value = true;
    if (copyResetTimer) {
      clearTimeout(copyResetTimer);
    }
    copyResetTimer = setTimeout(() => {
      copied.value = false;
    }, 1600);
  } catch {
    copied.value = false;
  }
}

watch(activeScenarioId, () => {
  void nextTick(() => {
    mountChart();
  });
});

watch(isDark, (dark) => {
  if (chartView) {
    chartView.theme = dark ? 'dark' : 'light';
  }
});

onMounted(() => {
  mountChart();
});

onBeforeUnmount(() => {
  destroyView();
  if (copyResetTimer) {
    clearTimeout(copyResetTimer);
  }
});
</script>

<template>
  <section class="sv-showcase" aria-labelledby="sv-showcase-heading">
    <div class="sv-showcase__header">
      <div class="sv-showcase__intro">
        <span class="sv-showcase__eyebrow">Live telemetry showcase</span>
        <h2 id="sv-showcase-heading" class="sv-showcase__heading">
          {{ activeScenario.headline }}
        </h2>
        <p class="sv-showcase__summary">
          {{ activeScenario.summary }}
        </p>
      </div>

      <div class="sv-showcase__tabs" role="tablist" aria-label="Telemetry scenarios">
        <button
          v-for="(scenario, index) in scenarios"
          :id="`sv-tab-${scenario.id}`"
          :key="scenario.id"
          type="button"
          role="tab"
          class="sv-showcase__tab"
          :class="{ 'is-active': scenario.id === activeScenario.id }"
          :aria-selected="scenario.id === activeScenario.id"
          :aria-controls="`sv-panel-${scenario.id}`"
          :tabindex="scenario.id === activeScenario.id ? 0 : -1"
          @click="selectScenario(scenario.id)"
          @keydown="handleTabKeydown($event, index)"
        >
          {{ scenario.tabLabel }}
        </button>
      </div>
    </div>

    <div
      :id="`sv-panel-${activeScenario.id}`"
      role="tabpanel"
      :aria-labelledby="`sv-tab-${activeScenario.id}`"
      class="sv-showcase__grid"
    >
      <div class="sv-showcase__stage">
        <div class="sv-showcase__canvas-shell">
          <div
            ref="chartHost"
            class="sv-showcase__canvas-host"
            :aria-label="`${activeScenario.tabLabel} interactive chart`"
          />
          <div v-if="renderError" class="sv-showcase__error" role="alert">
            {{ renderError }}
          </div>
        </div>

        <div class="sv-showcase__readout">
          <div class="sv-showcase__readout-top">
            <span class="sv-showcase__badge" :class="{ 'is-live': activeReadingSummary.isLive }">
              {{ activeReadingSummary.mode }}
            </span>
            <span class="sv-showcase__subject">{{ activeReadingSummary.subject }}</span>
            <button
              v-if="selected"
              type="button"
              class="sv-showcase__clear-btn"
              @click="clearPin"
            >
              Clear pin
            </button>
          </div>
          <dl class="sv-showcase__pairs">
            <div v-for="pair in activeReadingSummary.pairs" :key="pair.label" class="sv-showcase__pair">
              <dt>{{ pair.label }}</dt>
              <dd>{{ pair.value }}</dd>
            </div>
          </dl>
        </div>

        <div class="sv-showcase__downloads">
          <span class="sv-showcase__downloads-label">Reproduce locally:</span>
          <a :href="jsonHref" :download="`${activeScenario.id}.json`" class="sv-showcase__link-btn">
            Download {{ activeScenario.id }}.json
          </a>
          <a :href="htmlHref" target="_blank" rel="noopener" class="sv-showcase__link-btn">
            Open standalone {{ activeScenario.id }}.html
          </a>
        </div>
      </div>

      <div class="sv-showcase__code-panel">
        <div class="sv-showcase__code-bar">
          <div class="sv-showcase__code-tabs" role="tablist" aria-label="Reproduction mode">
            <button
              v-for="tab in codeTabs"
              :key="tab.id"
              type="button"
              role="tab"
              class="sv-showcase__code-tab"
              :class="{ 'is-active': activeCodeTab === tab.id }"
              :aria-selected="activeCodeTab === tab.id"
              @click="activeCodeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>
          <button type="button" class="sv-showcase__copy-btn" @click="copySnippet">
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>
        <pre class="sv-showcase__pre"><code>{{ activeSnippet }}</code></pre>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sv-showcase {
  margin: 1.5rem 0 2.5rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  padding: 1.5rem;
}

.sv-showcase__header {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.sv-showcase__eyebrow {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
}

.sv-showcase__heading {
  margin: 0.25rem 0 0.35rem;
  border: 0;
  padding: 0;
  font-size: 1.35rem;
  line-height: 1.3;
  letter-spacing: -0.01em;
}

.sv-showcase__summary {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 0.95rem;
  line-height: 1.55;
  max-width: 72ch;
}

.sv-showcase__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.sv-showcase__tab {
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  padding: 0.45rem 0.95rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}

.sv-showcase__tab:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}

.sv-showcase__tab.is-active {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.sv-showcase__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 1.25rem;
  align-items: stretch;
}

.sv-showcase__stage {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.sv-showcase__canvas-shell {
  position: relative;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
  padding: 0.75rem;
  min-height: 300px;
  display: flex;
  flex-direction: column;
}

.sv-showcase__canvas-host {
  width: 100%;
  min-height: 276px;
  flex: 1;
}

.sv-showcase__error {
  margin-top: 0.5rem;
  color: var(--vp-c-danger-1);
  font-size: 0.85rem;
}

.sv-showcase__readout {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
  padding: 0.75rem 0.9rem;
}

.sv-showcase__readout-top {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}

.sv-showcase__badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
}

.sv-showcase__badge.is-live {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.sv-showcase__subject {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--vp-c-text-1);
}

.sv-showcase__clear-btn {
  margin-left: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: transparent;
  color: var(--vp-c-text-2);
  padding: 0.15rem 0.5rem;
  font-size: 0.75rem;
  cursor: pointer;
}

.sv-showcase__clear-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.sv-showcase__pairs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
  gap: 0.5rem 0.9rem;
  margin: 0;
}

.sv-showcase__pair {
  min-width: 0;
}

.sv-showcase__pair dt {
  font-size: 0.72rem;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}

.sv-showcase__pair dd {
  margin: 0.1rem 0 0;
  font-size: 0.82rem;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-1);
  overflow-wrap: anywhere;
}

.sv-showcase__downloads {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.82rem;
}

.sv-showcase__downloads-label {
  color: var(--vp-c-text-2);
}

.sv-showcase__link-btn {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-brand-1);
  padding: 0.28rem 0.65rem;
  font-weight: 500;
  text-decoration: none;
}

.sv-showcase__link-btn:hover {
  border-color: var(--vp-c-brand-1);
}

.sv-showcase__code-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-code-block-bg);
  overflow: hidden;
}

.sv-showcase__code-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
}

.sv-showcase__code-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.sv-showcase__code-tab {
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--vp-c-text-2);
  padding: 0.3rem 0.6rem;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
}

.sv-showcase__code-tab.is-active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.sv-showcase__copy-btn {
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
  cursor: pointer;
}

.sv-showcase__copy-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}

.sv-showcase__pre {
  margin: 0;
  padding: 0.9rem 1rem;
  flex: 1;
  overflow: auto;
  font-size: 0.8rem;
  line-height: 1.55;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-1);
  max-height: 410px;
}

@media (max-width: 959px) {
  .sv-showcase__grid {
    grid-template-columns: 1fr;
  }
}
</style>
