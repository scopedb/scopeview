import type { InjectionKey, Ref } from 'vue';

// VitePress's route.path excludes query strings, including same-page family links.
export const demoRouteVersion: InjectionKey<Ref<number>> = Symbol('demo route version');
