<script setup lang="ts">
import { useData, withBase } from 'vitepress';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { InspectionContext } from '../../../src/core/inspection-context.js';
import type { ChartView } from '../../../src/views/view.js';
import {
  BUNDLE_DOC_URL,
  type LandingScenarioId,
  REPO_URL,
  familyGroups,
  heroStats,
  installOptions,
  landingScenarios,
  principles,
  workflows
} from '../landing-data.js';
import CodeBlock from './CodeBlock.vue';
import './landing.css';

const { isDark } = useData();

const activeScenarioId = ref<LandingScenarioId>('trace');
const activeWorkflowId = ref<string>(workflows[0].id);
const activeInstallId = ref<string>(installOptions[0].id);

const chartHost = ref<HTMLElement | null>(null);
const chartReady = ref(false);
const renderError = ref<string | null>(null);
const inspected = ref<InspectionContext | null>(null);
const selected = ref<InspectionContext | null>(null);

const codeCopied = ref(false);
const installCopied = ref(false);

let createFn: typeof import('../../../src/headless.js').createVisualization | null = null;
let enableFn: typeof import('../../../src/interactions.js').enableInteractions | null = null;
let chartView: ChartView | null = null;
let stopInteractions: (() => void) | null = null;
let disposed = false;
let codeCopyTimer: ReturnType<typeof setTimeout> | null = null;
let installCopyTimer: ReturnType<typeof setTimeout> | null = null;

const activeScenario = computed(
  () => landingScenarios.find((item) => item.id === activeScenarioId.value) ?? landingScenarios[0]
);

const activeWorkflow = computed(
  () => workflows.find((item) => item.id === activeWorkflowId.value) ?? workflows[0]
);

const activeInstall = computed(
  () => installOptions.find((item) => item.id === activeInstallId.value) ?? installOptions[0]
);

const jsonHref = computed(() => withBase(`/downloads/${activeScenario.value.id}.json`));
const htmlHref = computed(() => withBase(`/downloads/${activeScenario.value.id}.html`));

function formatLiveReading(ctx: InspectionContext): { subject: string; detail: string } {
  if (ctx.kind === 'trace') {
    const subject = ctx.span.service ? `${ctx.span.name} (${ctx.span.service})` : ctx.span.name;
    const startTail = ctx.span.startTimeNs.slice(-9);
    const endTail = ctx.span.endTimeNs.slice(-9);
    return {
      subject,
      detail: `${ctx.durationNs} ns · "…${startTail}" → "…${endTail}"`
    };
  }
  if (ctx.kind === 'profile') {
    const location =
      ctx.frame.file && ctx.frame.line !== undefined
        ? `${ctx.frame.file}:${ctx.frame.line}`
        : (ctx.frame.file ?? '');
    return {
      subject: ctx.frame.name,
      detail: [`self "${ctx.frame.selfWeight}" ${ctx.unit}`, location].filter(Boolean).join(' · ')
    };
  }
  const row = ctx.rows[0] ?? [];
  const timeVal = row[0] !== undefined ? String(row[0]).replace('2026-10-27T', '') : '';
  const values = ctx.fields.slice(1).map((field, idx) => {
    const raw = row[idx + 1];
    const formatted = raw === null ? 'null' : typeof raw === 'string' ? `"${raw}"` : String(raw);
    return `${field.name}: ${formatted}`;
  });
  return {
    subject: timeVal || ctx.series || ctx.spec.visualization,
    detail: values.join(' · ')
  };
}

const statusReadout = computed(() => {
  const ctx = selected.value ?? inspected.value;
  if (!ctx) {
    return {
      isLive: false,
      isPinned: false,
      subject: '',
      detail: activeScenario.value.defaultNote
    };
  }
  const formatted = formatLiveReading(ctx);
  return {
    isLive: true,
    isPinned: selected.value !== null,
    subject: formatted.subject,
    detail: formatted.detail
  };
});

function destroyChart() {
  stopInteractions?.();
  stopInteractions = null;
  chartView?.dispose();
  chartView = null;
}

