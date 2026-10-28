import { parseArgs } from 'node:util';
import { CliError, failure } from './errors.mjs';
import { DEFAULT_MAX_INPUT_BYTES, readInput, stageOutput, writeStream } from './io.mjs';
import { documentSchema, exampleDocument, exampleNames, packageVersion } from './resources.mjs';

const option = (type, description, extra = {}) => ({ type, description, ...extra });
const options = {
  help: option('boolean', 'Show usage', { short: 'h' }),
  json: option('boolean', 'Print a JSON receipt or error'),
  'max-input-bytes': option('string', `Input byte cap (default ${DEFAULT_MAX_INPUT_BYTES})`),
  output: option('string', 'Output path, or - for stdout', { short: 'o' }),
  format: option('string', 'Output format (default html)', { values: ['html', 'fragment'] }),
  theme: option('string', 'light, dark, system, or a theme JSON file (default light)'),
  'no-caption': option('boolean', 'Hide the document caption'),
  'no-legend': option('boolean', 'Hide the series legend'),
  'no-tooltip': option('boolean', 'Hide the built-in reading'),
  fonts: option('boolean', 'Embed Inter font files'),
  lang: option('string', 'Language tag (default en)'),
  force: option('boolean', 'Replace an existing regular output file')
};
const commands = {
  validate: {
    operand: '<input|->',
    description: 'Validate a document',
    flags: ['json', 'max-input-bytes']
  },
  render: {
    operand: '<input|->',
    description: 'Export offline HTML',
    flags: [
      'output',
      'format',
      'theme',
      'no-caption',
      'no-legend',
      'no-tooltip',
      'fonts',
      'lang',
      'force',
      'json',
      'max-input-bytes'
    ]
  },
  schema: { description: 'Print the version-1 document schema', flags: [] },
  example: { operand: '<name>', description: 'Print a synthetic document', flags: [] }
};
const usageError = (message) => {
  throw new CliError('ERR_SCOPEVIEW_USAGE', message);
};

function help(command) {
  if (!command)
    return `Usage: scopeview <command> [options]\n\n${Object.entries(commands)
      .map(([name, spec]) => `  ${name.padEnd(10)} ${spec.description}`)
      .join(
        '\n'
      )}\n\n  --help, -h  Show usage\n  --version   Show package version\n\nUse scopeview <command> --help for options.\n`;
  const spec = commands[command];
  const flags = [...spec.flags, 'help'].map((name) => {
    const flag = options[name];
    return `  --${name}${flag.short ? `, -${flag.short}` : ''}${flag.values ? ` <${flag.values.join('|')}>` : flag.type === 'string' ? ' <value>' : ''}  ${flag.description}`;
  });
  return `Usage: scopeview ${command}${spec.operand ? ` ${spec.operand}` : ''}${command === 'render' ? ' --output <path|->' : ''}\n${flags.join('\n')}\n${command === 'example' ? `Examples: ${exampleNames.join(', ')}\n` : ''}`;
}

export function machineErrors(args) {
  const end = args.indexOf('--');
  return args.slice(0, end === -1 ? args.length : end).includes('--json');
}

/** One command table owns parsing and help; all arguments are checked before input I/O. */
export function parseCommand(args) {
  const [command = '--help', ...rest] = args;
  if (['--help', '-h', '--version'].includes(command)) {
    if (rest.length) usageError('Help/version accept no additional arguments.');
    return { command: command === '--version' ? 'version' : 'help', options: {} };
  }
  const spec = commands[command];
  if (!Object.hasOwn(commands, command)) usageError(`Unknown command: ${command}.\n${help()}`);
  const definitions = Object.fromEntries(
    [...spec.flags, 'help'].map((name) => [
      name,
      { type: options[name].type, ...(options[name].short ? { short: options[name].short } : {}) }
    ])
  );
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: definitions, allowPositionals: true, tokens: true });
  } catch (error) {
    usageError(error.message);
  }
  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) usageError(`Repeated option: --${token.name}.`);
    seen.add(token.name);
  }
  const values = parsed.values;
  for (const [name, value] of Object.entries(values)) {
    if (value === '') usageError(`Option --${name} requires a nonempty value.`);
    if (options[name].values && !options[name].values.includes(value))
      usageError(`--${name} must be ${options[name].values.join(', ')}.`);
  }
  if (values['max-input-bytes'] !== undefined) {
    const value = values['max-input-bytes'];
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0)
      usageError('--max-input-bytes must be a positive safe integer.');
    values['max-input-bytes'] = Number(value);
  }
  if (values.lang !== undefined) {
    try {
      if (!values.lang.trim()) throw new Error();
      values.lang = Intl.getCanonicalLocales(values.lang)[0];
    } catch {
      usageError('--lang must be one valid nonempty language tag.');
    }
  }
  if (values.json && values.output === '-')
    usageError('--json cannot be combined with --output -; stdout contains HTML only.');
  if (values.theme === '-')
    usageError('--theme requires a mode or a JSON file path; stdin is reserved for the document.');
  const expected = spec.operand ? 1 : 0;
  const count = parsed.positionals.length;
  if (values.help && count <= expected)
    return { command: 'help', helpCommand: command, options: values };
  if (count !== expected || parsed.positionals.some((value) => !value))
    usageError(
      `${command} requires ${expected ? 'exactly one input/name' : 'no positional inputs'}.\n${help(command)}`
    );
  if (command === 'render' && !values.output)
    usageError(`render requires --output.\n${help(command)}`);
  if (command === 'example' && !exampleNames.includes(parsed.positionals[0]))
    usageError(`Unknown example. Choose: ${exampleNames.join(', ')}.`);
  return { command, options: values, operand: parsed.positionals[0] };
}

