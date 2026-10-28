import { formatQuantity, type QuantityDisplay } from '../data/semantics.js';
import { node } from '../ui/dom.js';
import { ViewHost, type ChartTheme, type ChartView } from './host.js';
import styles from '../theme/scalar.css?inline';
import tokens from '../theme/scalar-tokens.css?inline';
import { object } from '../data/validation.js';

export interface ScalarValue {
  value: string | null;
  label?: string;
  display?: Omit<QuantityDisplay, 'field'>;
}
export type ScalarInput = ScalarValue | readonly ScalarValue[];

function parseValues(input: unknown): readonly ScalarValue[] {
  const values = Array.isArray(input) ? input : [input];
  for (const value of values) {
    const record = object(value, 'value', ['value', 'label', 'display']);
    const raw = record.value;
    if (
      raw !== null &&
      (typeof raw !== 'string' ||
        !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) ||
        (!/^[+-]?\d+$/.test(raw) && !Number.isFinite(Number(raw))))
    )
      throw new TypeError('A scalar must be a numeric string or null.');
    if ('label' in record && typeof record.label !== 'string')
      throw new TypeError('A scalar label must be a string.');
    const display = record.display;
    if (display !== undefined) {
      const format = object(display, 'display', ['divisor', 'unit', 'decimals']);
      if (
        typeof format.divisor !== 'string' ||
        !Number.isFinite(Number(format.divisor)) ||
        ('unit' in format && typeof format.unit !== 'string') ||
        ('decimals' in format && typeof format.decimals !== 'number')
      )
        throw new TypeError('Invalid scalar display.');
      formatQuantity('0', display as ScalarValue['display']);
    }
  }
  return values as ScalarValue[];
}

function content(values: readonly ScalarValue[]) {
  if (!values.length) {
    const empty = node('span', 'value-label', 'No data');
    empty.setAttribute('role', 'status');
    return [empty];
  }
  return values.map(({ value, label, display }) => {
    const group = node('div', 'value');
    if (label) group.append(node('span', 'value-label', label));
    const number = node('span', 'value-number', formatQuantity(value, display));
    if (value !== null) number.title = value;
    group.append(number);
    return group;
  });
}

/** Already validated values, shared by the scalar API and compiled metric documents. */
export function scalarView(
  host: HTMLElement,
  value: readonly ScalarValue[],
  options: { theme?: ChartTheme } = {}
) {
  const children = content(value);
  const frame = new ViewHost(host, styles, tokens, options.theme);
  frame.element.classList.add('scopeview-scalar');
  frame.element.dataset.state = 'ready';
  const values = node('div', 'values');
  values.append(...children);
  frame.root.append(values);
  return {
    update(value: readonly ScalarValue[]) {
      frame.assertActive();
      values.replaceChildren(...content(value));
    },
    get theme() {
      return frame.theme;
    },
    set theme(value: ChartTheme) {
      frame.theme = value;
    },
    refresh: () => frame.refresh(),
    dispose: () => frame.dispose()
  };
}

/** Intrinsic-size HTML readings. No Canvas, layout compiler, observer or pointer runtime. */
export function createScalar(
  host: HTMLElement,
  value: ScalarInput,
  options: { theme?: ChartTheme } = {}
): ChartView {
  object(options, 'options', ['theme']);
  const view: ChartView = scalarView(host, parseValues(value), options);
  const update = view.update;
  view.update = (value) => update(parseValues(value));
  return view;
}
export type { ChartView, ChartTheme, ThemeConfig, ThemeMode } from './host.js';
