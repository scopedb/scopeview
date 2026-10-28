export class ChartValidationError extends Error {
  constructor(
    public readonly path: string,
    message: string
  ) {
    super(`${path}: ${message}`);
    this.name = 'ChartValidationError';
  }
}

export const TEXT_LIMIT = 4096;

export function fail(path: string, message: string): never {
  throw new ChartValidationError(path, message);
}

export function object(
  value: unknown,
  path: string,
  keys?: readonly string[],
  expected = 'an object'
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(path, `Expected ${expected}.`);
  if (keys)
    for (const key of Object.keys(value))
      if (!keys.includes(key))
        fail(path === 'document' ? key : `${path}.${key}`, 'Unknown option.');
  return value as Record<string, unknown>;
}

export function text(value: unknown, path: string, nonempty = false): string {
  if (typeof value !== 'string' || value.length > TEXT_LIMIT || (nonempty && !value.length))
    fail(path, `Expected ${nonempty ? 'nonempty ' : ''}text of at most ${TEXT_LIMIT} characters.`);
  return value;
}

export function choice<const T extends string>(
  value: unknown,
  values: readonly T[],
  path: string
): T {
  if (typeof value !== 'string' || !values.includes(value as T))
    fail(path, `Expected ${values.join(', ')}.`);
  return value as T;
}

export function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'Expected a boolean.');
  return value;
}
