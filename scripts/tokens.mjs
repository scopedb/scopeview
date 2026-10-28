import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = new Set(['color', 'dimension', 'duration', 'number', 'fontFamily', 'shadow']);
const reference = /\{([\w.-]+)\}/g;

/** ScopeView's versioned authoring format; no browser or runtime dependencies. */
export function compileTokens(document) {
  if (document.version !== 1) throw new Error('Unsupported design token version.');
  const tokens = new Map(),
    properties = new Set(),
    constants = new Set();
  function collect(group, path) {
    if (!group || typeof group !== 'object' || Array.isArray(group))
      throw new Error(`Invalid token group: ${path}`);
    if ('value' in group) {
      if (!types.has(group.type)) throw new Error(`Unknown token type: ${path}`);
      if (path.startsWith('foundation.') && (group.css || group.runtime))
        throw new Error(`Foundation tokens must remain private: ${path}`);
      if (group.css) {
        if (!/^--[a-z][a-z0-9-]*$/.test(group.css) || properties.has(group.css))
          throw new Error(`Invalid or duplicate CSS property: ${group.css}`);
        properties.add(group.css);
      }
      if (group.runtime) {
        if (!/^[a-z][a-zA-Z0-9]*$/.test(group.runtime) || constants.has(group.runtime))
          throw new Error(`Invalid or duplicate runtime constant: ${group.runtime}`);
        constants.add(group.runtime);
      }
      tokens.set(path, group);
    } else for (const [key, value] of Object.entries(group)) collect(value, `${path}.${key}`);
  }
  for (const layer of ['foundation', 'semantic', 'component']) collect(document[layer], layer);
  function resolveValue(path, css = false, stack = []) {
    const token = tokens.get(path);
    if (!token) throw new Error(`Unknown token reference: ${path}`);
    if (stack.includes(path)) throw new Error(`Token cycle: ${[...stack, path].join(' → ')}`);
    const value = token.value;
    if (typeof value === 'number') {
      if (token.type !== 'number' || !Number.isFinite(value))
        throw new Error(`Invalid numeric token: ${path}`);
      return value;
    }
    if (typeof value === 'object' && value !== null && token.type === 'color') {
      if (typeof value.light !== 'string' || typeof value.dark !== 'string')
        throw new Error(`Color scheme requires light and dark: ${path}`);
      return `light-dark(${value.light}, ${value.dark})`;
    }
    if (typeof value !== 'string' || !value.trim() || /[;\n]/.test(value))
      throw new Error(`Invalid token value: ${path}`);
    for (const [, target] of value.matchAll(reference)) {
      const rank = { foundation: 0, semantic: 1, component: 2 };
      if (rank[target.split('.')[0]] > rank[path.split('.')[0]])
        throw new Error(`Token layer violation: ${path} → ${target}`);
    }
    const alias = /^\{([\w.-]+)\}$/.exec(value)?.[1];
    if (alias) {
      if (!tokens.has(alias)) throw new Error(`Unknown token reference: ${alias}`);
      if (tokens.get(alias).type !== token.type)
        throw new Error(`Token alias type mismatch: ${path} → ${alias}`);
      if (!css || !tokens.get(alias).css) return resolveValue(alias, css, [...stack, path]);
    }
    // Foundation references are compiled away. Public role aliases remain live CSS variables.
    return value.replace(reference, (_, target) => {
      if (!tokens.has(target)) throw new Error(`Unknown token reference: ${target}`);
      return css && tokens.get(target).css
        ? `var(${tokens.get(target).css})`
        : String(resolveValue(target, css, [...stack, path]));
    });
  }
  const css = [],
    runtime = [],
    standalone = [];
  for (const [path, token] of tokens) {
    const resolved = resolveValue(path);
    if (token.type === 'dimension' && !/^\d+(?:\.\d+)?px$/.test(resolved))
      throw new Error(`Dimensions must use CSS pixels: ${path}`);
    if (token.type === 'duration' && !/^\d+(?:\.\d+)?ms$/.test(resolved))
      throw new Error(`Durations must use milliseconds: ${path}`);
    if (token.type === 'number' && typeof resolved !== 'number')
      throw new Error(`Number aliases must resolve to a number: ${path}`);
    if (token.css) {
      const value = resolveValue(path, true);
      css.push(
        `  ${token.css}: ${token.scale ? `calc(${value} * var(--scope-chart-font-scale))` : value};`
      );
    }
    if (token.runtime) {
      if (token.type !== 'dimension' && token.type !== 'number')
        throw new Error(`Runtime constants require a number or dimension: ${path}`);
      standalone.push(`export const ${token.runtime} = ${Number.parseFloat(resolved)};`);
      if (!token.standalone) runtime.push(`  ${token.runtime}`);
    }
  }
  return {
    css: `/* Generated from design-tokens.json by pnpm tokens:generate. */\n:host {\n${css.join('\n')}\n}\n`,
    runtime: `/** Generated design defaults in CSS pixels; change design-tokens.json. */\n${standalone.join('\n')}\nexport const CHART_TOKENS = {\n${runtime.join(',\n')}\n} as const;\n`,
    count: tokens.size
  };
}

