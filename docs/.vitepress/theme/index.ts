import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import { ref } from 'vue';
import ChartDemo from './ChartDemo.vue';
import HeadlessDemo from './HeadlessDemo.vue';
import { demoRouteVersion } from './demo-route.js';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app, router }) {
    app.component('ChartDemo', ChartDemo);
    app.component('HeadlessDemo', HeadlessDemo);
    const version = ref(0);
    app.provide(demoRouteVersion, version);
    const afterRouteChange = router.onAfterRouteChange;
    router.onAfterRouteChange = async (to) => {
      await afterRouteChange?.(to);
      version.value++;
    };
  }
} satisfies Theme;
