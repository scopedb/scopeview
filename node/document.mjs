import { documentDiagnostics } from './diagnostics.mjs';
import { compileDocument } from './compile.mjs';

/** Derive CLI metadata from an already compiled document; never validate it again. */
export function describeDocument(compiled, input) {
  const { kind, document } = compiled;
  const summary = {
    version: 1,
    kind,
    records:
      kind === 'metric'
        ? document.data.rows.length
        : document[kind === 'trace' ? 'spans' : 'frames'].length,
    fields: kind === 'metric' ? document.data.fields.length : null
  };
  return { compiled, summary, diagnostics: documentDiagnostics(compiled, input) };
}

export async function prepareDocument(input) {
  return describeDocument(await compileDocument(input), input);
}
