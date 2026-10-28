import { describe, expect, it } from 'vitest';
import { resultColumnId } from '../../../../src/data/result.js';
import { compileAxisChartModel } from '../../../../src/families/metrics/model.js';
import { buildChartDataset } from '../../../../src/families/metrics/dataset.js';
import { buildSeriesInfo } from '../../../../src/families/metrics/series.js';

const dataset = buildChartDataset({
  fields: [
    { name: 'Time', data_type: 'timestamp' },
    { name: 'Group', data_type: 'string' },
    { name: 'Count', data_type: 'number' }
  ],
  rows: [
    ['2026-09-06T12:00:00Z', null, '0'],
    ['2026-09-06T12:00:00Z', 'NULL', '2'],
    ['2026-09-06T13:00:00Z', null, null],
    ['2026-09-06T15:00:00Z', null, '3']
  ]
});
const mapping = {
  kind: 'axis' as const,
  x: resultColumnId(0),
  y: [resultColumnId(2)],
  groupBy: resultColumnId(1)
};
describe('time-series semantic models', () => {
  it('keeps exact zero, NULL samples, absent buckets and source rows distinct', () => {
    const model = compileAxisChartModel(dataset, mapping, {
      kind: 'buckets',
      field: mapping.x,
      intervalMs: 3_600_000,
      coverage: 'limited'
    });
    expect(model.kind).toBe('time-series');
    if (model.kind !== 'time-series' || model.sampling !== 'buckets')
      throw Error('Expected buckets');
    expect(model.samples.map((sample) => [sample.series, sample.value, sample.state])).toEqual([
      ['NULL', 0, 'value'],
      ['"NULL"', 2, 'value'],
      ['NULL', null, 'null'],
      ['NULL', 3, 'value']
    ]);
    expect(model.gaps).toEqual([
      {
        start: Date.parse('2026-09-06T14:00:00Z'),
        end: Date.parse('2026-09-06T15:00:00Z'),
        state: 'not-returned'
      }
    ]);
    expect(model.coverage).toBe('limited');
    expect(model.samples[0].source).toBe(dataset.rows[0].source);
    expect(model.samples).toHaveLength(dataset.rows.length);
    expect(buildSeriesInfo(dataset, mapping).map((series) => series.name)).toEqual([
      'NULL',
      '"NULL"'
    ]);
  });
  it('gives a single observed bucket its complete interval', () => {
    const source = {
      kind: 'buckets' as const,
      field: mapping.x,
      intervalMs: 3_600_000,
      coverage: 'unknown' as const
    };
    const model = compileAxisChartModel(
      { ...dataset, rows: dataset.rows.slice(0, 1) },
      mapping,
      source
    );
    expect(model).toMatchObject({
      domain: { start: Date.parse('2026-09-06T12:00:00Z'), end: Date.parse('2026-09-06T13:00:00Z') }
    });
  });
  it('does not infer a cadence for Query points', () => {
    const model = compileAxisChartModel(dataset, mapping);
    expect(model).toMatchObject({
      kind: 'time-series',
      sampling: 'points',
      domain: { source: 'observed' }
    });
    expect(model.positions).toHaveLength(3);
    expect('intervalMs' in model).toBe(false);
  });
  it('retains an executed window for an empty bucket result', () => {
    const window = { start: Date.parse('2026-09-06'), end: Date.parse('2026-09-13') };
    const model = compileAxisChartModel({ ...dataset, rows: [] }, mapping, {
      kind: 'buckets',
      field: mapping.x,
      intervalMs: 3_600_000,
      coverage: 'complete',
      window
    });
    expect(model).toMatchObject({
      domain: { ...window, source: 'executed' },
      samples: [],
      positions: [],
      gaps: []
    });
  });
  it('rejects mismatched metadata instead of silently degrading to a different time axis', () => {
    expect(() =>
      compileAxisChartModel(dataset, mapping, {
        kind: 'buckets',
        field: resultColumnId(1),
        intervalMs: 1000,
        coverage: 'unknown'
      })
    ).toThrow('does not match');
    expect(() =>
      compileAxisChartModel(dataset, mapping, {
        kind: 'buckets',
        field: mapping.x,
        intervalMs: 0,
        coverage: 'unknown'
      })
    ).toThrow('positive interval');
  });
});
