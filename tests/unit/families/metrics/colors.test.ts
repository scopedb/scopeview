import { describe, expect, it } from 'vitest';
import { resultColumnId as id } from '../../../../src/data/result.js';
import { semanticFamily, semanticPaint } from '../../../../src/theme/colors.js';
import { buildChartDataset } from '../../../../src/families/metrics/dataset.js';
import { buildSeriesInfo, CHART_PALETTE } from '../../../../src/families/metrics/series.js';

const distribution = { kind: 'distribution' as const, category: id(0), value: id(1) };
const axis = { kind: 'axis' as const, x: id(0), y: [id(1)] };
function dataset(field: string, values: (string | null)[], amounts = values.map(() => '1')) {
  const rows = values.map((value, i) => [value, amounts[i]]);
  return buildChartDataset({
    fields: [
      { name: field, data_type: 'string' },
      { name: 'count', data_type: 'number' }
    ],
    rows
  });
}
const color = (role: string) => `var(--color-chart-semantic-${role})`;

describe('chart color strategies', () => {
  it('recognizes field roles, not arbitrary substrings or observed category values', () => {
    for (const field of [
      'level',
      'log.level',
      '@log_level',
      'severity',
      'event.status',
      'http.status_code'
    ])
      expect(semanticFamily(field)).not.toBeNull();
    for (const field of ['service', 'status_text', 'level_count', 'error_rate', 'severity_score'])
      expect(semanticFamily(field)).toBeNull();
    const ordinary = buildSeriesInfo(dataset('service', ['ERROR']), distribution);
    expect(ordinary[0].color).not.toBe(color('error'));
    expect(
      buildSeriesInfo(dataset('service', ['ERROR']), distribution, undefined, 'semantic')[0].color
    ).toBe(color('error'));
  });

  it('uses stable meaning-bearing colors for levels, aliases and independent subsets', () => {
    const values = ['INFO', ' warn ', 'ERROR', 'FATAL', 'debug', 'trace', 'vendor-custom'];
    const all = buildSeriesInfo(dataset('level', values), distribution);
    expect(all.map((item) => item.color)).toEqual(
      ['info', 'warning', 'error', 'critical', 'debug', 'trace', 'unknown'].map(color)
    );
    const subset = buildSeriesInfo(dataset('level', ['ERROR', 'INFO']), distribution);
    expect(subset).toEqual([all[2], all[0]]);
    expect(semanticPaint('warning', 'level')).toEqual(semanticPaint('WARN', 'level'));
    expect(semanticPaint('fatal', 'level').color).not.toBe(semanticPaint('error', 'level').color);
    expect(semanticPaint('__proto__', 'status').color).toBe(color('unknown'));
  });

  it('handles status words and HTTP families without treating numeric log levels as HTTP', () => {
    const values = [
      'success',
      'FAILED',
      'pending',
      'running',
      'cancelled',
      '200',
      '302',
      '404',
      '503',
      '600'
    ];
    expect(
      buildSeriesInfo(dataset('status', values), distribution).map((item) => item.color)
    ).toEqual(
      [
        'success',
        'error',
        'warning',
        'info',
        'unknown',
        'success',
        'info',
        'warning',
        'error',
        'unknown'
      ].map(color)
    );
    expect(semanticPaint('404', 'level').color).toBe(color('unknown'));
    expect(semanticPaint('2', 'level').color).toBe(color('unknown'));
  });

  it('keeps NULL, empty and literal NULL as distinct neutral breakdown identities', () => {
    const rows = [null, '', 'NULL', 'INFO'].map((value, i) => [
      `2026-09-15T0${i}:00:00Z`,
      value,
      '1'
    ]);
    const source = buildChartDataset({
      fields: [
        { name: 'time', data_type: 'timestamp' },
        { name: 'level', data_type: 'string' },
        { name: 'count', data_type: 'number' }
      ],
      rows
    });
    const mapping = { kind: 'axis' as const, x: id(0), y: [id(2)], groupBy: id(1) };
    const series = buildSeriesInfo(source, mapping);
    expect(series.map((item) => item.name)).toEqual(['NULL', '""', '"NULL"', 'INFO']);
    expect(series.slice(0, 3).map((item) => item.color)).toEqual([
      color('unknown'),
      color('unknown'),
      color('unknown')
    ]);
  });

  it('ranks totals with deterministic ties, preserves category order and supports explicit overrides', () => {
    const source = dataset('service', ['worker', 'api', 'edge'], ['5', '10', '10']);
    const ranked = buildSeriesInfo(source, axis, undefined, 'ranked')[0].categories!;
    expect(ranked.map((item) => item.name)).toEqual(['worker', 'api', 'edge']);
    expect(ranked.map((item) => item.color)).toEqual([
      CHART_PALETTE[2],
      CHART_PALETTE[0],
      CHART_PALETTE[1]
    ]);
    const reverse = buildSeriesInfo(
      dataset('service', ['edge', 'api', 'worker'], ['10', '10', '5']),
      distribution,
      undefined,
      'ranked'
    );
    expect(Object.fromEntries(reverse.map((item) => [item.name, item.color]))).toEqual(
      Object.fromEntries(ranked.map((item) => [item.name, item.color]))
    );
    const semantic = buildSeriesInfo(
      dataset('level', ['ERROR', 'INFO']),
      distribution,
      new Map([['ERROR', CHART_PALETTE[2]]])
    );
    expect(semantic.map((item) => item.color)).toEqual([CHART_PALETTE[2], color('info')]);
  });
});
