import { assetMissing } from './errors.mjs';

/** The built public compiler is the only document validator in the Node tools. */
export async function compileDocument(input) {
  try {
    const { compileVisualization } = await import('../dist/index.js');
    return compileVisualization(input);
  } catch (error) {
    if (['ERR_MODULE_NOT_FOUND', 'ENOENT'].includes(error.code))
      throw assetMissing('public compiler', error);
    throw error;
  }
}
