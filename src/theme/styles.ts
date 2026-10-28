import tokens from './tokens.css?inline';
import styles from './components.css?inline';

export const SCOPE_CHART_TOKENS = tokens;
// Both inputs are CSS strings; token-only consumers can omit component style construction.
export const SCOPE_CHART_STYLES = /* @__PURE__ */ tokens.concat(styles);
