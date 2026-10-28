import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';
import { failure } from '../../node/errors.mjs';
import { readInput, sha256, stageOutput, writeStream } from '../../node/io.mjs';
import { clone } from '../fixtures/documents.mjs';

const entry = resolve('node/cli.mjs');
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'scopeview-cli-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from(JSON.stringify(clone()));
  await writeFile(join(root, 'document.json'), bytes);
  const run = (args, options = {}) =>
    spawnSync(process.execPath, [entry, ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
      ...options
    });
  return { root, run, bytes };
}
function diagnostic(result, exit, code) {
  assert.equal(result.status, exit, result.stderr);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /\n\s+at /);
  const receipt = JSON.parse(result.stderr);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.status, 'error');
  assert.equal(receipt.diagnostics.length, 1);
  assert.equal(receipt.diagnostics[0].code, code);
  assert.equal(receipt.diagnostics[0].severity, 'error');
  return receipt.diagnostics[0];
}

test('parser rejects bad arguments before reading input or making parents, with terminator-aware diagnostics', async (t) => {
  const { root, run } = await fixture(t);
  for (const args of [
    ['render', 'missing', '--output', 'nested/chart.html', '--theem', 'dark'],
    ['render', 'missing', '-o', 'nested/chart.html', '--output', 'other'],
    ['render', 'missing', '-o', 'nested/chart.html', '--theme'],
    ['render', 'missing', '-o', 'nested/chart.html', '--theme='],
    ['render', 'missing', '-o', 'nested/chart.html', '--theme=-'],
    ['render', 'missing', '-o', 'nested/chart.html', '--caption=true'],
    ['render', 'missing', '-o', 'nested/chart.html', '--caption'],
    ['render', 'missing', '-o', 'nested/chart.html', '--fragment', '--format=fragment'],
    ['render', 'missing', '-o', 'nested/chart.html', '--format=png'],
    ['render', 'missing', '-o', 'nested/chart.html', '--lang=en,fr'],
    ['render', 'missing', '-o', 'nested/chart.html', '--lang= '],
    ['render', 'missing', 'extra', '-o', 'nested/chart.html'],
    ['render', 'missing'],
    ['validate'],
    ['validate', 'a', 'b'],
    ['validate', 'missing', '--max-input-bytes=0'],
    ['validate', 'missing', '--max-input-bytes=1.5'],
    ['validate', 'missing', '--max-input-bytes=9007199254740992'],
    ['validate', 'missing', '--json'],
    ['schema', '--kind=unknown'],
    ['example', 'unknown'],
    ['schema', '--json'],
    ['example', 'bar', '--json'],
    ['no-such-command'],
    ['help'],
    ['version'],
    ['render', 'first', 'extra', '--help']
  ]) {
    const repeatedJson =
      args.filter((v) => v === '--json').length > 0 && args[0] === 'validate' && args.length === 3;
    diagnostic(run([...args, '--json']), 2, 'ERR_SCOPEVIEW_USAGE');
    if (repeatedJson) assert.equal(run([...args, '--json']).status, 2);
    await assert.rejects(access(join(root, 'nested')), { code: 'ENOENT' });
  }
  diagnostic(run(['render', 'document.json', '--output=-', '--json']), 2, 'ERR_SCOPEVIEW_USAGE');
  const after = run(['example', '--', '--json']);
  assert.equal(after.status, 2);
  assert.match(after.stderr, /^ERR_SCOPEVIEW_USAGE:/);
  assert.equal(run(['validate', '--json', '--', '--json']).status, 4);
});

