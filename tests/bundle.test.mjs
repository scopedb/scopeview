import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'scopeview-bundle-'));
after(() => rm(directory, { recursive: true, force: true }));
const installed = join(directory, 'node_modules/@scopedb/scopeview');
await mkdir(installed, { recursive: true });
await cp('dist', join(installed, 'dist'), { recursive: true });
await cp('package.json', join(installed, 'package.json'));
let sequence = 0;
async function consumer(source, format = 'iife') {
  const entry = join(directory, `consumer-${sequence++}.js`);
  await writeFile(entry, source);
  const result = await build({
    root: directory,
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: true,
      lib: { entry, name: 'Consumer', cssFileName: 'consumer', formats: [format] }
    }
  });
  return [result].flat().flatMap((item) => item.output);
}
const code = (output) =>
  output
    .filter((item) => item.type === 'chunk')
    .map((item) => item.code)
    .join('\n');
const size = (output) =>
  output.reduce(
    (bytes, item) => bytes + gzipSync(item.type === 'chunk' ? item.code : item.source).byteLength,
    0
  );

for (const [entry, limit] of Object.entries({
  scalar: 4,
  chart: 33,
  'chart/axis': 29,
  'chart/scatter': 27,
  'chart/donut': 27,
  'chart/top-list': 27,
  'chart/treemap': 27,
  trace: 21,
  flame: 20,
  headless: 39
})) {
  test(`${entry} stays within ${limit} KiB gzip as a complete consumer`, async () => {
    const output = await consumer(
      `import * as api from '@scopedb/scopeview/${entry}'; globalThis.api = api;`
    );
    const bytes = size(output);
    assert.ok(bytes <= limit * 1024, `${entry}: ${bytes} bytes gzip exceeds ${limit} KiB`);
    console.log(`${entry}: ${bytes} bytes gzip`);
  });
}

test('the root API executes without browser globals', async () => {
  const output = await consumer("import * as api from '@scopedb/scopeview'; globalThis.api = api;");
  const context = {};
  runInNewContext(code(output), context);
  assert.equal(typeof context.api.compileChart, 'function');
  assert.equal(typeof context.api.compileTrace, 'function');
  assert.equal(typeof context.api.compileProfile, 'function');
});

test('unused imports vanish and a named scalar import costs no more than its subpath', async () => {
  const unused = await consumer(
    "import { parseViewState } from '@scopedb/scopeview'; import '@scopedb/scopeview/scalar'; import { resolveTheme } from '@scopedb/scopeview/theme'; globalThis.marker = true;"
  );
  for (const chunk of unused.filter((item) => item.type === 'chunk'))
    assert.equal(
      Object.entries(chunk.modules).some(
        ([id, module]) => id.includes('/dist/') && module.renderedLength > 0
      ),
      false
    );
  assert.equal(
    unused.some((item) => item.type === 'asset'),
    false
  );
  const barrel = await consumer(
    "import { createScalar } from '@scopedb/scopeview/headless'; globalThis.used = createScalar;"
  );
  const direct = await consumer(
    "import { createScalar } from '@scopedb/scopeview/scalar'; globalThis.used = createScalar;"
  );
  assert.equal(size(barrel), size(direct));
});

test('shared lifecycle keeps optional interaction capabilities out of headless and Canvas out of scalar', async () => {
  const [headless, runtime, interactions, scalar] = await Promise.all(
    ['headless', 'runtime', 'interactions', 'scalar'].map(async (entry) =>
      code(
        await consumer(`import * as api from '@scopedb/scopeview/${entry}'; globalThis.api = api;`)
      )
    )
  );
  // Check retained behavior independently of internal chunk names.
  for (const [capability, marker, optional] of [
    ['range selection', 'range-handles', runtime],
    ['linked highlighting', 'linkedHighlight', runtime],
    ['viewport input', 'deltaMode', runtime],
    ['viewport state', 'Invalid viewport bounds.', interactions]
  ]) {
    assert.ok(optional.includes(marker), `${capability} must remain available through its entry`);
    assert.ok(!headless.includes(marker), `headless retained optional ${capability}`);
  }
  for (const marker of ['ResizeObserver', 'resolution:', 'getContext']) {
    assert.ok(headless.includes(marker), `headless must retain ${marker}`);
    assert.ok(!scalar.includes(marker), `scalar retained Canvas lifecycle code: ${marker}`);
  }
});

test('component definitions have no registration effect; a bare register import survives bundling', async () => {
  for (const [source, expected] of [
    ["import * as api from '@scopedb/scopeview/element'; globalThis.api = api;", []],
    ["import '@scopedb/scopeview/register';", ['scope-chart', 'scope-flame', 'scope-trace']]
  ]) {
    const registered = new Map();
    const context = {
      HTMLElement: class {},
      customElements: {
        get: (name) => registered.get(name),
        define: (name, ctor) => registered.set(name, ctor)
      }
    };
    runInNewContext(code(await consumer(source)), context);
    assert.deepEqual([...registered.keys()].sort(), expected);
    if (!expected.length) assert.equal(typeof context.api.ScopeChartElement, 'function');
  }
});

test('font CSS imports retain both font payloads', async () => {
  const output = await consumer("import '@scopedb/scopeview/fonts.css';");
  const css = output
    .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
    .map((item) => item.source)
    .join('\n');
  assert.equal([...css.matchAll(/@font-face/g)].length, 2);
  assert.equal([...css.matchAll(/data:font\/woff2;base64,/g)].length, 2);
});

test('the report entry defers chart code to dynamic imports', async () => {
  const output = await consumer(
    "import { createReport } from '@scopedb/scopeview/report'; globalThis.used = createReport;",
    'es'
  );
  const chunks = new Map(
    output.filter((item) => item.type === 'chunk').map((item) => [item.fileName, item])
  );
  const initial = new Set();
  function visit(name) {
    if (initial.has(name)) return;
    initial.add(name);
    for (const imported of chunks.get(name).imports) visit(imported);
  }
  visit(output.find((item) => item.isEntry).fileName);
  assert.ok(size([...initial].map((name) => chunks.get(name))) <= 2048);
  assert.ok([...chunks.values()].some((chunk) => chunk.dynamicImports.length));
  assert.ok(chunks.size > initial.size);
  assert.ok(size(output) > 20000);
});

test('the shipped standalone script stays within 39 KiB gzip', async () => {
  assert.ok(gzipSync(await readFile(resolve('dist/scopeview.js'))).byteLength <= 39 * 1024);
});
