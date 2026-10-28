import { describe, expect, it } from 'vitest';
import { type ResultField, type ResultSet, resultColumnId } from '../../../../src/data/result.js';

import {
  createChartSpec,
  resolveChartSpec,
  type ScatterMapping
} from '../../../../src/families/metrics/spec.js';
import {
  distributionCompatibility,
  validateChartConfig,
  validateMapping
} from '../../../../src/families/metrics/validation.js';
import {
  axisGroupSourceRows,
  prepareAxisData,
  prepareDistributionData,
  prepareScatterData
} from '../../../../src/families/metrics/prepared.js';
import { buildChartDataset } from '../../../../src/families/metrics/dataset.js';
import { buildSeriesInfo, CHART_PALETTE } from '../../../../src/families/metrics/series.js';
import { compactFormat, formatInspectionNumber } from '../../../../src/data/format.js';
import {
  formatTemporalTick,
  temporalStep,
  temporalTicks
} from '../../../../src/families/metrics/temporal-axis.js';

function resultSet(fields: ResultField[], rows: (string | null)[][]): ResultSet {
  return { fields, rows };
}

describe('chart dataset', () => {
  it('rejects unsupported types from untyped source objects instead of making categories', () => {
    const source = JSON.parse('{"fields":[{"name":"count","data_type":"int64"}],"rows":[["12"]]}');
    expect(() => buildChartDataset(source)).toThrow(
      'data_type: Expected string, number, timestamp.'
    );
  });
  it('parses typed timestamps as UTC and preserves the exact source value', () => {
    const rows = [
      ['2026-09-06 08:00:00.123456'],
      ['2026-09-06T16:00:00.123456+08:00'],
      ['2026-02-30T00:00:00Z']
    ];
    const dataset = buildChartDataset(resultSet([{ name: 'time', data_type: 'timestamp' }], rows));
    expect(dataset.rows.map((row) => row.values[0])).toEqual([
      new Date('2026-09-06T08:00:00.123Z'),
      new Date('2026-09-06T08:00:00.123Z'),
      null
    ]);
    expect(dataset.rows[0].source).toBe(rows[0]);
    expect(
      buildChartDataset(resultSet([{ name: 'time', data_type: 'string' }], rows)).columns[0].kind
    ).toBe('categorical');
  });
  it('shares stable positional column IDs with the result table and preserves source rows', () => {
    const source = ['left', '42'];
    const dataset = buildChartDataset(
      resultSet(
        [
          { name: 'value', data_type: 'string' },
          { name: 'value', data_type: 'number' }
        ],
        [source]
      )
    );

    expect(dataset.columns.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: resultColumnId(0), label: 'value · 1' },
      { id: resultColumnId(1), label: 'value · 2' }
    ]);
    expect(dataset.rows[0]?.source).toBe(source);
    expect(dataset.rows[0]?.values).toEqual(['left', 42]);
  });

  it('builds the dataset once per result set identity', () => {
    const source = resultSet(
      [
        { name: 'time', data_type: 'timestamp' },
        { name: 'requests', data_type: 'number' }
      ],
      [['2026-01-01T00:00:00Z', '10']]
    );
    const dataset = buildChartDataset(source);
    expect(buildChartDataset(source)).toBe(dataset);

    const rebuilt = buildChartDataset({ ...source });
    expect(rebuilt).not.toBe(dataset);
    expect(rebuilt).toEqual(dataset);
  });

  it('preserves numeric occurrences when other columns move', () => {
    const original = buildChartDataset(
      resultSet(
        [
          { name: 'value', data_type: 'string' },
          { name: 'value', data_type: 'number' },
          { name: 'value', data_type: 'number' },
          { name: 'segment', data_type: 'string' }
        ],
        [['label', '10', '0.9', 'Enterprise']]
      )
    );
    const spec = createChartSpec(original, {
      displayType: 'scatter',
      mapping: {
        kind: 'scatter',
        x: resultColumnId(1),
        y: resultColumnId(2),
        color: resultColumnId(3)
      }
    });

    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
    expect(spec).toMatchObject({
      visualization: 'scatter',
      encoding: {
        x: { name: 'value', occurrence: 0, data_type: 'number' },
        y: {
          name: 'value',
          occurrence: 1,
          data_type: 'number'
        },
        color: {
          name: 'segment',
          occurrence: 0,
          data_type: 'string'
        }
      }
    });

    const reordered = buildChartDataset(
      resultSet(
        [
          { name: 'segment', data_type: 'string' },
          { name: 'value', data_type: 'number' },
          { name: 'value', data_type: 'string' },
          { name: 'value', data_type: 'number' }
        ],
        [['Enterprise', '10', 'label', '0.9']]
      )
    );
    expect(resolveChartSpec(reordered, spec)).toEqual({
      config: {
        displayType: 'scatter',
        mapping: {
          kind: 'scatter',
          x: resultColumnId(1),
          y: resultColumnId(3),
          size: undefined,
          color: resultColumnId(0)
        }
      }
    });
  });
});