export async function runCLI(args = process.argv.slice(2)) {
  const json = machineErrors(args);
  let version = null;
  try {
    const parsed = parseCommand(args);
    if (Number(process.versions.node.split('.')[0]) < 24)
      throw new CliError('ERR_SCOPEVIEW_NODE_VERSION', 'ScopeView requires Node.js 24 or newer.');
    version = await packageVersion();
    const { command, options, operand } = parsed;
    if (command === 'help') {
      await writeStream(process.stdout, help(parsed.helpCommand));
      return;
    }
    if (command === 'version') {
      await writeStream(process.stdout, `${version}\n`);
      return;
    }
    if (command === 'schema' || command === 'example') {
      const resource =
        command === 'schema' ? await documentSchema() : await exampleDocument(operand);
      await writeStream(process.stdout, `${JSON.stringify(resource, null, 2)}\n`);
      return;
    }
    const input = await readInput(operand, options['max-input-bytes']);
    const receipt = { schemaVersion: 1, scopeviewVersion: version, input: input.receipt };
    let result;
    let success;
    if (command === 'validate') {
      const { prepareDocument } = await import('./document.mjs');
      result = await prepareDocument(input.document);
      success = {
        ...receipt,
        status: 'validated',
        document: result.summary,
        diagnostics: result.diagnostics
      };
    } else {
      const { buildHTML } = await import('./html.mjs');
      const { describeDocument } = await import('./document.mjs');
      const format = options.format ?? 'html';
      let theme = options.theme;
      if (theme !== undefined && !['light', 'dark', 'system'].includes(theme)) {
        let themeInput;
        try {
          themeInput = await readInput(theme, 65_536);
        } catch (error) {
          error.message = `Theme file (${theme}): ${error.code === 'ERR_SCOPEVIEW_INPUT_LIMIT' ? 'Expected at most 65536 bytes.' : error.message}`;
          throw error;
        }
        input.related = [themeInput];
        receipt.theme = themeInput.receipt;
        theme = themeInput.document;
      }
      result = await buildHTML(input.document, {
        format,
        theme,
        fonts: options.fonts,
        lang: options.lang,
        caption: !options['no-caption'],
        legend: !options['no-legend'],
        tooltip: !options['no-tooltip']
      });
      Object.assign(result, describeDocument(result.compiled, input.document));
      if (options.output === '-') await writeStream(process.stdout, result.html);
      else {
        const staged = await stageOutput(options.output, result.html, input, options.force);
        const output = await staged.publish();
        success = {
          ...receipt,
          status: 'exported',
          document: result.summary,
          format,
          output,
          diagnostics: result.diagnostics
        };
      }
    }
    if (options.json) await writeStream(process.stdout, `${JSON.stringify(success)}\n`);
    else {
      for (const diagnostic of result.diagnostics)
        await writeStream(
          process.stderr,
          `Warning ${diagnostic.code} (${diagnostic.path}): ${diagnostic.message}\n`
        );
      if (success)
        await writeStream(
          process.stdout,
          command === 'render'
            ? `${success.output.path}\n`
            : `Valid ${result.summary.kind} document: ${result.summary.records} records${result.summary.fields === null ? '' : `, ${result.summary.fields} fields`}.\n`
        );
    }
  } catch (error) {
    if (version === null) version = await packageVersion().catch(() => null);
    const { exitCode, diagnostic } = failure(error);
    process.exitCode = exitCode;
    const output = json
      ? JSON.stringify({
          schemaVersion: 1,
          scopeviewVersion: version,
          status: 'error',
          diagnostics: [diagnostic]
        })
      : `${diagnostic.code}: ${diagnostic.message}`;
    await writeStream(process.stderr, `${output}\n`).catch(() => {});
  }
}
