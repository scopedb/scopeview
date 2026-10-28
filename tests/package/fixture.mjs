import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  stat,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { documents, exactBar } from '../fixtures/documents.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function createPackedConsumer(label = 'acceptance') {
  const evidence = resolve(
    root,
    '.local/package-tests',
    `${new Date().toISOString().replaceAll(':', '-')}-${label}-${randomUUID()}`
  );
  await mkdir(evidence, { recursive: true });
  const scratch = await realpath(await mkdtemp(resolve(tmpdir(), 'scopeview-package-')));
  const consumer = resolve(scratch, 'consumer');
  const relocated = resolve(scratch, 'relocated');
  await mkdir(consumer);
  await mkdir(relocated);
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !['NODE_PATH', 'NODE_OPTIONS'].includes(key) && !key.toLowerCase().startsWith('npm_config_')
    )
  );
  Object.assign(environment, {
    npm_config_cache: resolve(scratch, 'npm-cache'),
    npm_config_userconfig: resolve(scratch, '.npmrc'),
    npm_config_globalconfig: resolve(scratch, 'global.npmrc'),
    npm_config_registry: 'https://registry.invalid',
    npm_config_update_notifier: 'false'
  });
  await writeFile(environment.npm_config_userconfig, '');
  await writeFile(environment.npm_config_globalconfig, '');
  const report = {
    nodeVersion: process.version,
    status: 'running',
    evidence,
    scratch,
    consumer,
    commands: [],
    artifacts: [],
    browser: []
  };
  const save = () =>
    writeFile(resolve(evidence, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await save();
  async function run(file, args, { cwd = consumer, input, expected = 0 } = {}) {
    const observed = await new Promise((resolveRun, reject) => {
      const child = spawn(file, args, { cwd, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '',
        stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (code, signal) =>
        resolveRun({ argv: [file, ...args], cwd, code, signal, stdout, stderr })
      );
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
    report.commands.push(observed);
    await save();
    assert.equal(observed.code, expected, `${file} ${args.join(' ')}\n${observed.stderr}`);
    return observed;
  }
  try {
    // Refuse stale builds: the package test never falls back to a previous archive.
    const built = await stat(resolve(root, 'dist/index.js'));
    async function newest(directory) {
      const times = await Promise.all(
        (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
          const path = resolve(directory, entry.name);
          return entry.isDirectory() ? newest(path) : (await stat(path)).mtimeMs;
        })
      );
      return Math.max(...times);
    }
    assert.ok(
      built.mtimeMs >= (await newest(resolve(root, 'src'))),
      'Run pnpm build before test:package; dist is stale.'
    );
    const packed = JSON.parse(
      (
        await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', evidence], {
          cwd: root
        })
      ).stdout
    )[0];
    const archive = resolve(evidence, packed.filename);
    const archiveBytes = await readFile(archive);
    report.package = {
      version: packed.version,
      archive,
      sha256: digest(archiveBytes),
      files: packed.files,
      integrity: packed.integrity
    };
    const inventory = packed.files.map((file) => file.path);
    for (const file of inventory) {
      assert.match(
        file,
        /^(?:package\.json|README\.md|CHANGELOG\.md|LICENSE|dist\/(?:(?:[^/]+\/)*[^/]+\.d\.ts|[^/]+\.(?:js|css)|LICENSE|fonts\/(?:LICENSE|[^/]+\.woff2)|theme\/design-tokens\.json)|node\/[^/]+\.(?:mjs|d\.mts)|schemas\/v1\/document\.schema\.json|examples\/documents\/(?:line|area|bar|horizontal-bar|scatter|pie|top-list|treemap|big-number|trace|profile)\.json)$/
      );
    }
    await writeFile(resolve(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
    await run('npm', [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      archive
    ]);
    const installed = resolve(consumer, 'node_modules/@scopedb/scopeview');
    const pkg = JSON.parse(await readFile(resolve(installed, 'package.json'), 'utf8'));
    assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
    assert.deepEqual((await readdir(resolve(consumer, 'node_modules'))).sort(), [
      '.bin',
      '.package-lock.json',
      '@scopedb'
    ]);
    for (const file of inventory) {
      const destination = resolve(installed, file);
      assert.equal((await lstat(destination)).isSymbolicLink(), false, file);
      assert.ok((await realpath(destination)).startsWith(`${installed}/`), file);
      assert.equal(
        digest(await readFile(destination)),
        digest(await readFile(resolve(root, file))),
        file
      );
    }
    for (const target of Object.values(pkg.exports)) {
      for (const path of typeof target === 'string' ? [target] : Object.values(target))
        await stat(resolve(installed, path));
    }
    const bins = Object.fromEntries(
      Object.keys(pkg.bin).map((name) => [name, resolve(consumer, 'node_modules/.bin', name)])
    );
    for (const [name, bin] of Object.entries(bins)) {
      assert.equal(await realpath(bin), resolve(installed, pkg.bin[name]));
      assert.ok((await stat(bin)).mode & 0o111, name);
    }
    await save();
    return {
      root,
      evidence,
      scratch,
      consumer,
      relocated,
      installed,
      pkg,
      bins,
      report,
      save,
      run
    };
  } catch (error) {
    report.status = 'failed';
    report.failure = error.message;
    await save();
    throw error;
  }
}

export async function exercisePackedConsumer(fixture) {
  const { consumer, relocated, installed, pkg, bins, run, report, save } = fixture;
  const example = await run(bins.scopeview, ['example', 'top-list']);
  const inputPath = resolve(consumer, 'chart.json');
  await writeFile(inputPath, example.stdout);
  const validation = JSON.parse(
    (await run(bins.scopeview, ['validate', inputPath, '--json'])).stdout
  );
  assert.equal(validation.input.sha256, digest(Buffer.from(example.stdout)));
  assert.equal(validation.document.records, 3);
  assert.equal((await run(bins.scopeview, ['--version'])).stdout.trim(), pkg.version);
  const outputPath = resolve(consumer, 'chart.html');
  const exported = JSON.parse(
    (
      await run(bins.scopeview, [
        'render',
        inputPath,
        '-o',
        outputPath,
        '--theme=system',
        '--lang=zh-cn',
        '--json'
      ])
    ).stdout
  );
  const bytes = await readFile(outputPath);
  assert.deepEqual(exported.output, {
    path: outputPath,
    bytes: bytes.length,
    sha256: digest(bytes)
  });
  await cp(outputPath, resolve(relocated, 'chart.html'));
  assert.deepEqual(Object.keys(bins), ['scopeview']);
  await run(bins.scopeview, [
    'render',
    inputPath,
    '-o',
    'fragment.html',
    '--format=fragment',
    '--fonts'
  ]);
  await run(bins.scopeview, ['render', inputPath, '-o', 'fragment.html', '--json'], {
    expected: 4
  });
  await run(bins.scopeview, ['render', inputPath, '-o', 'fragment.html', '--force']);
  const imports = `import assert from 'node:assert/strict';
import { createEmbed, serializeDocument } from '@scopedb/scopeview/embed';
import { compileVisualization } from '@scopedb/scopeview';
import { resolveTheme } from '@scopedb/scopeview/theme';
import schema from '@scopedb/scopeview/schema/v1.json' with { type: 'json' };
import { writeFile } from 'node:fs/promises';
assert.equal(schema.$id, 'urn:scopedb:scopeview:document:1');
assert.ok(import.meta.resolve('@scopedb/scopeview').startsWith(${JSON.stringify(pathToFileURL(`${installed}/`).href)}));
const input = ${JSON.stringify(exactBar)};
assert.equal(compileVisualization(input).kind, 'metric');
assert.equal(resolveTheme({ fontSize: 26 }).properties['--scope-chart-font-scale'], '2');
assert.equal(JSON.parse(serializeDocument(input)).data.rows[0][1], '9007199254740993');
await writeFile('api.html', await createEmbed(input, { lang: 'en-us', caption: true }));
`;
  await writeFile(resolve(consumer, 'imports.mjs'), imports);
  await run(process.execPath, ['imports.mjs']);
  // Type-check every published type entry via real installed package resolution.
  const types = Object.entries(pkg.exports)
    .filter(([, target]) => typeof target === 'object' && target.types)
    .map(
      ([key], index) =>
        `import type * as Entry${index} from ${JSON.stringify(pkg.name + (key === '.' ? '' : key.slice(1)))}; export type Public${index} = typeof Entry${index};`
    );
  types.push(
    `import { createEmbed } from '@scopedb/scopeview/embed';
import type { ChartDataType, ResultField, ChartFieldRef, ChartDocumentInput, ChartSpecInput, ChartSpec } from '@scopedb/scopeview';
const input: ChartDocumentInput = ${JSON.stringify(documents.bar)};
input.data.rows.push(['new', '20']);
const result: Promise<string> = createEmbed(input, {
  lang: 'zh-CN', theme: 'system',
  onDiagnostic: diagnostic => { const path: string = diagnostic.path; void path; }
});
type Assert<T extends true> = T;
export type OnlyThreeDataTypes = Assert<ChartDataType extends 'string' | 'number' | 'timestamp' ? true : false>;
export type MetadataRejectsOldTypes = Assert<'int64' extends ResultField['data_type'] ? false : true>;
export type ReferencesRejectOldTypes = Assert<'float64' extends ChartFieldRef['data_type'] ? false : true>;
export type MetadataRejectsArbitraryTypes = Assert<string extends ResultField['data_type'] ? false : true>;
type WrongMapping = { visualization: 'line'; encoding: { kind: 'distribution'; category: string; value: string } };
export type InputRejectsWrongMapping = Assert<WrongMapping extends ChartSpecInput ? false : true>;
export type SnapshotRejectsWrongMapping = Assert<(WrongMapping & {version: 1}) extends ChartSpec<string> ? false : true>;
void result;`
  );
  await writeFile(resolve(consumer, 'consumer.ts'), types.join('\n'));
  await run(process.execPath, [
    resolve(fixture.root, 'node_modules/typescript/bin/tsc'),
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    'consumer.ts'
  ]);
  const rendered = {};
  for (const [name, document] of Object.entries({ ...documents, bar: exactBar })) {
    const input = resolve(consumer, `${name}.json`),
      output = resolve(consumer, `${name}.html`);
    await writeFile(input, JSON.stringify(document));
    const receipt = JSON.parse(
      (
        await run(bins.scopeview, [
          'render',
          input,
          '-o',
          output,
          '--theme=system',
          ...(name === 'bar' ? ['--fonts'] : []),
          '--json'
        ])
      ).stdout
    );
    const content = await readFile(output);
    assert.equal(receipt.output.sha256, digest(content));
    const moved = resolve(relocated, `${name}.html`);
    await cp(output, moved);
    rendered[name] = moved;
    report.artifacts.push({
      name,
      file: moved,
      bytes: content.length,
      sha256: digest(content),
      document
    });
  }
  report.validation = validation;
  report.export = exported;
  await save();
  return rendered;
}

export async function assetFailureChecks(fixture) {
  const { installed, bins, run } = fixture;
  const { rename } = await import('node:fs/promises');
  const hide = async (path, action) => {
    const source = resolve(installed, path),
      hidden = `${source}.hidden`;
    await rename(source, hidden);
    try {
      await action();
    } finally {
      await rename(hidden, source);
    }
  };
  await hide('dist/scopeview.js', async () => {
    await run(bins.scopeview, ['--help']);
    await run(bins.scopeview, ['--version']);
    await run(bins.scopeview, ['schema']);
    await run(bins.scopeview, ['example', 'line']);
    await run(bins.scopeview, ['validate', 'chart.json']);
    const invalid = await run(bins.scopeview, ['render', '-', '-o', 'absent.html', '--json'], {
      input: '{"version":2}',
      expected: 3
    });
    assert.equal(JSON.parse(invalid.stderr).diagnostics[0].code, 'ERR_SCOPEVIEW_DOCUMENT');
    const absent = await run(
      bins.scopeview,
      ['render', 'chart.json', '-o', 'absent.html', '--json'],
      { expected: 4 }
    );
    assert.equal(JSON.parse(absent.stderr).diagnostics[0].code, 'ERR_SCOPEVIEW_ASSET_MISSING');
    assert.match(absent.stderr, /complete matching/);
  });
  await hide('dist/index.js', async () => {
    await run(bins.scopeview, ['--help']);
    const result = await run(bins.scopeview, ['validate', 'chart.json', '--json'], { expected: 4 });
    assert.equal(JSON.parse(result.stderr).diagnostics[0].code, 'ERR_SCOPEVIEW_ASSET_MISSING');
  });
  await hide('schemas/v1/document.schema.json', async () => {
    const result = await run(bins.scopeview, ['schema'], { expected: 4 });
    assert.match(result.stderr, /ERR_SCOPEVIEW_ASSET_MISSING/);
  });
  await hide('examples/documents/line.json', async () => {
    const result = await run(bins.scopeview, ['example', 'line'], { expected: 4 });
    assert.match(result.stderr, /ERR_SCOPEVIEW_ASSET_MISSING/);
  });
  await hide('package.json', async () => {
    const result = await run(bins.scopeview, ['validate', 'chart.json', '--json'], { expected: 4 });
    assert.equal(JSON.parse(result.stderr).scopeviewVersion, null);
  });
}