test('theme files share browser validation, embed their snapshot and cannot be overwritten', async (t) => {
  const { root, run } = await fixture(t);
  const themePath = join(root, 'theme.json');
  const theme = {
    mode: 'dark',
    fontSize: 16,
    palette: ['#123', '#abcdef'],
    colors: { surface: '#18212b' }
  };
  await writeFile(themePath, JSON.stringify(theme));
  const result = run([
    'render',
    'document.json',
    '-o',
    'chart.html',
    '--theme',
    'theme.json',
    '--json'
  ]);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.theme.path, themePath);
  assert.equal(receipt.theme.sha256, sha256(await readFile(themePath)));
  const html = await readFile(join(root, 'chart.html'), 'utf8');
  assert.match(html, /color-scheme:dark/);
  assert.match(html, /"--color-chart-series-1":"#123"/);
  const snapshot = JSON.parse(html.match(/type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(snapshot.theme, undefined);
  diagnostic(
    run([
      'render',
      'document.json',
      '-o',
      'theme.json',
      '--theme',
      'theme.json',
      '--force',
      '--json'
    ]),
    4,
    'ERR_SCOPEVIEW_INPUT_OUTPUT_ALIAS'
  );
  const hard = join(root, 'theme-hard.json');
  await link(themePath, hard);
  diagnostic(
    run(['render', 'document.json', '-o', hard, '--theme', 'theme.json', '--force', '--json']),
    4,
    'ERR_SCOPEVIEW_INPUT_OUTPUT_ALIAS'
  );
  assert.deepEqual(JSON.parse(await readFile(themePath)), theme);
  await writeFile(themePath, '{"colors":{"typo":"#fff"}}');
  const invalid = diagnostic(
    run(['render', 'document.json', '-o', 'nested/chart.html', '--theme', 'theme.json', '--json']),
    3,
    'ERR_SCOPEVIEW_THEME'
  );
  assert.equal(invalid.path, 'theme.colors.typo');
  await assert.rejects(access(join(root, 'nested')), { code: 'ENOENT' });
  await writeFile(themePath, '{broken');
  diagnostic(
    run(['render', 'document.json', '-o', 'other.html', '--theme', 'theme.json', '--json']),
    3,
    'ERR_SCOPEVIEW_JSON'
  );
  diagnostic(
    run(['render', 'document.json', '-o', 'other.html', '--theme', 'missing.json', '--json']),
    4,
    'ERR_SCOPEVIEW_IO'
  );
});

test('theme settings inside a chart remain document errors', async (t) => {
  const { root, run } = await fixture(t);
  await writeFile(
    join(root, 'styled.json'),
    JSON.stringify({ ...clone(), theme: { fontSize: 16 } })
  );
  const error = diagnostic(run(['validate', 'styled.json', '--json']), 3, 'ERR_SCOPEVIEW_DOCUMENT');
  assert.equal(error.path, 'theme');
});

test('help, version, schema and examples have clean resource output and standard aliases', async (t) => {
  const { root, run } = await fixture(t);
  for (const command of [
    [],
    ['--help'],
    ['-h'],
    ['validate', '-h'],
    ['render', '--help'],
    ['schema', '-h'],
    ['example', '-h']
  ]) {
    const result = run(command);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
    assert.equal(result.stderr, '');
  }
  assert.equal(
    run(['--version']).stdout.trim(),
    JSON.parse(await readFile('package.json', 'utf8')).version
  );
  assert.equal(JSON.parse(run(['schema']).stdout).$ref, '#/$defs/document');
  const authored = JSON.parse(run(['example', 'line']).stdout);
  assert.equal(authored.kind, undefined);
  assert.equal(authored.spec.version, undefined);
  assert.equal(authored.spec.encoding.kind, undefined);
  assert.equal(authored.data.metadata, undefined);
  assert.equal(authored.data.num_rows, undefined);
  assert.ok(Array.isArray(authored.data.fields));
  await symlink(entry, join(root, 'scopeview'));
  const linked = spawnSync(process.execPath, [join(root, 'scopeview'), '--version'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(linked.status, 0, linked.stderr);
  assert.equal(linked.stdout, run(['--version']).stdout);
});

test('validation receipts cover file/stdin, BOM original bytes, invalid UTF-8/JSON, compiler paths and byte caps', async (t) => {
  const { root, run, bytes } = await fixture(t);
  for (const bom of [Buffer.alloc(0), Buffer.from([0xef, 0xbb, 0xbf])]) {
    const source = Buffer.concat([bom, bytes]);
    const result = run(['validate', '-', '--json'], { input: source });
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.deepEqual(receipt.input, { path: '-', bytes: source.length, sha256: sha256(source) });
    assert.deepEqual(receipt.document, { version: 1, kind: 'metric', records: 3, fields: 2 });
    assert.deepEqual(receipt.diagnostics, []);
    assert.equal(receipt.status, 'validated');
    assert.equal(result.stderr, '');
  }
  for (const input of [
    Buffer.from([0xff]),
    Buffer.from('{invalid'),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf]), bytes])
  ])
    diagnostic(run(['validate', '-', '--json'], { input }), 3, 'ERR_SCOPEVIEW_JSON');
  const invalid = clone();
  invalid.data.rows[2][1] = 0;
  assert.equal(
    diagnostic(
      run(['validate', '-', '--json'], { input: JSON.stringify(invalid) }),
      3,
      'ERR_SCOPEVIEW_DOCUMENT'
    ).path,
    'data.rows[2][1]'
  );
  const limited = diagnostic(
    run(['validate', 'document.json', '--max-input-bytes=10', '--json']),
    5,
    'ERR_SCOPEVIEW_INPUT_LIMIT'
  );
  assert.match(limited.message, /10-byte/);
  diagnostic(
    run(['validate', '-', '--max-input-bytes=10', '--json'], { input: bytes }),
    5,
    'ERR_SCOPEVIEW_INPUT_LIMIT'
  );
  assert.equal(
    run(['validate', 'document.json', `--max-input-bytes=${bytes.length}`, '--json']).status,
    0
  );
  diagnostic(run(['validate', 'absent', '--json']), 4, 'ERR_SCOPEVIEW_IO');
  const file = JSON.parse(run(['validate', 'document.json', '--json']).stdout);
  assert.equal(file.input.path, join(root, 'document.json'));
});

