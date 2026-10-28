<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useData } from 'vitepress';
import type { SourceLanguage } from './demo-source.js';

const props = defineProps<{ code: string; language: SourceLanguage; label: string }>();
const { isDark } = useData();
const mounted = ref(false);
const highlighted = ref('');
let revision = 0;

watch([() => props.code, () => props.language, () => props.label, isDark, mounted], async () => {
  const current = ++revision;
  highlighted.value = '';
  if (!mounted.value) return;
  const { code, language, label } = props;
  const theme = isDark.value ? 'dark' : 'light';
  try {
    const { highlight } = await import('./highlight.js');
    const html = await highlight(code, language, theme, label);
    if (current === revision) highlighted.value = html;
  } catch {
    // Plain source remains readable and copyable if highlighting cannot load.
  }
});
onMounted(() => {
  mounted.value = true;
});
onBeforeUnmount(() => {
  revision++;
});
</script>

<template>
  <div v-if="highlighted" class="demo-code" data-highlighted="true" v-html="highlighted" />
  <div v-else class="demo-code"><pre tabindex="0" :aria-label="label"><code>{{ code }}</code></pre></div>
</template>
