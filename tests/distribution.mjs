import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises';
import { basename, delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execute, root, runtimeSpec, sha256, tar } from '../scripts/distribution.mjs';

export async function testDistribution(archive) {
  archive = resolve(archive);
  const evidence = resolve(
    root,
    '.local/distribution-tests',
    `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`
  );
  await mkdir(evidence, { recursive: true });
  const report = { status: 'running', archive, commands: [], artifacts: [] };
  const save = () =>
    writeFile(resolve(evidence, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const windows = process.platform === 'win32';
  const caller = resolve(evidence, 'unrelated caller');
  await mkdir(caller);
  const environment = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' };
  const run = async (entry, args, { input, expected = 0 } = {}) => {
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    const argv = windows
      ? [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(
            `& ${quote(entry)} ${args.map(quote).join(' ')}; exit $LASTEXITCODE`,
            'utf16le'
          ).toString('base64')
        ]
      : args;
    const file = windows
      ? resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
      : entry;
    const result = await new Promise((resolveRun, reject) => {
      const child = spawn(file, argv, {
        cwd: caller,
        env: environment,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      let stdout = '',
        stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (value) => {
        stdout += value;
      });
      child.stderr.on('data', (value) => {
        stderr += value;
      });
      child.on('error', reject);
      child.on('close', (code, signal) =>
        resolveRun({ argv: [entry, ...args], cwd: caller, code, signal, stdout, stderr })
      );
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
    report.commands.push(result);
    await save();
    if (expected !== null) assert.equal(result.code, expected, result.stderr);
    return result;
  };
  await save();
  try {
    const spec = await runtimeSpec();
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    const name = `scopeview-v${pkg.version}-${spec.target}`;
    const checksums = (await readFile(resolve(dirname(archive), `${name}.sha256`), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => line.split(/\s+/));
    assert.ok(
      checksums.some(([, file]) => file === basename(archive)),
      'Missing archive checksum'
    );
    for (const [digest, file] of checksums) {
      assert.equal(file, basename(file));
      assert.equal(sha256(await readFile(resolve(dirname(archive), file))), digest, file);
    }
    const listing = (await execute(tar, ['-tf', archive])).stdout.trim().split(/\r?\n/);
    assert.ok(listing.length > 10);
    assert.ok(
      listing.every((path) => path.startsWith(`${name}/`) && !path.split('/').includes('..'))
    );
    await execute(tar, ['-xf', archive, '-C', evidence]);
    const relocated = resolve(evidence, 'relocated package');
    await rename(resolve(evidence, name), relocated);
    const manifest = JSON.parse(await readFile(resolve(relocated, 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, pkg.version);
    assert.equal(manifest.target, spec.target);
    assert.equal(manifest.node.version, spec.version);
    assert.equal(manifest.node.sha256, spec.sha256);
    assert.equal(
      manifest.package.sha256,
      sha256(await readFile(resolve(dirname(archive), manifest.package.file)))
    );
    await access(resolve(relocated, 'licenses/Node-LICENSE'));
    await access(resolve(relocated, 'app/LICENSE'));
    await access(resolve(relocated, 'app/dist/fonts/LICENSE'));
    assert.deepEqual(
      JSON.parse(await readFile(resolve(relocated, 'app/package.json'), 'utf8')).bin,
      { scopeview: 'node/cli.mjs' }
    );
    const trap = resolve(evidence, 'external-runtime-traps');
    await mkdir(trap);
    for (const command of ['node', 'npm']) {
      const file = resolve(trap, `${command}${windows ? '.cmd' : ''}`);
      await writeFile(file, windows ? '@exit /b 99\r\n' : '#!/bin/sh\nexit 99\n');
      if (!windows) await chmod(file, 0o755);
    }
    environment.PATH = `${trap}${delimiter}${process.env.PATH}`;
    const entry = resolve(relocated, manifest.entry);
    assert.equal((await run(entry, ['--version'])).stdout.trim(), pkg.version);
    assert.match((await run(entry, ['--help'])).stdout, /Usage: scopeview/);
    assert.equal(
      JSON.parse((await run(entry, ['schema'])).stdout).$id,
      'urn:scopedb:scopeview:document:1'
    );
    assert.equal((await run(entry, ['example', 'top-list'])).stderr, '');
    for (const example of [
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
    ]) {
      const output = await run(entry, ['example', example]);
      const document = JSON.parse(output.stdout);
      // Independent exact-reading fixtures also cover zero, NULL and tiny hierarchy sources.
      if (example === 'bar') document.data.rows[0][1] = '9007199254740993';
      const input = Buffer.from(JSON.stringify(document));
      const inputFile = resolve(caller, `${example}.json`);
      const html = resolve(caller, `${example}.html`);
      await writeFile(inputFile, input);
      const valid = JSON.parse((await run(entry, ['validate', inputFile, '--json'])).stdout);
      assert.equal(valid.input.sha256, sha256(input));
      const rendered = await run(entry, [
        'render',
        inputFile,
        '-o',
        html,
        '--theme=system',
        '--json',
        ...(example === 'bar' ? ['--fonts'] : [])
      ]);
      const receipt = JSON.parse(rendered.stdout),
        bytes = await readFile(html);
      assert.deepEqual(receipt.output, { path: html, bytes: bytes.length, sha256: sha256(bytes) });
      const snapshot = JSON.parse(
        bytes.toString().match(/type="application\/json">([\s\S]*?)<\/script>/)[1]
      );
      if (document.data) assert.deepEqual(snapshot.data.rows, document.data.rows);
      else
        assert.deepEqual(
          snapshot[example === 'trace' ? 'spans' : 'frames'],
          document[example === 'trace' ? 'spans' : 'frames']
        );
      report.artifacts.push({
        name: example,
        file: html,
        bytes: bytes.length,
        sha256: sha256(bytes),
        document
      });
    }
    const stdin = await readFile(resolve(caller, 'top-list.json'));
    const validated = JSON.parse(
      (await run(entry, ['validate', '-', '--json'], { input: stdin })).stdout
    );
    assert.equal(validated.input.path, '-');
    assert.equal(validated.input.sha256, sha256(stdin));
    const fragment = (
      await run(entry, ['render', '-', '-o', '-', '--format=fragment'], { input: stdin })
    ).stdout;
    assert.match(fragment, /^<figure/);
    assert.match(fragment, /<h3>Requests by service<\/h3>/);
    const plot = (
      await run(entry, ['render', '-', '-o', '-', '--format=fragment', '--no-caption'], {
        input: stdin
      })
    ).stdout;
    assert.match(plot, /^<div/);
    assert.doesNotMatch(plot, /<figcaption>/);
    await run(entry, ['render', 'top-list.json', '-o', 'top-list.html', '--json'], { expected: 4 });
    await run(entry, ['render', 'top-list.json', '-o', 'top-list.html', '--force']);
    await run(entry, ['schema', '--kind=trace', '--json'], { expected: 2 });
    const malformed = await run(entry, ['validate', '-', '--json'], { input: '{', expected: 3 });
    assert.equal(JSON.parse(malformed.stderr).diagnostics[0].code, 'ERR_SCOPEVIEW_JSON');
    if (!windows) {
      const linked = resolve(caller, 'scopeview');
      await symlink(entry, linked);
      assert.equal((await run(linked, ['--version'])).stdout.trim(), pkg.version);
    }
    const binary = resolve(relocated, 'runtime', windows ? 'node.exe' : 'node');
    await rename(binary, `${binary}.hidden`);
    try {
      assert.notEqual((await run(entry, ['--version'], { expected: null })).code, 0);
    } finally {
      await rename(`${binary}.hidden`, binary);
    }
    report.status = 'passed';
    report.manifest = manifest;
    report.archiveBytes = (await stat(archive)).size;
    report.runtimeBytes = (await stat(binary)).size;
    report.packageBytes = (await stat(resolve(dirname(archive), manifest.package.file))).size;
    console.log(`Self-contained CLI accepted (${spec.target}): ${evidence}`);
    return report;
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    throw error;
  } finally {
    await save();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        archive: { type: 'string' },
        directory: { type: 'string', default: '.local/releases' }
      }
    });
    const candidates = values.archive
      ? [resolve(values.archive)]
      : (await readdir(values.directory))
          .filter((file) => /^scopeview-v.*\.(?:tar\.gz|zip)$/.test(file))
          .map((file) => resolve(values.directory, file));
    assert.equal(
      candidates.length,
      1,
      'Pass --archive or a --directory containing exactly one native CLI archive.'
    );
    await testDistribution(candidates[0]);
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  }
}