function tokenSubset(css, sources, seriesLines = true) {
  const declarations = [...css.matchAll(/(--[\w-]+): ([^;]+);/g)];
  const needed = new Set(
    [...sources.matchAll(/(?:var\(|getPropertyValue\(['"])(--[\w-]+)/g)].map((match) => match[1])
  );
  // Family palette references interpolate a slot number; keep every declared slot.
  for (const prefix of [...needed].filter((name) => name.endsWith('-')))
    for (const [, name] of declarations)
      if (name.startsWith(prefix) && (seriesLines || !name.endsWith('-line'))) needed.add(name);
  let previous;
  do {
    previous = needed.size;
    for (const [, name, value] of declarations)
      if (needed.has(name))
        for (const [, dependency] of value.matchAll(/var\((--[\w-]+)/g)) needed.add(dependency);
  } while (needed.size !== previous);
  return css
    .split('\n')
    .filter((line) => {
      const name = /^\s*(--[\w-]+):/.exec(line)?.[1];
      return !name || needed.has(name);
    })
    .join('\n');
}

async function sourceText(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory()
          ? sourceText(path)
          : entry.name.endsWith('.ts')
            ? readFile(path, 'utf8')
            : '';
      })
    )
  ).join('\n');
}

export async function generateTokens({ check = false } = {}) {
  const document = JSON.parse(
    await readFile(resolve(root, 'src/theme/design-tokens.json'), 'utf8')
  );
  const compiled = compileTokens(document);
  // Intrinsic scalar readings need only the roles referenced by their own stylesheet.
  const scalarStyles = await readFile(resolve(root, 'src/theme/scalar.css'), 'utf8');
  const headlessStyles = await readFile(resolve(root, 'src/theme/headless.css'), 'utf8');
  const code = await sourceText(resolve(root, 'src'));
  const entityCode = (
    await Promise.all([
      ...['core', 'renderers', 'runtime', 'ui', 'families/hierarchy'].map((directory) =>
        sourceText(resolve(root, 'src', directory))
      ),
      ...['trace', 'profile'].map((family) =>
        readFile(resolve(root, `src/families/${family}.ts`), 'utf8')
      )
    ])
  ).join('\n');
  const baseTokens = tokenSubset(compiled.css, headlessStyles + entityCode, false);
  const baseNames = new Set([...baseTokens.matchAll(/(--[\w-]+):/g)].map((match) => match[1]));
  const metricTokens = tokenSubset(compiled.css, scalarStyles + headlessStyles + code)
    .split('\n')
    .filter((line) => !baseNames.has(/^\s*(--[\w-]+):/.exec(line)?.[1]))
    .join('\n');
  for (const [path, source] of [
    ['src/theme/tokens.css', compiled.css],
    ['src/theme/scalar-tokens.css', tokenSubset(compiled.css, scalarStyles)],
    ['src/theme/headless-tokens.css', baseTokens],
    ['src/theme/metric-tokens.css', metricTokens],
    ['src/theme/visual-tokens.ts', compiled.runtime]
  ]) {
    const formatted = execFileSync(
      resolve(root, 'node_modules/.bin/biome'),
      ['format', `--stdin-file-path=${path}`],
      { input: source, cwd: root, encoding: 'utf8' }
    );
    if (check) {
      if ((await readFile(resolve(root, path), 'utf8')) !== formatted)
        throw new Error(`${path} is stale. Run pnpm tokens:generate.`);
    } else await writeFile(resolve(root, path), formatted);
  }
  console.log(`Design tokens ${check ? 'verified' : 'generated'}: ${compiled.count} tokens.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await generateTokens({ check: process.argv.includes('--check') });
