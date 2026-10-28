import { chromium } from '@playwright/test';
import { assetFailureChecks, createPackedConsumer, exercisePackedConsumer } from './fixture.mjs';
import { observePackedHTML } from './browser.mjs';

const { values } = parseArgs({ options: { 'artifact-output': { type: 'string' } } });
const fixture = await createPackedConsumer();
let browser;
try {
  const files = await exercisePackedConsumer(fixture);
  await assetFailureChecks(fixture);
  browser = await chromium.launch();
  await observePackedHTML(browser, fixture, files);
  fixture.report.status = 'passed';
  if (values['artifact-output']) {
    const directory = resolve(values['artifact-output']);
    const archive = fixture.report.package.archive;
    await mkdir(directory, { recursive: true });
    await copyFile(archive, resolve(directory, basename(archive)));
    await writeFile(
      resolve(directory, `${basename(archive)}.sha256`),
      `${fixture.report.package.sha256}  ${basename(archive)}\n`
    );
  }
  console.log(
    `Packed package accepted: ${fixture.pkg.name}@${fixture.pkg.version}\nArchive, inventory, commands, hashes and browser observations: ${fixture.evidence}`
  );
} catch (error) {
  fixture.report.status = 'failed';
  fixture.report.failure = error.message;
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await fixture.save();
}
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