describe('chart preparation and validation', () => {
  it('keeps duplicate numeric column names independently addressable', () => {
    const source = ['10', '90', 'Enterprise'];
    const dataset = buildChartDataset(
      resultSet(
        [
          { name: 'value', data_type: 'number' },
          { name: 'value', data_type: 'number' },
          { name: 'segment', data_type: 'string' }
        ],
        [source, ['20', '80', 'Startup']]
      )
    );
    const mapping: ScatterMapping = {
      kind: 'scatter',
      x: resultColumnId(0),
      y: resultColumnId(1),
      color: resultColumnId(2)
    };
    const points = prepareScatterData(dataset, mapping);

    expect(points[0]).toMatchObject({ x: 10, y: 90, series: 'Enterprise' });
    expect(points[0]?.source).toBe(source);
  });

  it('rejects a negative business measure used as point area', () => {
    const dataset = buildChartDataset(
      resultSet(
        [
          { name: 'x', data_type: 'number' },
          { name: 'y', data_type: 'number' },
          { name: 'size', data_type: 'number' }
        ],
        [
          ['1', '2', '-3'],
          ['2', '3', '4']
        ]
      )
    );
    expect(
      validateChartConfig(dataset, {
        displayType: 'scatter',
        mapping: {
          kind: 'scatter',
          x: resultColumnId(0),
          y: resultColumnId(1),
          size: resultColumnId(2)
        }
      })
    ).toEqual({
      valid: false,
      error: 'Point size values must be non-negative.'
    });
  });

  it('rejects more than one metric when a category splits the series', () => {
    expect(
      validateMapping(timeseriesDataset(), {
        kind: 'axis',
        x: resultColumnId(0),
        y: [resultColumnId(2), resultColumnId(3)],
        groupBy: resultColumnId(1)
      })
    ).toEqual({
      valid: false,
      error: 'Series splitting supports one metric at a time.'
    });
  });

  it('rejects repeated X values within the same axis series', () => {
    const dataset = buildChartDataset(
      resultSet(
        [
          { name: 'event_type', data_type: 'string' },
          { name: 'revenue', data_type: 'number' }
        ],
        [
          ['purchase', '129.90'],
          ['purchase', '48.00']
        ]
      )
    );

    expect(
      validateChartConfig(dataset, {
        displayType: 'bar',
        mapping: {
          kind: 'axis',
          x: resultColumnId(0),
          y: [resultColumnId(1)]
        }
      })
    ).toEqual({
      valid: false,
      error:
        'This result has repeated X values within a series. Aggregate the rows or choose a different X field.'
    });
  });

  it('keeps timestamps distinct below millisecond precision', () => {
    const dataset = buildChartDataset(
      resultSet(
        [
          { name: 'time', data_type: 'timestamp' },
          { name: 'status', data_type: 'number' }
        ],
        [
          ['2026-09-14T11:29:30.446523256Z', '200'],
          ['2026-09-14T11:29:30.446551965Z', '200']
        ]
      )
    );

    expect(
      validateChartConfig(dataset, {
        displayType: 'line',
        mapping: { kind: 'axis', x: resultColumnId(0), y: [resultColumnId(1)] }
      })
    ).toEqual({ valid: true });
  });

  it('still rejects timestamps that repeat at full precision', () => {
    const dataset = buildChartDataset(
      resultSet(
        [
          { name: 'time', data_type: 'timestamp' },
          { name: 'status', data_type: 'number' }
        ],
        [
          ['2026-09-14T11:29:30.446523256Z', '200'],
          ['2026-09-14T11:29:30.446523256Z', '500']
        ]
      )
    );

    expect(
      validateChartConfig(dataset, {
        displayType: 'line',
        mapping: { kind: 'axis', x: resultColumnId(0), y: [resultColumnId(1)] }
      })
    ).toMatchObject({ valid: false });
  });

  it('returns every visible source row in an axis group', () => {
    const sources = [
      ['2026-01-01T00:00:00Z', 'us', '10'],
      ['2026-01-01T00:00:00Z', 'eu', '8'],
      ['2026-01-01T00:05:00Z', 'us', '12']
    ];
    const dataset = buildChartDataset(
      resultSet(
        [
          { name: 'timestamp', data_type: 'timestamp' },
          { name: 'region', data_type: 'string' },
          { name: 'requests', data_type: 'number' }
        ],
        sources
      )
    );
    const prepared = prepareAxisData(dataset, {
      kind: 'axis',
      x: resultColumnId(0),
      y: [resultColumnId(2)],
      groupBy: resultColumnId(1)
    });
    if (prepared.kind !== 'temporal') throw new TypeError('Expected temporal data');

    expect(axisGroupSourceRows(prepared.rows, new Date('2026-01-01T00:00:00Z'))).toEqual([
      sources[0],
      sources[1]
    ]);
    expect(
      axisGroupSourceRows(prepared.rows, new Date('2026-01-01T00:00:00Z'), new Set(['eu']))
    ).toEqual([sources[0]]);
  });

  it('prepares axis data once per dataset and mapping identity', () => {
    const dataset = buildChartDataset(
      resultSet(
        [
          { name: 'timestamp', data_type: 'timestamp' },
          { name: 'requests', data_type: 'number' }
        ],
        [
          ['2026-01-01T00:05:00Z', '12'],
          ['2026-01-01T00:00:00Z', '10']
        ]
      )
    );
    const mapping = { kind: 'axis' as const, x: resultColumnId(0), y: [resultColumnId(1)] };
    const prepared = prepareAxisData(dataset, mapping);
    expect(prepareAxisData(dataset, mapping)).toBe(prepared);
    expect(prepared.rows).toHaveLength(2);

    const remapped = prepareAxisData(dataset, {
      kind: 'axis',
      x: resultColumnId(0),
      y: [resultColumnId(1)]
    });
    expect(remapped).not.toBe(prepared);
    expect(remapped).toEqual(prepared);

    const reordered = prepareAxisData({ ...dataset, rows: [...dataset.rows].reverse() }, mapping);
    expect(reordered).not.toBe(prepared);
    expect(reordered).toEqual(prepared);
  });

  it('aggregates duplicate categories while retaining every contributing source row', () => {
    const first = ['us', '2'];
    const second = ['us', '5'];
    const dataset = buildChartDataset(
      resultSet(
        [
          { name: 'region', data_type: 'string' },
          { name: 'requests', data_type: 'number' }
        ],
        [first, ['eu', '3'], second]
      )
    );
    const mapping = {
      kind: 'distribution' as const,
      category: resultColumnId(0),
      value: resultColumnId(1)
    };
    const rows = prepareDistributionData(dataset, mapping);

    expect(rows.map(({ category, value }) => ({ category, value }))).toEqual([
      { category: 'us', value: 7 },
      { category: 'eu', value: 3 }
    ]);
    expect(rows[0]?.sources).toEqual([first, second]);
    expect(distributionCompatibility(dataset, mapping)).toEqual({
      compatible: true,
      categoryCount: 2,
      total: 10
    });
  });

  it('requires explicit viable donut fields and rejects negative values', () => {
    const dataset = buildChartDataset(
      resultSet(
        [
          { name: 'database', data_type: 'string' },
          { name: 'table', data_type: 'string' },
          { name: 'rows', data_type: 'number' }
        ],
        [
          ['analytics', 'events', '12'],
          ['analytics', 'sessions', '8']
        ]
      )
    );
    const mapping = {
      kind: 'distribution' as const,
      category: resultColumnId(1),
      value: resultColumnId(2)
    };
    expect(validateChartConfig(dataset, { displayType: 'pie', mapping }).valid).toBe(true);
    expect(
      validateChartConfig(dataset, {
        displayType: 'pie',
        mapping: { ...mapping, category: resultColumnId(0) }
      })
    ).toMatchObject({
      valid: false,
      error: 'Donut charts require at least two positive categories.'
    });

    const negative = buildChartDataset(
      resultSet(
        [
          { name: 'region', data_type: 'string' },
          { name: 'requests', data_type: 'number' }
        ],
        [
          ['us', '3'],
          ['eu', '-1']
        ]
      )
    );
    expect(
      validateChartConfig(negative, {
        displayType: 'pie',
        mapping: { kind: 'distribution', category: resultColumnId(0), value: resultColumnId(1) }
      })
    ).toMatchObject({ valid: false, error: 'Donut charts do not support negative values.' });
  });

  it('accepts explicit ID-named metrics and a single zero sample in every temporal style', () => {
    const dataset = buildChartDataset(
      resultSet(
        [
          { name: 'observed_at', data_type: 'timestamp' },
          { name: 'event_id', data_type: 'number' }
        ],
        [['2026-01-01T12:00:00Z', '0']]
      )
    );
    for (const displayType of ['line', 'area', 'bar'] as const)
      expect(
        validateChartConfig(dataset, {
          displayType,
          mapping: { kind: 'axis', x: resultColumnId(0), y: [resultColumnId(1)] }
        }).valid
      ).toBe(true);
  });

  it('retains paired line roles across independent subsets and hash collisions', () => {
    const fields: ResultField[] = [
      { name: 'service', data_type: 'string' },
      { name: 'count', data_type: 'number' }
    ];
    const mapping = {
      kind: 'distribution' as const,
      category: resultColumnId(0),
      value: resultColumnId(1)
    };
    const rows = Array.from({ length: 32 }, (_, i) => [
      `service-${String(i).padStart(2, '0')}`,
      '1'
    ]);
    const first = buildSeriesInfo(buildChartDataset(resultSet(fields, rows)), mapping);
    const next = buildSeriesInfo(
      buildChartDataset(resultSet(fields, [rows[7], rows[0], rows[4]])),
      mapping
    );
    const collision = first.find((series, i) =>
      first.slice(i + 1).some((other) => other.color === series.color)
    )!;
    const sameColor = first.find(
      (series) => series.name !== collision.name && series.color === collision.color
    )!;
    expect(sameColor.lineColor).toBe(collision.lineColor);
    expect(sameColor.lineType).toBe(collision.lineType);
    expect(first[2].lineType).toBe('dashed');
    expect(first[0].lineType).toBe('solid');
    expect(next).toEqual([first[7], first[0], first[4]]);
  });

  it('pins deterministic UTF-8 identities and honors explicit host colors', () => {
    const dataset = buildChartDataset(
      resultSet(
        [
          { name: 'service', data_type: 'string' },
          { name: 'count', data_type: 'number' }
        ],
        ['api', 'worker', 'edge', '服务', '😀'].map((name) => [name, '1'])
      )
    );
    const mapping = {
      kind: 'distribution' as const,
      category: resultColumnId(0),
      value: resultColumnId(1)
    };
    const series = buildSeriesInfo(dataset, mapping);
    expect(series.map((item) => item.color)).toEqual([8, 4, 3, 7, 7].map((i) => CHART_PALETTE[i]));
    const overridden = buildSeriesInfo(dataset, mapping, new Map([['api', CHART_PALETTE[0]]]));
    expect(overridden[0].color).toBe(CHART_PALETTE[0]);
    expect(overridden.slice(1)).toEqual(series.slice(1));
  });

  it('allocates the same field values consistently across fresh charts and value rankings', () => {
    const fields: ResultField[] = [
      { name: 'time', data_type: 'timestamp' },
      { name: 'service', data_type: 'string' },
      { name: 'count', data_type: 'number' }
    ];
    const rows = [
      ['2026-09-01T00:00:00Z', 'worker', '10'],
      ['2026-09-01T00:00:01Z', 'api', '20'],
      ['2026-09-01T00:00:02Z', 'edge', '30'],
      ['2026-09-01T00:00:03Z', 'NULL', '40'],
      ['2026-09-01T00:00:04Z', '', '50'],
      ['2026-09-01T00:00:05Z', '"quoted"', '60']
    ];
    const paints = (items: ReturnType<typeof buildSeriesInfo>) =>
      Object.fromEntries(
        items.map(({ name, color, lineColor, lineType }) => [name, { color, lineColor, lineType }])
      );
    const axis = buildSeriesInfo(buildChartDataset(resultSet(fields, rows)), {
      kind: 'axis',
      x: resultColumnId(0),
      y: [resultColumnId(2)],
      groupBy: resultColumnId(1)
    });
    const distribution = buildSeriesInfo(
      buildChartDataset(
        resultSet(
          fields,
          [...rows].reverse().map((row, i) => [row[0], row[1], String(i + 1)])
        )
      ),
      {
        kind: 'distribution',
        category: resultColumnId(1),
        value: resultColumnId(2)
      }
    );
    expect(paints(distribution)).toEqual(paints(axis));
    const scatter = buildSeriesInfo(buildChartDataset(resultSet(fields, rows)), {
      kind: 'scatter',
      x: resultColumnId(2),
      y: resultColumnId(2),
      color: resultColumnId(1)
    });
    expect(paints(scatter)).toEqual(paints(axis));
  });

  it('scopes category values by semantic field and keeps metric identity through column reorder', () => {
    const dimension = (name: string, values: string[]) =>
      buildSeriesInfo(
        buildChartDataset(
          resultSet(
            [
              { name, data_type: 'string' },
              { name: 'count', data_type: 'number' }
            ],
            values.map((value) => [value, '1'])
          )
        ),
        { kind: 'distribution', category: resultColumnId(0), value: resultColumnId(1) }
      );
    const service = dimension('service', ['api', 'worker']);
    const region = dimension('region', ['worker']);
    expect(dimension('region', ['worker', 'api'])[0].color).toBe(region[0].color);
    expect(dimension('service', ['worker'])[0].color).toBe(service[1].color);
    const fields: ResultField[] = [
      { name: 'count', data_type: 'number' },
      { name: 'latency', data_type: 'number' }
    ];
    const before = buildSeriesInfo(buildChartDataset(resultSet(fields, [['10', '2.5']])), {
      kind: 'aggregate',
      values: [resultColumnId(0), resultColumnId(1)]
    });
    const after = buildSeriesInfo(
      buildChartDataset(resultSet([...fields].reverse(), [['2.5', '10']])),
      { kind: 'aggregate', values: [resultColumnId(0), resultColumnId(1)] }
    );
    expect(after).toEqual([...before].reverse());
    const alone = buildSeriesInfo(
      buildChartDataset(resultSet([fields[1]], [['2.5']])),
      {
        kind: 'aggregate',
        values: [resultColumnId(0)]
      },
      undefined,
      'consistent'
    );
    expect(alone).toEqual([before[1]]);
  });
});

