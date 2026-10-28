import { readFile } from 'node:fs/promises';

export const exampleNames = [
  'line',
  'area',
  'bar',
  'horizontal-bar',
  'scatter',
  'pie',
  'top-list',
  'treemap',
  'big-number',
  'trace',
  'profile'
];
export const documents = Object.fromEntries(
  await Promise.all(
    exampleNames.map(async (name) => [
      name,
      JSON.parse(
        await readFile(new URL(`../../examples/documents/${name}.json`, import.meta.url), 'utf8')
      )
    ])
  )
);
export const clone = (name = 'top-list') => structuredClone(documents[name]);
export const exactBar = {
  ...clone('bar'),
  data: {
    ...clone('bar').data,
    rows: [
      ['api', '9007199254740993'],
      ['worker', '80'],
      ['idle', '0'],
      ['missing', null]
    ]
  }
};

export function parityCorpus(limits, entityLimits) {
  const positive = exampleNames.map((name) => ({ name, document: clone(name) }));
  const omitted = clone();
  delete omitted.kind;
  const extra = { ...clone(), future: { anything: 1 }, options: { future: 'accepted' } };
  const repeated = clone();
  repeated.data.fields[1].name = 'service';
  repeated.spec.encoding.value = {
    name: 'service',
    occurrence: 0,
    data_type: 'number'
  };
  repeated.spec.encoding.category = {
    name: 'service',
    occurrence: 0,
    data_type: 'string'
  };
  const options = clone('line');
  options.options = {
    colorStrategy: 'consistent',
    labels: 'none',
    interactive: true,
    values: [{ field: 'requests', divisor: '1000', decimals: 2, unit: 'k' }],
    colors: { requests: '#123456' },
    stack: false
  };
  options.semantics = {
    time: {
      kind: 'buckets',
      field: 'time',
      intervalMs: 60000,
      coverage: 'complete',
      window: { start: 1793059200000, end: 1793059500000 },
      completeThrough: 1793059500000,
      valueKind: 'count'
    },
    provenance: { kind: 'bins', scope: 'returned', approximate: false, description: 'Synthetic' }
  };
  const astral = { ...clone(), title: '😀'.repeat(limits.text / 2) };
  const empty = clone();
  empty.data.rows = [];
  positive.push({ name: 'empty metric', document: empty });
  positive.push({ name: 'empty trace', document: { ...clone('trace'), spans: [] } });
  positive.push({ name: 'empty profile', document: { ...clone('profile'), frames: [] } });
  positive.push(
    ...[
      ['omitted metric kind', omitted],
      [
        'explicit v1 metric fields',
        {
          ...clone(),
          kind: 'metric',
          data: { ...clone().data, fields: [...clone().data.fields] },
          spec: {
            ...clone().spec,
            encoding: { ...clone().spec.encoding }
          }
        }
      ],
      ['repeated field references', repeated],
      ['options/semantics', options],
      ['astral boundary', astral]
    ].map(([name, document]) => ({ name, document }))
  );
  const structural = [];
  const add = (name, document) => structural.push({ name, document });
  const legacy = clone();
  const { fields, rows } = legacy.data;
  legacy.data = { metadata: { fields }, rows };
  add('removed metadata wrapper', legacy);
  for (const { name, document } of positive.filter(({ document }) => document.data)) {
    const legacy = structuredClone(document);
    legacy.data = { metadata: { fields: legacy.data.fields }, rows: legacy.data.rows };
    add(`removed metadata wrapper: ${name}`, legacy);
  }
  add('numeric metric cell', {
    ...clone(),
    data: {
      ...clone().data,
      rows: [
        ['api', 120],
        ['worker', '80'],
        ['idle', '0']
      ]
    }
  });
  add('unknown version', { ...clone(), version: 2 });
  add('unknown family', { ...clone(), kind: 'unknown' });
  add('missing data', { version: 1, spec: clone().spec });
  add('invalid title', { ...clone(), title: 4 });
  add('invalid option', { ...clone(), options: { interactive: 'yes' } });
  add('extra properties', extra);
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
    const document = clone();
    document.data.fields[1].data_type = data_type;
    add(`unsupported field type ${data_type}`, document);
  }
  const oldReference = clone();
  oldReference.spec.encoding.value = {
    name: 'requests',
    data_type: 'int64',
    occurrence: 0
  };
  add('unsupported field reference type', oldReference);
  add('incompatible visualization and encoding', {
    ...clone(),
    spec: { ...clone().spec, visualization: 'line' }
  });
  add('explicit incompatible encoding kind', {
    ...clone('line'),
    spec: {
      ...clone('line').spec,
      encoding: { ...clone('line').spec.encoding, kind: 'scatter' }
    }
  });
  add('removed spec version', { ...clone(), spec: { ...clone().spec, version: 1 } });
  add('explicit null encoding kind', {
    ...clone(),
    spec: { ...clone().spec, encoding: { ...clone().spec.encoding, kind: null } }
  });
  add('invalid reference', {
    ...clone(),
    spec: {
      ...clone().spec,
      encoding: {
        category: 'service',
        value: { name: 'requests', occurrence: -1, data_type: 'number' }
      }
    }
  });
  add('too many columns', {
    ...clone(),
    data: {
      ...clone().data,
      fields: Array.from({ length: limits.columns + 1 }, () => ({
        name: 'n',
        data_type: 'number'
      }))
    }
  });
  add('text limit', { ...clone(), title: 'x'.repeat(limits.text + 1) });
  add('integer digit limit', {
    ...clone('profile'),
    frames: [{ id: 'x', name: 'x', selfWeight: '1'.repeat(entityLimits.integerDigits + 1) }]
  });
  add('attributes limit', {
    ...clone('trace'),
    spans: [
      {
        ...clone('trace').spans[0],
        attributes: Object.fromEntries(
          Array.from({ length: entityLimits.attributes + 1 }, (_, i) => [i, true])
        )
      }
    ]
  });
  for (const name of exampleNames) {
    const document = clone(name);
    document.options = { future: false };
    add(`unknown ${name} option`, document);
    const entity = clone(name);
    if (name === 'trace') entity.spans[0].future = true;
    else if (name === 'profile') entity.frames[0].future = true;
    else entity.data.fields[0].future = true;
    add(`unknown ${name} nested property`, entity);
  }
  for (const [name, mutate] of [
    [
      'data',
      (d) => {
        d.data.future = true;
      }
    ],
    [
      'metadata',
      (d) => {
        d.data.metadata = { fields: d.data.fields };
      }
    ],
    [
      'spec',
      (d) => {
        d.spec.future = true;
      }
    ],
    [
      'reference kind',
      (d) => {
        d.spec.encoding.x = {
          name: 'time',
          data_type: 'timestamp',
          occurrence: 0,
          kind: 'temporal'
        };
      }
    ],
    [
      'display',
      (d) => {
        d.options.values[0].future = true;
      }
    ],
    [
      'semantics',
      (d) => {
        d.semantics.future = true;
      }
    ],
    [
      'time',
      (d) => {
        d.semantics.time.future = true;
      }
    ],
    [
      'window',
      (d) => {
        d.semantics.time.window.future = true;
      }
    ],
    [
      'provenance',
      (d) => {
        d.semantics.provenance.future = true;
      }
    ]
  ]) {
    const document = structuredClone(options);
    mutate(document);
    add(`unknown ${name} property`, document);
  }
  const semantic = [];
  const sem = (name, document) => semantic.push({ name, document });
  const rowCount = clone();
  rowCount.data.num_rows = rowCount.data.rows.length;
  add('removed row count', rowCount);
  const width = clone();
  width.data.rows[0].pop();
  sem('row width', width);
  const unresolved = clone();
  unresolved.spec.encoding.value = 'absent';
  sem('field resolution', unresolved);
  const eligibility = clone('bar');
  eligibility.spec.encoding.x = 'requests';
  sem('encoding eligibility', eligibility);
  const duplicate = clone('trace');
  duplicate.spans[1].id = duplicate.spans[0].id;
  sem('duplicate identities', duplicate);
  const cycle = clone('profile');
  cycle.frames[0].parentId = cycle.frames[1].id;
  sem('cycle', cycle);
  const interval = clone('trace');
  interval.spans[1].endTimeNs = '0';
  sem('interval order', interval);
  const cells = clone();
  cells.data.fields = Array.from({ length: limits.columns }, (_, i) => ({
    name: `n${i}`,
    data_type: 'number'
  }));
  cells.data.rows = Array.from({ length: Math.floor(limits.cells / limits.columns) + 1 }, () =>
    Array(limits.columns).fill('1')
  );
  sem('cell count', cells);
  sem('astral UTF-16 limit', { ...clone(), title: '😀'.repeat(limits.text / 2 + 1) });
  return { positive, structural, semantic };
}
