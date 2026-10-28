import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const execute = promisify(execFile);
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const windows = process.platform === 'win32';
export const tar = windows ? join(process.env.SystemRoot, 'System32/tar.exe') : 'tar';

/** Invoke npm's JS entry directly, including on Windows where npm.cmd is not an executable. */
export async function npmCLI() {
  const candidates = [
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    ...(process.env.PATH ?? '')
      .split(delimiter)
      .map((directory) => join(directory, 'node_modules/npm/bin/npm-cli.js'))
  ];
  for (const candidate of candidates)
    if (
      await access(candidate).then(
        () => true,
        () => false
      )
    )
      return candidate;
  throw new Error('Install npm alongside the build-time Node.js runtime.');
}

export async function runtimeSpec() {
  const version = (await readFile(resolve(root, '.node-version'), 'utf8')).trim();
  assert.match(version, /^24\.\d+\.\d+$/, 'Pin an exact Node 24 runtime in .node-version');
  const platform = windows ? 'win' : process.platform;
  const target = `${windows ? 'windows' : process.platform}-${process.arch}`;
  const archive = `node-v${version}-${platform}-${process.arch}.${windows ? 'zip' : 'tar.gz'}`;
  const checksums = await readFile(
    new URL('./distribution/node-shasums.txt', import.meta.url),
    'utf8'
  );
  const digest = checksums
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === archive)?.[0];
  assert.match(digest ?? '', /^[a-f0-9]{64}$/, `No pinned official Node runtime for ${target}`);
  return { version, target, archive, sha256: digest };
}

async function runtimeArchive(spec, supplied, cache) {
  const file = supplied ? resolve(supplied) : resolve(cache, spec.archive);
  if (
    !supplied &&
    !(await access(file).then(
      () => true,
      () => false
    ))
  ) {
    const url = `https://nodejs.org/dist/v${spec.version}/${spec.archive}`;
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Cannot download official Node runtime: HTTP ${response.status} ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(sha256(bytes), spec.sha256, `Node runtime checksum mismatch: ${spec.archive}`);
    await mkdir(cache, { recursive: true });
    // Only verified bytes enter the cache; interrupted downloads are never reused.
    const temporary = await mkdtemp(join(cache, '.download-'));
    try {
      await writeFile(join(temporary, spec.archive), bytes);
      await rename(join(temporary, spec.archive), file);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  assert.equal(
    sha256(await readFile(file)),
    spec.sha256,
    `Node runtime checksum mismatch: ${file}`
  );
  return file;
}

/** Build from the actual npm tarball, adding only a pinned official runtime and launcher. */
export async function buildDistribution({
  output = '.local/releases',
  runtime,
  package: packageFile,
  cache = '.local/node-cache'
} = {}) {
  const destination = resolve(root, output);
  await mkdir(destination, { recursive: true });
  const temporary = await mkdtemp(resolve(destination, '.build-'));
  try {
    const spec = await runtimeSpec();
    const nodeArchive = await runtimeArchive(spec, runtime, resolve(root, cache));
    let filename;
    if (packageFile) {
      filename = basename(packageFile);
      await copyFile(resolve(packageFile), resolve(temporary, filename));
    } else {
      await stat(resolve(root, 'dist/index.js'));
      filename = JSON.parse(
        (
          await execute(
            process.execPath,
            [await npmCLI(), 'pack', '--ignore-scripts', '--json', '--pack-destination', temporary],
            { cwd: root, maxBuffer: 4 * 1024 * 1024 }
          )
        ).stdout
      )[0].filename;
    }
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    assert.deepEqual(pkg.bin, { scopeview: 'node/cli.mjs' });
    assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
    const name = `scopeview-v${pkg.version}-${spec.target}`;
    const stage = resolve(temporary, name);
    await mkdir(stage);
    await execute(tar, ['-xf', resolve(temporary, filename), '-C', stage]);
    await rename(resolve(stage, 'package'), resolve(stage, 'app'));
    const installed = JSON.parse(await readFile(resolve(stage, 'app/package.json'), 'utf8'));
    assert.equal(installed.name, pkg.name);
    assert.equal(installed.version, pkg.version);
    assert.deepEqual(installed.bin, pkg.bin, 'Use the npm tarball from this revision');
    const nodeRoot = spec.archive.replace(/\.(?:tar\.gz|zip)$/, '');
    const binary = windows ? 'node.exe' : 'bin/node';
    await execute(tar, [
      '-xf',
      nodeArchive,
      '-C',
      temporary,
      `${nodeRoot}/${binary}`,
      `${nodeRoot}/LICENSE`
    ]);
    await mkdir(resolve(stage, 'runtime'));
    await copyFile(
      resolve(temporary, nodeRoot, binary),
      resolve(stage, 'runtime', windows ? 'node.exe' : 'node')
    );
    if (!windows) await chmod(resolve(stage, 'runtime/node'), 0o755);
    await mkdir(resolve(stage, 'licenses'));
    await copyFile(
      resolve(temporary, nodeRoot, 'LICENSE'),
      resolve(stage, 'licenses/Node-LICENSE')
    );
    await mkdir(resolve(stage, 'bin'));
    const launcher = windows ? 'scopeview.cmd' : 'scopeview';
    await copyFile(
      new URL(`./distribution/${launcher}`, import.meta.url),
      resolve(stage, 'bin', launcher)
    );
    if (!windows) await chmod(resolve(stage, 'bin', launcher), 0o755);
    const manifest = {
      name: pkg.name,
      version: pkg.version,
      target: spec.target,
      entry: `bin/${launcher}`,
      node: { version: spec.version, archive: spec.archive, sha256: spec.sha256 },
      package: {
        file: filename,
        sha256: sha256(await readFile(resolve(temporary, filename)))
      }
    };
    await writeFile(resolve(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    // Test the exact copied executable, not the build machine's Node or PATH shim.
    const observed = await execute(resolve(stage, 'runtime', windows ? 'node.exe' : 'node'), [
      '--version'
    ]);
    assert.equal(observed.stdout.trim(), `v${spec.version}`);
    const archiveName = `${name}.${windows ? 'zip' : 'tar.gz'}`;
    const artifact = resolve(temporary, archiveName);
    await execute(tar, [
      ...(windows ? ['--format=zip', '-cf'] : ['-czf']),
      artifact,
      '-C',
      temporary,
      name
    ]);
    const checksums = [archiveName, filename].map((file) =>
      readFile(resolve(temporary, file)).then((bytes) => `${sha256(bytes)}  ${file}`)
    );
    await writeFile(
      resolve(temporary, `${name}.sha256`),
      `${(await Promise.all(checksums)).join('\n')}\n`
    );
    for (const file of [archiveName, filename, `${name}.sha256`])
      await cp(resolve(temporary, file), resolve(destination, file));
    return {
      archive: resolve(destination, archiveName),
      checksum: resolve(destination, `${name}.sha256`),
      manifest
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        output: { type: 'string' },
        runtime: { type: 'string' },
        package: { type: 'string' },
        cache: { type: 'string' }
      }
    });
    const result = await buildDistribution(values);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