test('HTML stdout is pure, file receipts describe published bytes, and failures publish no output', async (t) => {
  const { root, run, bytes } = await fixture(t);
  const stdout = run(['render', '-', '-o', '-', '--lang=zh-cn', '--theme=dark'], {
    input: bytes
  });
  assert.equal(stdout.status, 0, stdout.stderr);
  assert.match(stdout.stdout, /^<!doctype html>/);
  assert.match(stdout.stdout, /lang="zh-CN"/);
  assert.equal(stdout.stderr, '');
  const result = run([
    'render',
    'document.json',
    '--output=nested/chart.html',
    '--json',
    '--theme=system'
  ]);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout),
    output = await readFile(join(root, 'nested/chart.html'));
  assert.equal(receipt.status, 'exported');
  assert.equal(receipt.format, 'html');
  assert.deepEqual(receipt.output, {
    path: join(root, 'nested/chart.html'),
    bytes: output.length,
    sha256: sha256(output)
  });
  assert.deepEqual(receipt.input, {
    path: join(root, 'document.json'),
    bytes: bytes.length,
    sha256: sha256(bytes)
  });
  const bad = clone();
  bad.version = 2;
  diagnostic(
    run(['render', '-', '-o', 'never/created.html', '--json'], { input: JSON.stringify(bad) }),
    3,
    'ERR_SCOPEVIEW_DOCUMENT'
  );
  await assert.rejects(access(join(root, 'never')), { code: 'ENOENT' });
  const warnings = clone();
  warnings.options = {};
  const warned = run(['render', '-', '-o', 'warned.html', '--no-caption', '--json'], {
    input: JSON.stringify(warnings)
  });
  assert.equal(warned.status, 0, warned.stderr);
  assert.deepEqual(JSON.parse(warned.stdout).diagnostics, []);
  assert.doesNotMatch(await readFile(join(root, 'warned.html'), 'utf8'), /<figcaption>/);
  assert.equal(warned.stderr, '');
});

