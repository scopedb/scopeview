import { compileProfile, createProfileView, type ProfileFrame } from './families/profile.js';
import { createHierarchy } from './views/hierarchy.js';
import type { ViewOptions } from './views/view.js';

export function createFlame(
  host: HTMLElement,
  document: unknown,
  options: ViewOptions<ProfileFrame> = {}
) {
  return createHierarchy(
    host,
    document,
    (value) => createProfileView(compileProfile(value)),
    options
  );
}
export type { ChartView, ChartTheme, ThemeConfig, ThemeMode, ViewOptions } from './views/view.js';
export type { ProfileDocument } from './families/profile.js';
