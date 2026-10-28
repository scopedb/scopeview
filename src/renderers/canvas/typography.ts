import { labelSize as tokenLabelSize } from '../../theme/visual-tokens.js';

/** One font for Canvas layout, fitting, rulers and paint. */
export function canvasFont(element: HTMLElement) {
  const style = getComputedStyle(element);
  const scale = Number(style.getPropertyValue('--scope-chart-font-scale')) || 1;
  return `${tokenLabelSize * scale}px ${style.fontFamily}`;
}
