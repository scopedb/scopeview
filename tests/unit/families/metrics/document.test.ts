import { describe, expect, it } from 'vitest';
import {
  compileChart as compileAllCharts,
  parseChartDocument,
  ChartValidationError,
  compileVisualization,
  type ChartDocumentInput
} from '../../../../src/index.js';
import sample from '../../../../examples/requests.json';
import { compileAxis } from '../../../../src/families/metrics/compile-axis.js';
import { prepareAggregateValues } from '../../../../src/families/metrics/prepared.js';

it('retains aggregate NULL readings and labels independently of exact integers and zero', () => {
  const input: ChartDocumentInput = {
    version: 1,
    data: {
      fields: [
        { name: 'beyond_safe', data_type: 'number' },
        { name: 'zero', data_type: 'number' },
        { name: 'missing', data_type: 'number' }
      ],
      rows: [['9007199254740993', '0', null]]
    },
    spec: {
      visualization: 'big-number',
      encoding: { values: ['beyond_safe', 'zero', 'missing'] }
    }
  };
  const compiled = compileAllCharts(input);
  expect(compiled.document.data.rows).toEqual(input.data.rows);
  if (compiled.config.mapping.kind !== 'aggregate') throw new Error('Expected aggregate mapping.');
  expect(prepareAggregateValues(compiled.dataset, compiled.config.mapping)).toMatchObject([
    { label: 'beyond_safe', value: Number('9007199254740993') },
    { label: 'zero', value: 0 },
    { label: 'missing', value: null }
  ]);
  input.data.rows[0] = [null, null, null];
  expect(compileAllCharts(input).document.data.rows).toEqual([[null, null, null]]);
  input.data.rows[0][2] = 'not numeric';
  expect(() => compileAllCharts(input)).toThrow(/finite numeric string/);
});

