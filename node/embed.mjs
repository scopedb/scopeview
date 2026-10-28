export { serializeDocument } from './serialize.mjs';

/** Export an owned document as offline HTML. Importing this module has no CLI effects. */
export async function createEmbed(input, options) {
  const { buildHTML } = await import('./html.mjs');
  const { html, compiled } = await buildHTML(input, options);
  if (options?.onDiagnostic) {
    const { documentDiagnostics } = await import('./diagnostics.mjs');
    for (const diagnostic of documentDiagnostics(compiled, input)) options.onDiagnostic(diagnostic);
  }
  return html;
}
