import type { Interaction } from '../core/interaction.js';
import type { ComponentOptions, ScopeChartAction } from '../families/component-options.js';
export type { ScopeChartAction } from '../families/component-options.js';

export interface ScopeChartControl {
  action: ScopeChartAction;
  label: string;
  disabled: boolean;
  expanded?: boolean;
}

export interface ScopeControlsChangeDetail {
  controls: ScopeChartControl[];
}

export const metricControls = {
  inspect: '.inspect',
  'toggle-data': '.data',
  'show-all': '.restore'
} as const;

export const hierarchyControls = {
  inspect: '.inspect',
  'zoom-in': '.zoom-in',
  'zoom-out': '.zoom-out',
  'reset-view': '.reset',
  'toggle-collapse': '.collapse',
  'toggle-data': '.data'
} as const;

/** Snapshot the component's canonical controls, including controls replaced by a host slot. */
export function readControls(
  root: ShadowRoot,
  selectors: Partial<Record<ScopeChartAction, string>>,
  options?: ComponentOptions & { interactive?: boolean }
): ScopeChartControl[] {
  return Object.entries(selectors).map(([action, selector]) => {
    const button = root.querySelector<HTMLButtonElement>(selector)!;
    return {
      action: action as ScopeChartAction,
      label: button.getAttribute('aria-label') ?? button.textContent!.trim(),
      disabled:
        button.disabled ||
        !root.host.isConnected ||
        (action === 'toggle-data' ? options?.dataTable === false : options?.interactive === false),
      ...(button.hasAttribute('aria-expanded')
        ? { expanded: button.getAttribute('aria-expanded') === 'true' }
        : {})
    };
  });
}

export function visibleControls(
  root: ShadowRoot,
  selectors: Partial<Record<ScopeChartAction, string>>,
  options?: ComponentOptions & { interactive?: boolean }
) {
  const actions = typeof options?.toolbar === 'object' ? options.toolbar.actions : undefined;
  return readControls(root, selectors, options).filter(
    (control) =>
      (!actions || actions.includes(control.action)) &&
      (control.action !== 'toggle-data' || options?.dataTable !== false)
  );
}

export function renderToolbar(
  root: ShadowRoot,
  options: (ComponentOptions & { interactive?: boolean }) | undefined,
  selectors: Partial<Record<ScopeChartAction, string>>,
  hidden = false
) {
  const controls = visibleControls(root, selectors, options);
  for (const [action, selector] of Object.entries(selectors))
    root.querySelector<HTMLElement>(selector)!.hidden = !controls.some(
      (control) => control.action === action
    );
  const attribution = root.querySelector<HTMLElement>('.attribution')!;
  attribution.hidden =
    typeof options?.toolbar === 'object' && options.toolbar.attribution === false;
  const group = root.querySelector<HTMLElement>('.toolbar-group');
  if (group)
    group.hidden = [...group.querySelectorAll<HTMLElement>('button')].every(
      (button) => button.hidden
    );
  const slot = root.querySelector<HTMLSlotElement>('slot[name="toolbar"]')!;
  slot.hidden = hidden || options?.toolbar === false;
  root.querySelector<HTMLElement>('.toolbar')!.hidden =
    slot.hidden || slot.assignedElements().length > 0 || (!controls.length && attribution.hidden);
}

export class ControlEvents {
  #previous = '';
  #key = {};
  constructor(private readonly interaction: Interaction) {}
  notify(host: HTMLElement, controls: ScopeChartControl[]) {
    this.interaction.effect(
      () => {
        const current = JSON.stringify(controls);
        if (current === this.#previous) return;
        this.#previous = current;
        host.dispatchEvent(
          new CustomEvent<ScopeControlsChangeDetail>('scope-controls-change', {
            detail: { controls },
            bubbles: true,
            composed: true
          })
        );
      },
      this.#key,
      1
    );
  }
}

export function inspectionFocus(root: ShadowRoot): HTMLElement {
  const slot = root.querySelector<HTMLSlotElement>('slot[name="toolbar"]')!;
  return root.querySelector<HTMLElement>(
    slot.hidden ||
      slot.assignedElements().length ||
      root.querySelector<HTMLElement>('.inspect')!.hidden
      ? '.viewport'
      : '.inspect'
  )!;
}