test('authoring appends rows, rejects typos and controls exported UI at the CLI', async (t) => {
  const { root, run } = await fixture(t);
  const source = JSON.parse(run(['example', 'top-list']).stdout);
  source.data.rows.push(['new', '20']);
  const checked = run(['validate', '-', '--json'], { input: JSON.stringify(source) });
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).document.records, 4);
  const legacy = {
    ...source,
    data: { metadata: { fields: source.data.fields }, rows: source.data.rows }
  };
  const legacyError = diagnostic(
    run(['render', '-', '-o', 'never/legacy.html', '--json'], { input: JSON.stringify(legacy) }),
    3,
    'ERR_SCOPEVIEW_DOCUMENT'
  );
  assert.equal(legacyError.path, 'data.metadata');
  await assert.rejects(access(join(root, 'never')), { code: 'ENOENT' });
  source.options = { toolip: false };
  const rejected = diagnostic(
    run(['validate', '-', '--json'], { input: JSON.stringify(source) }),
    3,
    'ERR_SCOPEVIEW_DOCUMENT'
  );
  assert.equal(rejected.path, 'options.toolip');
  diagnostic(
    run(['render', '-', '-o', 'never/typo.html', '--json'], { input: JSON.stringify(source) }),
    3,
    'ERR_SCOPEVIEW_DOCUMENT'
  );
  await assert.rejects(access(join(root, 'never')), { code: 'ENOENT' });
  delete source.options;
  const input = JSON.stringify(source);
  const rendered = run(['render', '-', '-o', 'caption.html', '--json'], { input });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.deepEqual(JSON.parse(rendered.stdout).diagnostics, []);
  assert.match(await readFile(join(root, 'caption.html'), 'utf8'), /<h3>Requests by service<\/h3>/);
  const hidden = run(
    ['render', '-', '-o', 'plot.html', '--no-caption', '--no-legend', '--no-tooltip'],
    { input }
  );
  assert.equal(hidden.status, 0, hidden.stderr);
  const html = await readFile(join(root, 'plot.html'), 'utf8');
  assert.doesNotMatch(html, /<figcaption>/);
  assert.match(html, /tooltip:false/);
  assert.equal(hidden.stderr, '');
});

