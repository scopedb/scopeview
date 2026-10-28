import { readFile } from 'node:fs/promises';
import { assetMissing, CliError } from './errors.mjs';

export const exampleNames = Object.freeze([
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
]);

export async function readAsset(relative, encoding) {
  try {
    return await readFile(new URL(relative, import.meta.url), encoding);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) throw assetMissing(relative, error);
    throw error;
  }
}

export async function packageVersion() {
  const pkg = JSON.parse(await readAsset('../package.json', 'utf8'));
  if (typeof pkg.version !== 'string' || !pkg.version) throw assetMissing('package.json version');
  return pkg.version;
}

export async function documentSchema() {
  return JSON.parse(await readAsset('../schemas/v1/document.schema.json', 'utf8'));
}

export async function exampleDocument(name) {
  if (!exampleNames.includes(name))
    throw new CliError(
      'ERR_SCOPEVIEW_USAGE',
      `Example must be one of: ${exampleNames.join(', ')}.`
    );
  return JSON.parse(await readAsset(`../examples/documents/${name}.json`, 'utf8'));
}