function timeseriesDataset() {
  return buildChartDataset(
    resultSet(
      [
        { name: 'timestamp', data_type: 'timestamp' },
        { name: 'region', data_type: 'string' },
        { name: 'requests', data_type: 'number' },
        { name: 'errors', data_type: 'number' }
      ],
      [['2026-01-01T00:00:00Z', 'us', '10', '1']]
    )
  );
}

describe('chart inspection formatting', () => {
  it('distinguishes subsecond ticks and hours across adjacent UTC dates', () => {
    expect(formatTemporalTick(new Date('2026-09-06T23:59:59.250Z'), 500)).toBe('23:59:59.250');
    expect(formatTemporalTick(new Date('2026-09-07T00:00:00.500Z'), 500)).toBe('00:00:00.500');
    expect(formatTemporalTick(new Date('2026-09-06T12:00:00Z'), 2 * 86_400_000)).toBe(
      'Sep 6, 12:00'
    );
    expect(formatTemporalTick(new Date('2026-09-07T12:00:00Z'), 2 * 86_400_000)).toBe(
      'Sep 7, 12:00'
    );
  });
  it('preserves large and small represented values without compact rounding', () => {
    expect(formatInspectionNumber(1234567.89123)).toBe('1,234,567.89123');
    expect(formatInspectionNumber(0.000000001)).toBe('0.000000001');
    expect(formatInspectionNumber(-12345.678901)).toBe('-12,345.678901');
    expect(formatInspectionNumber(0)).toBe('0');
    expect(compactFormat(0.000000001)).toBe('1.00e-9');
    expect(compactFormat(-0.000000001)).toBe('-1.00e-9');
    expect(compactFormat(0)).toBe('0');
  });
});