describe.each([
  ['all metrics', compileAllCharts],
  ['axis entry', compileAxis]
] as const)('public chart document boundary: %s', (_entry, compileChart) => {
  it('accepts exactly three data types and rejects old names with their field path', () => {
    expect(compileChart(sample).dataset.columns.map((column) => column.kind)).toEqual([
      'temporal',
      'categorical',
      'numeric'
    ]);
    for (const data_type of [
      'int64',
      'uint64',
      'float64',
      'decimal(38,19)',
      'numeric',
      'date',
      'datetime',
      'boolean',
      'unknown',
      'NUMBER',
      ' number '
    ]) {
      const input = structuredClone(sample);
      input.data.fields[2].data_type = data_type;
      expect(() => compileChart(input)).toThrow(
        'data.fields[2].data_type: Expected string, number, timestamp.'
      );
    }
    const input = structuredClone(sample);
    input.data.rows = [];
    input.spec.encoding.y[0].data_type = 'int64';
    expect(() => compileChart(input)).toThrow(
      'spec.encoding.y[0].data_type: Expected string, number, timestamp.'
    );
  });
  it('validates number cells without coercing invalid values to gaps or zero', () => {
    for (const cell of ['', ' ', 'NaN', 'Infinity', '-Infinity', 'not-a-number']) {
      const input = structuredClone(sample);
      input.data.rows[0][2] = cell;
      expect(() => compileChart(input)).toThrow(
        'data.rows[0][2]: Expected a finite numeric string or null.'
      );
    }
  });
  it('explains missing roles and source types separately from limits, with a valid recovery', () => {
    expect(() =>
      compileChart({
        ...sample,
        spec: { ...sample.spec, encoding: { y: sample.spec.encoding.y } }
      })
    ).toThrow('spec.encoding.x: Expected a field name or reference.');
    expect(() => compileChart({ ...sample, data: { fields: sample.data.fields } })).toThrow(
      'data.rows: Expected an array; use [] for no data.'
    );
    expect(
      compileChart({ ...sample, data: { fields: sample.data.fields, rows: [] } }).document.data.rows
    ).toEqual([]);
    expect(() =>
      compileChart({
        ...sample,
        data: {
          ...sample.data,
          rows: [[...sample.data.rows[0].slice(0, 2), 120], ...sample.data.rows.slice(1)]
        }
      })
    ).toThrow('data.rows[0][2]: Expected a string or null; quote numbers.');
    expect(() => compileChart(sample)).not.toThrow();
  });
  it('owns flat fields and keeps appended rows, exact strings and NULLs intact', () => {
    const input: ChartDocumentInput = {
      version: 1,
      data: {
        fields: [
          { name: 'service', data_type: 'string' },
          { name: 'requests', data_type: 'number' }
        ],
        rows: [
          ['api', '9007199254740993'],
          ['zero', '0'],
          ['missing', null]
        ]
      },
      spec: { visualization: 'bar', encoding: { x: 'service', y: ['requests'] } }
    };
    const before = structuredClone(input);
    const parsed = parseChartDocument(input);
    expect(parsed.spec).not.toHaveProperty('version');
    expect(parsed.spec.encoding).not.toHaveProperty('kind');
    expect(parsed.data).not.toHaveProperty('metadata');
    expect(parsed.data).not.toHaveProperty('num_rows');
    expect(parsed.spec.encoding).toMatchObject({
      x: { name: 'service', data_type: 'string', occurrence: 0 },
      y: [{ name: 'requests', data_type: 'number', occurrence: 0 }]
    });
    expect(parseChartDocument(parsed)).toEqual(parsed);
    expect(compileChart(input).document).toEqual(parsed);
    expect(input).toEqual(before);
    input.data.rows.push(['new', '20']);
    expect(compileChart(input).document.data.rows).toHaveLength(4);
    for (const [document, path] of [
      [{ ...input, data: { ...input.data, num_rows: 4 } }, 'data.num_rows'],
      [{ ...input, spec: { ...input.spec, version: 1 } }, 'spec.version'],
      [
        { ...input, spec: { ...input.spec, encoding: { ...input.spec.encoding, kind: 'axis' } } },
        'spec.encoding.kind'
      ],
      [
        {
          ...input,
          spec: {
            ...input.spec,
            encoding: {
              x: { name: 'service', data_type: 'string', occurrence: 0, kind: 'categorical' },
              y: ['requests']
            }
          }
        },
        'spec.encoding.x.kind'
      ]
    ] as const)
      expect(() => compileChart(document)).toThrow(`${path}: Unknown option.`);
  });
  it('rejects metadata wrappers, even when flat fields are also provided', () => {
    const { fields, rows } = sample.data;
    for (const data of [
      { metadata: { fields }, rows },
      { fields, metadata: { fields }, rows }
    ])
      expect(() => compileChart({ ...sample, data })).toThrow('data.metadata: Unknown option.');
    expect(() => compileChart({ ...sample, data: { rows } })).toThrow('data.fields');
    expect(() => compileChart({ ...sample, data: { fields, rows, future: true } })).toThrow(
      'data.future: Unknown option.'
    );
  });
  it('rejects the removed renderer and presentation aliases', () => {
    for (const renderer of ['canvas', 'svg', 'webgl'])
      expect(() => parseChartDocument({ ...sample, options: { renderer } })).toThrow(
        'options.renderer: Unknown option.'
      );
    for (const presentation of ['card', 'compact', 'summary'])
      expect(() => parseChartDocument({ ...sample, options: { presentation } })).toThrow(
        'options.presentation'
      );
  });
  it('owns its snapshot and preserves raw NULLs and row lineage', () => {
    const input = structuredClone(sample);
    const compiled = compileChart(input);
    input.data.rows[0][2] = '999';
    expect(compiled.document.data.rows[0][2]).toBe('120');
    expect(compiled.dataset.rows[9].values[2]).toBeNull();
    expect(compiled.dataset.rows[0].source).toBe(compiled.document.data.rows[0]);
    expect(compiled.series.map((s) => s.name)).toEqual(['api', 'ingest', 'worker']);
  });
  it('rejects unknown protocol versions and incompatible encodings', () => {
    expect(() => compileChart({ ...sample, version: 2 })).toThrow(/version/);
    expect(() => compileChart({ ...sample, spec: { ...sample.spec, version: 1 } })).toThrow(
      /spec.version/
    );
    expect(() =>
      compileChart({ ...sample, spec: { ...sample.spec, visualization: 'pie' } })
    ).toThrow(/spec.encoding.x: Unknown option/);
    expect(() => compileChart({ ...sample, spec: { ...sample.spec, encoding: null } })).toThrow(
      ChartValidationError
    );
  });
  it('reports malformed row shapes, blank numbers and invalid instants instead of plotting zeros', () => {
    const input = structuredClone(sample);
    input.data.rows[0].pop();
    expect(() => compileChart(input)).toThrow(/Row width/);
    input.data.rows[0].push('');
    expect(() => compileChart(input)).toThrow(/numeric string/);
    input.data.rows[0][2] = '120';
    input.data.rows[0][0] = '2026-02-30';
    expect(() => compileChart(input)).toThrow(/valid timestamp/);
  });
  it('rejects duplicate observations instead of silently aggregating', () => {
    const input = structuredClone(sample);
    input.data.rows.push(input.data.rows[0]);
    expect(() => compileChart(input)).toThrow(/repeated X/);
  });
  it('validates field identity even in empty snapshots', () => {
    const input = structuredClone(sample);
    input.data.rows = [];
    expect(compileChart(input).series).toEqual([]);
    input.spec.encoding.x.name = 'missing';
    expect(() => compileChart(input)).toThrow(/not available/);
  });
  it('bounds work and rejects malformed optional controls', () => {
    const input = structuredClone(sample);
    input.data.rows = Array.from({ length: 10_001 }, () => input.data.rows[0]);
    expect(() => parseChartDocument(input)).toThrow(/at most/);
    expect(() => parseChartDocument({ ...sample, options: { colorStrategy: 'rainbow' } })).toThrow(
      /colorStrategy/
    );
    expect(() => parseChartDocument({ ...sample, options: { interactive: 'false' } })).toThrow(
      /boolean/
    );
  });
  it('treats markup as literal labels and rejects unknown execution options', () => {
    const input = {
      ...sample,
      title: '</script><img src=x onerror=alert(1)>'
    };
    const result = compileChart(input);
    expect(result.document.title).toBe(input.title);
    expect(() => compileChart({ ...input, url: 'https://example.com' })).toThrow(
      'url: Unknown option.'
    );
  });
  it('normalizes unique field names into durable field references', () => {
    const input: ChartDocumentInput = {
      version: 1,
      kind: 'metric',
      data: parseChartDocument(sample).data,
      spec: {
        visualization: 'line',
        encoding: { x: 'time', y: ['requests'], series: 'service' }
      },
      semantics: { time: { kind: 'points', field: 'time' } },
      options: { values: [{ field: 'requests', divisor: '1000', unit: 'k' }] }
    };
    const document = parseChartDocument(input);
    expect(document.spec).toEqual(sample.spec);
    expect(document.semantics?.time?.field).toEqual(sample.spec.encoding.x);
    expect(document.options?.values?.[0].field).toEqual(sample.spec.encoding.y[0]);
    expect(document.kind).toBe('metric');
    expect(compileChart(input).series.map((s) => s.name)).toEqual(['api', 'ingest', 'worker']);
    expect(compileVisualization(input).kind).toBe('metric');
    expect(parseChartDocument(sample)).not.toHaveProperty('kind');
  });
  it('rejects unknown and ambiguous field names with the field path', () => {
    const named = (x: string) => ({
      ...sample,
      spec: { ...sample.spec, encoding: { ...sample.spec.encoding, x } }
    });
    expect(() => parseChartDocument(named('timestamp'))).toThrow(
      /spec\.encoding\.x: The chart field “timestamp” is not available/
    );
    const duplicate = structuredClone(sample);
    duplicate.data.fields[1].name = 'time';
    expect(() =>
      parseChartDocument({
        ...duplicate,
        spec: { ...sample.spec, encoding: { ...sample.spec.encoding, series: 'time' } }
      })
    ).toThrow(/spec\.encoding\.series: Several fields are named “time”/);
    expect(() => parseChartDocument({ ...sample, kind: 'trace' })).toThrow(/^kind:/);
  });
});
