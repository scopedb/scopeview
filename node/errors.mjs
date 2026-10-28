/** Transport/protocol failures are separate from the public compiler's exceptions. */
export class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function assetMissing(asset, cause) {
  return Object.assign(
    new Error(
      `Missing installed ScopeView asset (${asset}). Install a complete matching @scopedb/scopeview package.`,
      { cause }
    ),
    { code: 'ERR_SCOPEVIEW_ASSET_MISSING' }
  );
}

export function failure(error) {
  const document = error?.name === 'ChartValidationError' && typeof error.path === 'string';
  const theme = error?.code === 'ERR_SCOPEVIEW_THEME';
  // Keep native Node API exceptions intact; classify filesystem failures only at the CLI boundary.
  const filesystem = ['EACCES', 'EPERM', 'EIO', 'EMFILE', 'ENFILE', 'ENOSPC', 'EROFS'].includes(
    error?.code
  );
  const code = theme
    ? 'ERR_SCOPEVIEW_THEME'
    : document
      ? 'ERR_SCOPEVIEW_DOCUMENT'
      : filesystem
        ? 'ERR_SCOPEVIEW_IO'
        : error?.code;
  const exits = {
    ERR_SCOPEVIEW_USAGE: 2,
    ERR_SCOPEVIEW_JSON: 3,
    ERR_SCOPEVIEW_DOCUMENT: 3,
    ERR_SCOPEVIEW_THEME: 3,
    ERR_SCOPEVIEW_IO: 4,
    ERR_SCOPEVIEW_OUTPUT_EXISTS: 4,
    ERR_SCOPEVIEW_INPUT_OUTPUT_ALIAS: 4,
    ERR_SCOPEVIEW_OUTPUT_TYPE: 4,
    ERR_SCOPEVIEW_ASSET_MISSING: 4,
    ERR_SCOPEVIEW_NODE_VERSION: 4,
    ERR_SCOPEVIEW_INPUT_LIMIT: 5,
    ERR_SCOPEVIEW_FRAGMENT_SIZE: 5
  };
  return {
    exitCode: exits[code] ?? 1,
    diagnostic: {
      severity: 'error',
      code: exits[code] ? code : 'ERR_SCOPEVIEW_INTERNAL',
      path: document ? error.path : null,
      message: error instanceof Error ? error.message : 'Unexpected ScopeView failure.'
    }
  };
}