describe('temporal tick grid', () => {
  const SECOND = 1_000,
    MINUTE = 60 * SECOND,
    HOUR = 60 * MINUTE,
    DAY = 24 * HOUR;

  it('keeps one readable step for the whole span', () => {
    expect(temporalStep(30 * DAY, 8)).toEqual({ unit: 'day', count: 3 });
    expect(temporalStep(3 * DAY, 8)).toEqual({ unit: 'day', count: 1 });
    expect(temporalStep(DAY, 8)).toEqual({ unit: 'hour', count: 3 });
    expect(temporalStep(15 * MINUTE, 8)).toEqual({ unit: 'minute', count: 2 });
    expect(temporalStep(400 * DAY, 8)).toEqual({ unit: 'month', count: 2 });
    expect(temporalStep(4 * 365 * DAY, 8)).toEqual({ unit: 'year', count: 1 });
    // The span's label granularity outranks a denser step the width could fit.
    expect(temporalStep(2 * DAY, 8).unit).toBe('hour');
    expect(temporalStep(120 * DAY, 8).unit).toBe('month');
  });
  it('steps every tick on the same local boundary across a month change', () => {
    const ticks = temporalTicks(Date.UTC(2026, 7, 20, 6, 41), Date.UTC(2026, 8, 19, 6, 41), {
      unit: 'day',
      count: 3
    });
    expect(ticks.length).toBeGreaterThan(4);
    for (const value of ticks) expect(new Date(value).getHours()).toBe(0);
    for (let index = 1; index < ticks.length; index++) {
      // Local midnight stepping stays whole days apart through daylight saving changes.
      expect(Math.abs(ticks[index] - ticks[index - 1] - 3 * DAY)).toBeLessThanOrEqual(HOUR);
    }
  });
  it('anchors calendar steps on the boundary their unit names', () => {
    const months = temporalTicks(Date.UTC(2026, 7, 20), Date.UTC(2027, 5, 1), {
      unit: 'month',
      count: 2
    });
    expect(months.length).toBeGreaterThan(3);
    for (const value of months) expect(new Date(value).getDate()).toBe(1);
    const years = temporalTicks(Date.UTC(2024, 3, 2), Date.UTC(2027, 0, 1), {
      unit: 'year',
      count: 1
    });
    expect(years.map((value) => new Date(value).getFullYear())).toEqual([2025, 2026, 2027]);
    for (const value of years) {
      expect(new Date(value).getMonth()).toBe(0);
      expect(new Date(value).getDate()).toBe(1);
    }
  });
  it('keeps sub-day steps inside the window without walking the whole day', () => {
    const start = Date.UTC(2026, 8, 19, 6, 41, 12, 345),
      end = start + 4_500;
    const ticks = temporalTicks(start, end, { unit: 'second', count: 1 });
    expect(ticks[0]).toBeGreaterThanOrEqual(start);
    expect(ticks.at(-1)).toBeLessThanOrEqual(end);
    expect(ticks.length).toBeLessThanOrEqual(6);
  });
});
