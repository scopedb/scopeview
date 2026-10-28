/** Host-only policy: deliberately separate from the user's field/chart configuration. */
export type ChartColorStrategy = 'auto' | 'consistent' | 'ranked' | 'semantic';

export type SemanticFamily = 'level' | 'status' | 'http';

/** Explicit field-name rules; result values never choose the automatic strategy. */
export function semanticFamily(field: string | undefined): SemanticFamily | null {
  const key = field?.trim().toLowerCase().replace(/^@/, '').replace(/[.-]/g, '_') ?? '';
  if (/(^|_)(http_status_code|status_code)$/.test(key)) return 'http';
  if (/(^|_)(level|severity|loglevel)$/.test(key)) return 'level';
  if (/(^|_)status$/.test(key)) return 'status';
  return null;
}

type SemanticRole =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'critical'
  | 'debug'
  | 'trace'
  | 'unknown';
const meanings: Record<string, SemanticRole> = {
  info: 'info',
  informational: 'info',
  information: 'info',
  notice: 'info',
  running: 'info',
  active: 'info',
  started: 'info',
  ok: 'success',
  success: 'success',
  successful: 'success',
  succeeded: 'success',
  pass: 'success',
  passed: 'success',
  healthy: 'success',
  complete: 'success',
  completed: 'success',
  warn: 'warning',
  warning: 'warning',
  pending: 'warning',
  degraded: 'warning',
  err: 'error',
  error: 'error',
  fail: 'error',
  failed: 'error',
  failure: 'error',
  unhealthy: 'error',
  timeout: 'error',
  timed_out: 'error',
  fatal: 'critical',
  critical: 'critical',
  crit: 'critical',
  alert: 'critical',
  emerg: 'critical',
  emergency: 'critical',
  debug: 'debug',
  trace: 'trace'
};

export function semanticPaint(value: string, family: SemanticFamily | null) {
  const normalized = value.trim().toLowerCase();
  let role: SemanticRole = Object.hasOwn(meanings, normalized) ? meanings[normalized] : 'unknown';
  // Generic status fields often contain HTTP codes. Bare levels (for example 1–5)
  // have no universal severity convention and must remain neutral.
  if (family !== 'level' && /^[1-5]\d\d$/.test(normalized)) {
    const code = Number(normalized);
    role =
      code < 200
        ? 'info'
        : code < 300
          ? 'success'
          : code < 400
            ? 'info'
            : code < 500
              ? 'warning'
              : 'error';
  }
  return {
    color: `var(--color-chart-semantic-${role})`,
    lineColor: `var(--color-chart-semantic-${role}-line)`,
    lineType: role === 'trace' ? ('dashed' as const) : ('solid' as const)
  };
}

export function effectiveColorStrategy(
  strategy: ChartColorStrategy,
  field: string | undefined,
  singleMetric: boolean
): Exclude<ChartColorStrategy, 'auto'> | 'theme' {
  if (strategy === 'semantic') return field ? 'semantic' : singleMetric ? 'theme' : 'consistent';
  if (strategy !== 'auto') return strategy;
  if (semanticFamily(field)) return 'semantic';
  return !field && singleMetric ? 'theme' : 'consistent';
}