test('exports require force and preserve permissions, reject aliases and special targets, and keep originals on failure', async (t) => {
  const { root, run, bytes } = await fixture(t);
  await writeFile(join(root, 'output.html'), 'prior');
  await chmod(join(root, 'output.html'), 0o640);
  diagnostic(
    run(['render', 'document.json', '--output', 'output.html', '--json']),
    4,
    'ERR_SCOPEVIEW_OUTPUT_EXISTS'
  );
  assert.equal(await readFile(join(root, 'output.html'), 'utf8'), 'prior');
  const forced = run(['render', 'document.json', '-o', 'output.html', '--force']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(forced.stdout, `${join(root, 'output.html')}\n`);
  assert.equal((await lstat(join(root, 'output.html'))).mode & 0o777, 0o640);
  await link(join(root, 'document.json'), join(root, 'hard.json'));
  await symlink(join(root, 'document.json'), join(root, 'input-link.json'));
  await symlink(root, join(root, 'parent-link'));
  for (const [input, output] of [
    ['document.json', './document.json'],
    ['input-link.json', 'document.json'],
    ['document.json', 'parent-link/document.json'],
    ['document.json', 'hard.json']
  ])
    diagnostic(
      run(['render', input, '-o', output, '--force', '--json']),
      4,
      'ERR_SCOPEVIEW_INPUT_OUTPUT_ALIAS'
    );
  await mkdir(join(root, 'dir'));
  for (const target of ['input-link.json', 'dir'])
    for (const force of [[], ['--force']])
      diagnostic(
        run(['render', 'document.json', '-o', target, ...force, '--json']),
        4,
        'ERR_SCOPEVIEW_OUTPUT_TYPE'
      );
  const descriptor = await open(join(root, 'document.json'), 'r');
  try {
    diagnostic(
      run(['render', '-', '-o', 'hard.json', '--force', '--json'], {
        stdio: [descriptor.fd, 'pipe', 'pipe']
      }),
      4,
      'ERR_SCOPEVIEW_INPUT_OUTPUT_ALIAS'
    );
  } finally {
    await descriptor.close();
  }
  const inputSymlink = run(['validate', 'input-link.json']);
  assert.equal(inputSymlink.status, 0, inputSymlink.stderr);
  assert.deepEqual(await readFile(join(root, 'document.json')), bytes);
  assert.equal(
    (await readdir(root)).some((name) => name.endsWith('.tmp')),
    false
  );
});

test('exclusive publication preserves concurrent destinations and cleans owned temporary files on failure', async (t) => {
  const { root } = await fixture(t);
  const input = await readInput(join(root, 'document.json'));
  const target = join(root, 'race.html');
  const staged = await stageOutput(target, 'new bytes', input);
  await writeFile(target, 'other writer');
  await assert.rejects(staged.publish(), { code: 'ERR_SCOPEVIEW_OUTPUT_EXISTS' });
  assert.equal(await readFile(target, 'utf8'), 'other writer');
  assert.equal(
    (await readdir(root)).some((name) => name.endsWith('.tmp')),
    false
  );
  const failed = await stageOutput(join(root, 'failed.html'), 'new bytes', input, true);
  await mkdir(join(root, 'failed.html'));
  await assert.rejects(failed.publish(), { code: 'ERR_SCOPEVIEW_OUTPUT_TYPE' });
  assert.equal(
    (await readdir(root)).some((name) => name.endsWith('.tmp')),
    false
  );
});

test('stream writes await completion and map broken pipes to I/O failures without stack traces', async (t) => {
  let completed = false;
  const delayed = new Writable({
    write(_chunk, _encoding, callback) {
      setImmediate(() => {
        completed = true;
        callback();
      });
    }
  });
  await writeStream(delayed, 'bytes');
  assert.equal(completed, true);
  const broken = new Writable({
    write(_chunk, _encoding, callback) {
      callback(Object.assign(new Error('broken pipe'), { code: 'EPIPE' }));
    }
  });
  await assert.rejects(writeStream(broken, 'bytes'), { code: 'ERR_SCOPEVIEW_IO' });
  const { root } = await fixture(t);
  const child = spawn(process.execPath, [entry, 'render', 'document.json', '-o', '-'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.destroy();
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exit = await new Promise((resolveExit) => child.on('close', resolveExit));
  assert.equal(exit, 4, stderr);
  assert.match(stderr, /ERR_SCOPEVIEW_IO/);
  assert.doesNotMatch(stderr, /\n\s+at /);
});

test('unexpected failures and unsupported runtime have distinct stable protocol classifications', () => {
  assert.equal(failure(new Error('unexpected')).diagnostic.code, 'ERR_SCOPEVIEW_INTERNAL');
  assert.equal(
    failure({ code: 'ERR_SCOPEVIEW_NODE_VERSION', message: 'Node 24 required' }).exitCode,
    4
  );
});

test('the default transport cap is independent of document limits and can be explicitly overridden', async (t) => {
  const { DEFAULT_MAX_INPUT_BYTES } = await import('../../node/io.mjs');
  const { root, run, bytes } = await fixture(t);
  const source = join(root, 'large.json');
  const file = await open(source, 'w');
  try {
    const padding = Buffer.alloc(1024 * 1024, ' ');
    for (let i = 0; i < DEFAULT_MAX_INPUT_BYTES / padding.length; i++) await file.write(padding);
    await file.write(bytes);
  } finally {
    await file.close();
  }
  diagnostic(run(['validate', 'large.json', '--json']), 5, 'ERR_SCOPEVIEW_INPUT_LIMIT');
  const result = run([
    'validate',
    'large.json',
    '--json',
    `--max-input-bytes=${DEFAULT_MAX_INPUT_BYTES + bytes.length}`
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).document.records, 3);
});

test('fragment overflow maps to exit 5 without publication, and explicit complete HTML stays available', async (t) => {
  const { root, run } = await fixture(t);
  const large = clone('bar');
  large.data.rows = Array.from({ length: 1000 }, (_, i) => [`${i}${'x'.repeat(1000)}`, '1']);
  await writeFile(join(root, 'large.json'), JSON.stringify(large));
  diagnostic(
    run(['render', 'large.json', '-o', 'never/fragment.html', '--format=fragment', '--json']),
    5,
    'ERR_SCOPEVIEW_FRAGMENT_SIZE'
  );
  await assert.rejects(access(join(root, 'never')), { code: 'ENOENT' });
  const result = run(['render', 'large.json', '-o', 'large.html', '--format=html', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok((await readFile(join(root, 'large.html'))).length > 1_000_000);
});

test('unsupported Node is a process-level runtime failure before reading the document', async (t) => {
  const { root } = await fixture(t);
  const { pathToFileURL } = await import('node:url');
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    Object.defineProperty(process.versions, 'node', { value: '22.0.0' });
    const { runCLI } = await import(${JSON.stringify(pathToFileURL(resolve('node/command.mjs')).href)});
    await runCLI(['validate', 'missing.json', '--json']);
  `
    ],
    { cwd: root, encoding: 'utf8' }
  );
  diagnostic(result, 4, 'ERR_SCOPEVIEW_NODE_VERSION');
});
