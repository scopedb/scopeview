import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildDistribution, runtimeSpec } from '../../scripts/distribution.mjs';

test('corrupt supplied or cached runtimes fail before replacing prior distribution files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'scopeview-distribution-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const spec = await runtimeSpec();
  const archive = join(directory, spec.archive);
  await writeFile(archive, 'not the pinned Node runtime');
  await writeFile(join(directory, 'prior.tgz'), 'prior distribution');
  for (const source of [{ runtime: archive }, { cache: directory }]) {
    await assert.rejects(
      buildDistribution({ output: directory, ...source }),
      /Node runtime checksum mismatch/
    );
    assert.deepEqual((await readdir(directory)).sort(), [spec.archive, 'prior.tgz'].sort());
  }
});
