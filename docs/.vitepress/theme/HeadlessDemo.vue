<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useData } from 'vitepress';
import { demoDocument, families, type DemoFamily } from './demo-data.js';
import type { ChartView } from '../../../src/headless.js';
import DemoFamilies from './DemoFamilies.vue';
import './chart-demo.css';

const host = ref<HTMLElement>();
const family = ref<DemoFamily>('line');
const failure = ref('');
const ready = ref(false);
const description = computed(
  () => families.find((item) => item.value === family.value)!.description
);
const { isDark } = useData();
let chart: ChartView | undefined;
let create: typeof import('../../../src/headless.js').createVisualization | undefined;
let disposed = false;
function mount() {
  if (!host.value || !create || disposed) return;
  chart?.dispose();
  chart = create(host.value, demoDocument(family.value), {
    theme: isDark.value ? 'dark' : 'light'
  });
}
onMounted(async () => {
  try {
    create = (await import('../../../src/headless.js')).createVisualization;
    mount();
    if (!disposed) ready.value = true;
  } catch {
    if (!disposed) failure.value = 'The chart could not load.';
  }
});
watch(family, mount);
watch(isDark, () => {
  if (chart) chart.theme = isDark.value ? 'dark' : 'light';
});
onBeforeUnmount(() => {
  disposed = true;
  chart?.dispose();
});
</script>

<template>
  <section class="chart-demo headless-demo" aria-label="Interactive headless chart example">
    <div class="demo-workbench">
      <div class="demo-toolbar"><DemoFamilies v-model="family" :items="families" /></div>
      <div class="headless-demo-stage" :aria-busy="!ready && !failure">
        <div ref="host" class="demo-chart" style="--scope-chart-height: 260px"></div>
        <p v-if="!ready" class="headless-demo-status" role="status">{{ failure || 'Loading interactive chart…' }}</p>
      </div>
      <div class="demo-caption">
        <p>{{ description }}</p>
        <p>Hover or focus to read <span>·</span> Synthetic data</p>
      </div>
    </div>
  </section>
</template>
