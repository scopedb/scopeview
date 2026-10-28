import { compileProfile, createProfileView, type ProfileFrame } from './families/profile.js';
import { createHierarchy } from './views/hierarchy.js';
import type { ViewOptions } from './views/view.js';
import { profileInspectionContext } from './families/hierarchy/inspection-context.js';

export function createFlame(
  host: HTMLElement,
  document: unknown,
  options: ViewOptions<ProfileFrame> = {}
) {
  return createHierarchy(
    host,
    document,
    compileProfile,
    createProfileView,
    profileInspectionContext,
    options
  );
}
export type { ChartView, ChartTheme, ThemeConfig, ThemeMode, ViewOptions } from './views/view.js';
export type { ProfileDocument } from './families/profile.js';