function mountChart() {
  if (!chartHost.value || !createFn || !enableFn || disposed) {
    return;
  }
  destroyChart();
  renderError.value = null;
  inspected.value = null;
  selected.value = null;

  const view = createFn(chartHost.value, activeScenario.value.document, {
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
  stopInteractions = enableFn(view);
}

function selectScenario(id: LandingScenarioId) {
  if (activeScenarioId.value === id) return;
  activeScenarioId.value = id;
}

function onScenarioKeydown(event: KeyboardEvent, index: number) {
  let nextIndex = index;
  if (event.key === 'ArrowRight') nextIndex = (index + 1) % landingScenarios.length;
  else if (event.key === 'ArrowLeft')
    nextIndex = (index - 1 + landingScenarios.length) % landingScenarios.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = landingScenarios.length - 1;
  else return;

  event.preventDefault();
  const next = landingScenarios[nextIndex];
  selectScenario(next.id);
  void nextTick(() => {
    document.getElementById(`sv-scenario-tab-${next.id}`)?.focus();
  });
}

function clearPin() {
  selected.value = null;
  mountChart();
}

async function copyText(text: string, target: 'code' | 'install') {
  try {
    await navigator.clipboard.writeText(text);
    if (target === 'code') {
      codeCopied.value = true;
      if (codeCopyTimer) clearTimeout(codeCopyTimer);
      codeCopyTimer = setTimeout(() => {
        codeCopied.value = false;
      }, 1400);
    } else {
      installCopied.value = true;
      if (installCopyTimer) clearTimeout(installCopyTimer);
      installCopyTimer = setTimeout(() => {
        installCopied.value = false;
      }, 1400);
    }
  } catch {
    // Ignore clipboard rejections in restricted contexts.
  }
}

watch(activeScenarioId, () => {
  void nextTick(mountChart);
});

watch(activeWorkflowId, () => {
  codeCopied.value = false;
});

watch(activeInstallId, () => {
  installCopied.value = false;
});

watch(isDark, (dark) => {
  if (chartView) {
    chartView.theme = dark ? 'dark' : 'light';
  }
});

onMounted(async () => {
  try {
    const [headlessMod, interactionsMod] = await Promise.all([
      import('../../../src/headless.js'),
      import('../../../src/interactions.js')
    ]);
    if (disposed) return;
    createFn = headlessMod.createVisualization;
    enableFn = interactionsMod.enableInteractions;
    mountChart();
    chartReady.value = true;
  } catch {
    if (!disposed) {
      renderError.value = 'Interactive preview could not initialize.';
    }
  }
});

onBeforeUnmount(() => {
  disposed = true;
  destroyChart();
  if (codeCopyTimer) clearTimeout(codeCopyTimer);
  if (installCopyTimer) clearTimeout(installCopyTimer);
});
</script>

<template>
  <div class="sv-landing" :data-theme="isDark ? 'dark' : 'light'">
    <!-- Hero -->
    <header class="sv-hero">
      <div class="sv-hero__grid-bg" aria-hidden="true" />
      <div class="sv-container">
        <div class="sv-hero__inner">
          <div class="sv-hero__copy">
            <span class="sv-eyebrow">@scopedb/scopeview</span>
            <h1 class="sv-hero__title">
              Small charts.<br />
              <span class="sv-hero__title-accent">Exact readings.</span>
            </h1>
            <p class="sv-hero__lede">
              Canvas charts, trace timelines, and flame graphs for TypeScript applications and CLI
              workflows. Source strings, 64-bit counters, and explicit nulls stay intact from JSON
              input to interactive inspection.
            </p>
            <div class="sv-hero__actions">
              <a :href="withBase('/getting-started.html')" class="sv-btn sv-btn--primary">
                Get started <span class="sv-btn__arrow" aria-hidden="true">→</span>
              </a>
              <a :href="withBase('/examples.html')" class="sv-btn sv-btn--secondary">
                Explore gallery
              </a>
            </div>
            <dl class="sv-hero__stats">
              <div v-for="stat in heroStats" :key="stat.label" class="sv-hero__stat">
                <dt class="sv-hero__stat-label">{{ stat.label }}</dt>
                <dd class="sv-hero__stat-value">{{ stat.value }}</dd>
              </div>
            </dl>
          </div>

          <div class="sv-hero__aside">
            <div class="sv-workbench">
              <div class="sv-workbench__bar">
                <div class="sv-workbench__tabs" role="tablist" aria-label="Telemetry examples">
                  <button
                    v-for="(scenario, index) in landingScenarios"
                    :id="`sv-scenario-tab-${scenario.id}`"
                    :key="scenario.id"
                    type="button"
                    role="tab"
                    class="sv-workbench__tab"
                    :class="{ 'is-active': scenario.id === activeScenario.id }"
                    :aria-selected="scenario.id === activeScenario.id"
                    :aria-controls="`sv-scenario-panel-${scenario.id}`"
                    :tabindex="scenario.id === activeScenario.id ? 0 : -1"
                    @click="selectScenario(scenario.id)"
                    @keydown="onScenarioKeydown($event, index)"
                  >
                    {{ scenario.label }}
                  </button>
                </div>
                <div class="sv-workbench__files">
                  <a
                    :href="jsonHref"
                    :download="`${activeScenario.id}.json`"
                    class="sv-workbench__file-link"
                    :title="`Download ${activeScenario.id}.json`"
                  >
                    <span class="sv-workbench__file-stem">{{ activeScenario.id }}</span
                    >.json ↓
                  </a>
                  <span class="sv-workbench__sep" aria-hidden="true">·</span>
                  <a
                    :href="htmlHref"
                    target="_blank"
                    rel="noopener"
                    class="sv-workbench__file-link sv-workbench__file-link--html"
                    :title="`Open standalone ${activeScenario.id}.html`"
                  >
                    .html ↗
                  </a>
                </div>
              </div>

              <div
                :id="`sv-scenario-panel-${activeScenario.id}`"
                role="tabpanel"
                :aria-labelledby="`sv-scenario-tab-${activeScenario.id}`"
                class="sv-workbench__stage"
                :aria-busy="!chartReady && !renderError"
              >
                <div
                  ref="chartHost"
                  class="sv-workbench__canvas"
                  style="--scope-chart-height: 236px"
                />
                <p v-if="!chartReady && !renderError" class="sv-workbench__placeholder" role="status">
                  Loading interactive chart…
                </p>
                <p v-if="renderError" class="sv-workbench__placeholder is-error" role="alert">
                  {{ renderError }}
                </p>
              </div>

              <div class="sv-workbench__footer">
                <div class="sv-workbench__reading" :title="statusReadout.detail">
                  <span
                    class="sv-workbench__dot"
                    :class="{
                      'is-live': statusReadout.isLive,
                      'is-pinned': statusReadout.isPinned
                    }"
                    aria-hidden="true"
                  />
                  <strong v-if="statusReadout.subject" class="sv-workbench__subject">
                    {{ statusReadout.subject }}
                  </strong>
                  <span class="sv-workbench__detail">{{ statusReadout.detail }}</span>
                </div>
                <button
                  v-if="statusReadout.isPinned"
                  type="button"
                  class="sv-workbench__reset"
                  @click="clearPin"
                >
                  Clear
                </button>
                <span v-else class="sv-workbench__hint">Hover or click</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- Design Principles -->
    <section class="sv-section" aria-labelledby="sv-principles-title">
      <div class="sv-container">
        <div class="sv-section__head">
          <span class="sv-eyebrow">Why ScopeView</span>
          <h2 id="sv-principles-title" class="sv-section__title">
            Fidelity first, from raw JSON to pixels.
          </h2>
          <p class="sv-section__lede">
            General-purpose dashboard charts parse numbers into IEEE-754 floats and smooth over
            missing buckets. ScopeView renders telemetry data without altering what was recorded.
          </p>
        </div>

        <div class="sv-hairline-grid sv-hairline-grid--three">
          <article v-for="item in principles" :key="item.index" class="sv-principle">
            <span class="sv-principle__index">{{ item.index }}</span>
            <h3 class="sv-principle__title">{{ item.title }}</h3>
            <p class="sv-principle__body">{{ item.body }}</p>
          </article>
        </div>
      </div>
    </section>

    <!-- Workflows Explorer -->
    <section class="sv-section sv-section--subtle" aria-labelledby="sv-workflows-title">
      <div class="sv-container">
        <div class="sv-section__head">
          <span class="sv-eyebrow">Integration</span>
          <h2 id="sv-workflows-title" class="sv-section__title">
            One document format across apps, CLIs, and agents.
          </h2>
          <p class="sv-section__lede">
            Author a <code>v1</code> snapshot once. Mount it in a TypeScript interface, register a
            Web Component, or export a single offline HTML file that travels with an answer.
          </p>
        </div>

        <div class="sv-explorer">
          <ul class="sv-explorer__nav">
            <li v-for="wf in workflows" :key="wf.id" class="sv-explorer__item">
              <button
                type="button"
                class="sv-explorer__choice"
                :class="{ 'is-active': wf.id === activeWorkflow.id }"
                :aria-pressed="wf.id === activeWorkflow.id"
                aria-controls="sv-workflow-preview"
                @click="activeWorkflowId = wf.id"
              >
                <span class="sv-explorer__choice-title">{{ wf.title }}</span>
                <span class="sv-explorer__choice-blurb">{{ wf.blurb }}</span>
              </button>
            </li>
          </ul>

          <div id="sv-workflow-preview" class="sv-code-window">
            <div class="sv-code-window__bar">
              <span class="sv-code-window__header">{{ activeWorkflow.header }}</span>
              <div class="sv-code-window__actions">
                <a :href="withBase(activeWorkflow.docHref)" class="sv-code-window__link">
                  {{ activeWorkflow.docLabel }} <span aria-hidden="true">→</span>
                </a>
                <button
                  type="button"
                  class="sv-code-window__copy"
                  @click="copyText(activeWorkflow.code, 'code')"
                >
                  {{ codeCopied ? 'Copied' : 'Copy' }}
                </button>
              </div>
            </div>
            <div class="sv-code-window__body">
              <CodeBlock
                :code="activeWorkflow.code"
                :language="activeWorkflow.language"
                :label="activeWorkflow.title"
              />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Views & Subpaths -->
    <section class="sv-section" aria-labelledby="sv-families-title">
      <div class="sv-container">
        <div class="sv-section__head">
          <span class="sv-eyebrow">Views &amp; Subpaths</span>
          <h2 id="sv-families-title" class="sv-section__title">
            Ten views, tree-shaken by entry point.
          </h2>
          <p class="sv-section__lede">
            Import only the visualization family your application needs, or use the standalone
            entry when rendering arbitrary snapshots.
          </p>
        </div>

        <div class="sv-hairline-grid sv-hairline-grid--two">
          <div v-for="group in familyGroups" :key="group.category" class="sv-family-group">
            <div class="sv-family-group__top">
              <h3 class="sv-family-group__title">{{ group.category }}</h3>
              <span class="sv-family-group__budget">{{ group.budget }}</span>
            </div>
            <code class="sv-family-group__entry">{{ group.entryPoint }}</code>
            <p class="sv-family-group__desc">{{ group.description }}</p>
            <div class="sv-family-group__chips">
              <a
                v-for="chip in group.chips"
                :key="chip.label"
                :href="withBase(chip.href)"
                class="sv-chip"
              >
                {{ chip.label }}
              </a>
            </div>
          </div>
        </div>

        <div class="sv-section__foot">
          <a :href="BUNDLE_DOC_URL" class="sv-text-link">
            Bundle size budgets <span aria-hidden="true">↗</span>
          </a>
          <a :href="withBase('/examples.html')" class="sv-btn sv-btn--secondary">
            Open live gallery <span class="sv-btn__arrow" aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </section>

    <!-- Final CTA -->
    <section class="sv-section sv-section--subtle" aria-labelledby="sv-cta-title">
      <div class="sv-container">
        <div class="sv-cta">
          <span class="sv-eyebrow sv-eyebrow--center">Start building</span>
          <h2 id="sv-cta-title" class="sv-cta__title">Render your first snapshot.</h2>
          <p class="sv-cta__lede">
            Install the package in TypeScript or export a standalone chart from the terminal with
            Node.js 24+.
          </p>

          <div class="sv-install">
            <div class="sv-install__tabs" role="tablist" aria-label="Install method">
              <button
                v-for="opt in installOptions"
                :key="opt.id"
                type="button"
                role="tab"
                class="sv-install__tab"
                :class="{ 'is-active': opt.id === activeInstall.id }"
                :aria-selected="opt.id === activeInstall.id"
                @click="activeInstallId = opt.id"
              >
                {{ opt.label }}
              </button>
            </div>
            <div class="sv-install__bar">
              <code class="sv-install__cmd">
                <span class="sv-install__prompt" aria-hidden="true">$</span>
                {{ activeInstall.command }}
              </code>
              <button
                type="button"
                class="sv-install__copy"
                @click="copyText(activeInstall.command, 'install')"
              >
                {{ installCopied ? 'Copied' : 'Copy' }}
              </button>
            </div>
          </div>

          <div class="sv-cta__actions">
            <a :href="withBase('/getting-started.html')" class="sv-btn sv-btn--primary">
              Get started <span class="sv-btn__arrow" aria-hidden="true">→</span>
            </a>
            <a :href="withBase('/cli.html')" class="sv-btn sv-btn--secondary">CLI reference</a>
            <a :href="REPO_URL" class="sv-btn sv-btn--secondary">View on GitHub</a>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

