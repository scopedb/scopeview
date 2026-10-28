import { describe, expect, it } from 'vitest';
import {
  parseChartDocument,
  parseTraceDocument,
  parseProfileDocument
} from '../../../src/index.js';
import { parseComponentOptions } from '../../../src/families/component-options.js';
import sample from '../../../examples/requests.json';

describe.each(['metric', 'hierarchy'] as const)('%s host UI', (family) => {
  const parse = (input: unknown) =>
    family === 'metric'
      ? parseComponentOptions(input, 'metric')
      : parseComponentOptions(input, 'hierarchy');
  it('owns switches and action lists, independently of the document', () => {
    const options = {
      axes: 'minimal',
      header: false,
      tooltip: false,
      dataTable: false,
      dismissOnOutside: false,
      toolbar: { actions: ['inspect'], attribution: false }
    };
    const result = parse(options);
    expect(result).toEqual(options);
    options.toolbar.actions.length = 0;
    expect(result.toolbar).toEqual({ actions: ['inspect'], attribution: false });
    expect(parse({ toolbar: false }).toolbar).toBe(false);
    expect(parse({ toolbar: { actions: [] } }).toolbar).toEqual({ actions: [] });
  });
  it('rejects invalid and unknown host options at their paths', () => {
    for (const key of ['header', 'tooltip', 'dataTable', 'dismissOnOutside'])
      expect(() => parse({ [key]: 'false' })).toThrow(`ui.${key}`);
    for (const toolbar of [null, [], 'false'])
      expect(() => parse({ toolbar })).toThrow('ui.toolbar');
    for (const actions of [['inspect', 'inspect'], ['missing'], new Array(1), 'inspect'])
      expect(() => parse({ toolbar: { actions } })).toThrow('ui.toolbar.actions');
    expect(() => parse({ toolbar: { attribution: 0 } })).toThrow('ui.toolbar.attribution');
    expect(() => parse({ toolbar: { attributon: false } })).toThrow(
      'ui.toolbar.attributon: Unknown option.'
    );
    for (const key of ['toolip', 'interactive', 'renderer', 'presentation'])
      expect(() => parse({ [key]: false })).toThrow(`ui.${key}: Unknown option.`);
    expect(() => parse({ axes: 'compact' })).toThrow('ui.axes');
    expect(() =>
      parse({ toolbar: { actions: [family === 'metric' ? 'zoom-in' : 'show-all'] } })
    ).toThrow('ui.toolbar.actions');
  });
});

it('validates family-specific disclosures and legend summaries', () => {
  expect(parseComponentOptions({ summary: false, inspector: true }, 'hierarchy')).toEqual({
    summary: false,
    inspector: true
  });
  for (const key of ['summary', 'inspector']) {
    expect(() => parseComponentOptions({ [key]: null }, 'hierarchy')).toThrow(`ui.${key}`);
    expect(() => parseComponentOptions({ [key]: true }, 'metric')).toThrow(`ui.${key}`);
  }
  expect(() => parseComponentOptions({ legend: true }, 'hierarchy')).toThrow('ui.legend');
  const options = { legend: { columns: ['last', 'avg', 'max'] } };
  const parsed = parseComponentOptions(options, 'metric');
  options.legend.columns.length = 0;
  expect(parsed.legend).toEqual({ columns: ['last', 'avg', 'max'] });
  for (const columns of [[], ['last', 'last'], ['median']])
    expect(() => parseComponentOptions({ legend: { columns } }, 'metric')).toThrow(
      'ui.legend.columns'
    );
  expect(() =>
    parseComponentOptions({ legend: { columns: ['last'], colums: [] } }, 'metric')
  ).toThrow('ui.legend.colums');
});

it('rejects host UI inside every document family', () => {
  const documents = [
    { parse: parseChartDocument, document: sample },
    { parse: parseTraceDocument, document: { version: 1, kind: 'trace', spans: [] } },
    {
      parse: parseProfileDocument,
      document: { version: 1, kind: 'profile', unit: 'samples', frames: [] }
    }
  ];
  for (const { parse, document } of documents)
    for (const key of [
      'header',
      'tooltip',
      'dataTable',
      'toolbar',
      'legend',
      'summary',
      'inspector',
      'dismissOnOutside'
    ])
      expect(() => parse({ ...document, options: { [key]: false } })).toThrow(
        `options.${key}: Unknown option.`
      );
});
