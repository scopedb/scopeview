import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareDocument } from '../../node/document.mjs';
import { clone } from '../fixtures/documents.mjs';

test('the public compiler owns validation, summaries, normalization and snapshots', async () => {
  for (const [name, records, fields] of [
    ['top-list', 3, 2],
    ['trace', 4, null],
    ['profile', 4, null]
  ]) {
    const input = clone(name),
      before = structuredClone(input);
    const result = await prepareDocument(input);
    assert.deepEqual(result.summary, {
      version: 1,
      kind: name === 'top-list' ? 'metric' : name,
      records,
      fields
    });
    assert.deepEqual(input, before);
    assert.notEqual(result.compiled.document, input);
  }
  const input = clone();
  input.data.rows[2][1] = 0;
  await assert.rejects(prepareDocument(input), {
    name: 'ChartValidationError',
    path: 'data.rows[2][1]'
  });
});

test('relationship warnings use original indices, retain sources, and deduplicate compiler issues', async () => {
  const input = clone('trace');
  input.spans[0].parentId = 'absent';
  input.spans[1].endTimeNs = '1803600000090000000';
  const { diagnostics, compiled } = await prepareDocument(input);
  assert.deepEqual(
    diagnostics.map(({ code, path }) => ({ code, path })),
    [
      { code: 'HIERARCHY_MISSING_PARENT', path: 'spans[0].parentId' },
      { code: 'TRACE_OUTSIDE_PARENT', path: 'spans[1]' }
    ]
  );
  assert.deepEqual(compiled.document.spans, input.spans);
  const profile = clone('profile');
  profile.frames[2].parentId = 'absent';
  assert.equal((await prepareDocument(profile)).diagnostics[0].path, 'frames[2].parentId');
});

test('removed UI and unknown configuration fail at their exact paths', async () => {
  for (const name of ['bar', 'trace', 'profile']) {
    for (const key of [
      'header',
      'tooltip',
      'toolbar',
      'dataTable',
      'legend',
      'inspector',
      'summary',
      'dismissOnOutside',
      'renderer',
      'toolip'
    ]) {
      const input = { ...clone(name), options: { [key]: false } };
      const before = structuredClone(input);
      await assert.rejects(prepareDocument(input), {
        name: 'ChartValidationError',
        path: `options.${key}`
      });
      assert.deepEqual(input, before);
    }
  }
  const input = clone('bar');
  input.spec.encoding.seres = 'service';
  await assert.rejects(prepareDocument(input), {
    name: 'ChartValidationError',
    path: 'spec.encoding.seres'
  });
});
