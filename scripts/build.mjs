import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';
import { generateTokens } from './tokens.mjs';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const entries = {};
for (const [subpath, target] of Object.entries(pkg.exports)) {
  if (!target?.import?.startsWith('./dist/')) continue;
  const name = target.import.match(/^\.\/dist\/([a-z][a-z0-9-]*)\.js$/)?.[1];
  assert.ok(name, `Invalid library entry: ${subpath}`);
  assert.equal(target.types, `./dist/${name}.d.ts`, `Mismatched declaration: ${subpath}`);
  entries[name] = `src/${name}.ts`;
}
await generateTokens({ check: true });
// Preserve native light-dark() so the host color-scheme selects the colors.
const cssTarget = ['chrome123', 'edge123', 'firefox121', 'safari17.5'];
await build({
  configFile: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist',
    cssTarget,
    lib: { entry: entries, formats: ['es'], fileName: (_, name) => `${name}.js` }
  }
});
// Offline HTML and classic scripts use the same all-family browser implementation.
await build({
  configFile: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    cssTarget,
    minify: true,
    lib: {
      entry: entries.headless,
      name: 'ScopeView',
      formats: ['iife'],
      fileName: () => 'scopeview.js'
    }
  }
});
await mkdir('dist/fonts', { recursive: true });
const fontRoot = resolve('node_modules/@fontsource/inter');
let fontCSS = '';
for (const weight of [400, 600]) {
  const filename = `inter-latin-${weight}-normal.woff2`;
  await copyFile(`${fontRoot}/files/${filename}`, `dist/fonts/${filename}`);
  fontCSS += `@font-face{font-family:Inter;font-style:normal;font-weight:${weight};font-display:swap;src:url('./fonts/${filename}') format('woff2')}\n`;
}
await writeFile('dist/fonts.css', fontCSS);
await copyFile(`${fontRoot}/LICENSE`, 'dist/fonts/LICENSE');
await copyFile('LICENSE', 'dist/LICENSE');
await mkdir('dist/theme', { recursive: true });
await copyFile('src/theme/design-tokens.json', 'dist/theme/design-tokens.json');
