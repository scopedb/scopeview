import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmbed, serializeDocument } from '../../node/embed.mjs';
import { clone } from '../fixtures/documents.mjs';

const document = {
  version: 1,
  title: 'Exact readings',
  data: {
    fields: [{ name: 'n', data_type: 'number' }],
    rows: [['9007199254740993']]
  },
  spec: { visualization: 'big-number', encoding: { values: ['n'] } }
};

test('HTML export keeps exact values, NULLs, captions and explicit theme/font options', async () => {
  const html = await createEmbed(document, { theme: 'dark' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /9007199254740993/);
  assert.match(html, /<h3>Exact readings<\/h3>/);
  assert.match(html, /color-scheme:dark/);
  assert.doesNotMatch(html, /data:font\/woff2;base64/);
  const fragment = await createEmbed(document, { format: 'fragment', fonts: true });
  assert.ok(!fragment.includes('<!doctype'));
  assert.match(fragment, /data:font\/woff2;base64/);
  const empty = await createEmbed({ ...document, data: { ...document.data, rows: [[null]] } });
  const snapshot = JSON.parse(empty.match(/type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(snapshot.data.rows, [[null]]);
  assert.deepEqual(snapshot.data.fields, document.data.fields);
  assert.equal(snapshot.data.metadata, undefined);
  await assert.rejects(
    createEmbed(document, { theme: 'invalid' }),
    /theme: Expected light, dark, system/
  );
});

test('export options own captions, legends and tooltips', async () => {
  const input = {
    version: 1,
    title: 'Requests',
    description: 'Two services',
    data: {
      fields: [
        { name: 'service', data_type: 'string' },
        { name: 'requests', data_type: 'number' },
        { name: 'errors', data_type: 'number' }
      ],
      rows: [['api', '120', '0']]
    },
    spec: { visualization: 'bar', encoding: { x: 'service', y: ['requests', 'errors'] } }
  };
  assert.match(await createEmbed(input), /aria-label="Series"/);
  const warnings = [];
  const hiddenLegend = await createEmbed(
    { ...input, options: {} },
    {
      legend: false,
      onDiagnostic: (diagnostic) => warnings.push(diagnostic)
    }
  );
  assert.match(hiddenLegend, /<h3>Requests<\/h3>/);
  assert.doesNotMatch(hiddenLegend, /aria-label="Series"/);
  assert.deepEqual(warnings, []);
  const hidden = { ...input, options: {} };
  assert.doesNotMatch(await createEmbed(hidden, { caption: false }), /<figcaption>/);
  assert.match(await createEmbed(hidden, { caption: true }), /<h3>Requests<\/h3>/);
  assert.doesNotMatch(await createEmbed(input, { caption: false }), /<figcaption>/);
});

test('themes are strictly validated before export, including unsafe or unsupported CSS values', async () => {
  for (const [theme, path] of [
    [{ fontsize: 14 }, 'theme.fontsize'],
    [{ fontSize: 100 }, 'theme.fontSize'],
    [{ palette: ['url(https://example.com)'] }, 'theme.palette[0]'],
    [{ fontFamily: 'Inter; color:red' }, 'theme.fontFamily'],
    [{ colors: { typo: '#fff' } }, 'theme.colors.typo']
  ])
    await assert.rejects(createEmbed(document, { theme }), { name: 'ChartValidationError', path });
  const family = '"</script><script>alert(1)</script>", system-ui';
  const html = await createEmbed(document, { theme: { fontFamily: family, fontSize: 14 } });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /\\u003c\/script\\u003e/);
});

test('Node export rejects removed and unknown options before generating output', async () => {
  const input = clone('line');
  for (const [options, path] of [
    [{ fragment: true }, 'options.fragment'],
    [{ toolip: false }, 'options.toolip'],
    [{ tooltip: 'false' }, 'options.tooltip'],
    [{ format: 'png' }, 'options.format'],
    [{ onDiagnostic: false }, 'options.onDiagnostic']
  ])
    await assert.rejects(createEmbed(input, options), new RegExp(path));
  input.options = { toolip: false };
  const before = structuredClone(input);
  await assert.rejects(createEmbed(input), {
    name: 'ChartValidationError',
    path: 'options.toolip'
  });
  assert.deepEqual(input, before);
});

test('Node callers receive relationship diagnostics while keeping the string return', async () => {
  const trace = clone('trace');
  trace.spans[0].parentId = 'absent';
  const warnings = [];
  const html = await createEmbed(trace, {
    onDiagnostic: (diagnostic) => warnings.push(diagnostic)
  });
  assert.equal(typeof html, 'string');
  assert.equal(warnings[0].code, 'HIERARCHY_MISSING_PARENT');
  assert.equal(warnings[0].path, 'spans[0].parentId');
  assert.match(await createEmbed(clone('line'), { tooltip: false }), /tooltip:false/);
});

test('hostile captions and script data stay inert without changing the source snapshot', async () => {
  const title = '</script><img src=x onerror=alert(1)>&\u2028\u2029';
  const html = await createEmbed({ ...document, title, description: title }, { caption: true });
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;\/script&gt;&lt;img/);
  const saved = JSON.parse(html.match(/type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(saved.title, title);
  assert.equal(saved.description, title);
  assert.deepEqual(JSON.parse(serializeDocument({ title })), { title });
  assert.doesNotMatch(serializeDocument({ title }), /[<>&\u2028\u2029]/);
});

test('large fragments fail without truncating complete HTML exports', async () => {
  const large = {
    version: 1,
    data: {
      fields: [
        { name: 'label', data_type: 'string' },
        { name: 'n', data_type: 'number' }
      ],
      rows: Array.from({ length: 1000 }, (_, i) => [`${i}${'x'.repeat(1000)}`, '1'])
    },
    spec: { visualization: 'bar', encoding: { x: 'label', y: ['n'] } }
  };
  await assert.rejects(createEmbed(large, { format: 'fragment' }), {
    code: 'ERR_SCOPEVIEW_FRAGMENT_SIZE'
  });
  const html = await createEmbed(large);
  const saved = JSON.parse(html.match(/type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(saved.data.rows, large.data.rows);
});

test('language tags canonicalize without changing authored text; imports ignore caller arguments', async () => {
  const before = structuredClone(document);
  const html = await createEmbed(document, { lang: 'zh-cn' });
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /lang="zh-CN" data-scopeview/);
  assert.deepEqual(document, before);
  const fragment = await createEmbed(document, {
    format: 'fragment',
    caption: true,
    lang: 'pt-br'
  });
  assert.match(fragment, /<figure[^>]+lang="pt-BR"/);
  for (const lang of ['', ' ', [], ['en'], 3, 'en,fr', '<script>', 'en_US'])
    await assert.rejects(createEmbed(document, { lang }));
  const { spawnSync } = await import('node:child_process');
  const imported = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `import './node/embed.mjs';`, '--', '--bad-flag'],
    { encoding: 'utf8' }
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, '');
  assert.equal(imported.stderr, '');
});
