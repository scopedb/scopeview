<script setup lang="ts">
import { VPButton } from 'vitepress/theme';

const surface = defineModel<'auto' | 'light' | 'dark'>({ required: true });
const choices = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
] as const;
</script>

<template>
  <div class="demo-appearance" role="group" aria-label="Chart surface">
    <VPButton v-for="choice in choices" :key="choice.value" type="button" :text="choice.label" :theme="surface === choice.value ? 'brand' : 'alt'" :aria-pressed="surface === choice.value" @click="surface = choice.value" />
  </div>
</template>
