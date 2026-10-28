<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { VPButton } from 'vitepress/theme';
import type { DemoFamily } from './demo-data.js';

const props = defineProps<{ items: { value: DemoFamily; label: string }[] }>();
const family = defineModel<DemoFamily>({ required: true });
const id = `${useId()}-families`;
const picker = ref<HTMLElement>();
const menu = ref<HTMLElement>();
const open = ref(false);
const placement = ref<Record<string, string>>({});
const selected = computed(() => props.items.find((item) => item.value === family.value));
const categories: { label: string; values: DemoFamily[] }[] = [
  { label: 'Time trends', values: ['line', 'area'] },
  { label: 'Comparisons', values: ['bar', 'ranked', 'value'] },
  { label: 'Relationships & composition', values: ['scatter', 'donut', 'treemap'] },
  { label: 'Tracing & profiling', values: ['trace', 'profile'] }
];
const groups = computed(() =>
  categories
    .map((group, index) => ({
      label: group.label,
      id: `${id}-${index}`,
      items: props.items.filter((item) => group.values.includes(item.value))
    }))
    .filter((group) => group.items.length)
);

function closeMenu() {
  if (menu.value?.matches(':popover-open')) menu.value.hidePopover();
}
function beforeToggle(event: Event) {
  if ((event as ToggleEvent).newState !== 'open') return;
  const button = picker.value?.querySelector('button');
  if (!button) return;
  const bounds = button.getBoundingClientRect();
  const width = Math.min(400, window.innerWidth - 32);
  const below = window.innerHeight - bounds.bottom - 16;
  const above = bounds.top - 16;
  const downward = below >= above;
  placement.value = {
    left: `${Math.max(16, Math.min(bounds.left, window.innerWidth - width - 16))}px`,
    top: downward ? `${bounds.bottom + 8}px` : 'auto',
    bottom: downward ? 'auto' : `${window.innerHeight - bounds.top + 8}px`,
    maxHeight: `${Math.max(64, downward ? below : above)}px`
  };
}
function onToggle(event: Event) {
  open.value = (event as ToggleEvent).newState === 'open';
}
function choose(value: DemoFamily) {
  family.value = value;
  closeMenu();
  picker.value?.querySelector('button')?.focus({ preventScroll: true });
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    closeMenu();
    return;
  }
  const buttons = [...(menu.value?.querySelectorAll<HTMLButtonElement>('[data-family]') ?? [])];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = buttons.length - 1;
  else if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
  else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
  else if (
    event.key.length === 1 &&
    event.key !== ' ' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault();
    buttons
      .slice(index + 1)
      .concat(buttons.slice(0, index + 1))
      .find((button) =>
        button.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase())
      )
      ?.focus();
    return;
  } else return;
  event.preventDefault();
  buttons[next]?.focus();
}
onMounted(() => {
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', closeMenu, { passive: true });
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', closeMenu);
  window.removeEventListener('scroll', closeMenu);
});
</script>

<template>
  <div ref="picker" class="demo-family-picker">
    <VPButton v-if="items.length > 1" type="button" :text="`${selected?.label || 'Choose chart'} ▾`" theme="alt" :popovertarget="id" :aria-controls="id" :aria-expanded="open" :aria-label="`Chart type: ${selected?.label || 'Choose chart'}`" aria-haspopup="menu" />
    <span v-else class="demo-family-current">{{ selected?.label }}</span>
    <div v-if="items.length > 1" :id="id" ref="menu" class="demo-family-menu" popover="auto" role="menu" aria-label="Chart type" :style="placement" @beforetoggle="beforeToggle" @toggle="onToggle" @keydown="onKeydown">
      <div class="demo-family-groups">
        <div v-for="group in groups" :key="group.id" role="group" :aria-labelledby="group.id">
          <div :id="group.id" class="demo-family-group-label">{{ group.label }}</div>
          <button v-for="item in group.items" :key="item.value" type="button" role="menuitemradio" :data-family="item.value" :aria-checked="family === item.value" :tabindex="family === item.value ? 0 : -1" :autofocus="family === item.value" @click="choose(item.value)">
            <span>{{ item.label }}</span>
            <svg v-if="family === item.value" aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m3 8 3 3 7-7" /></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
