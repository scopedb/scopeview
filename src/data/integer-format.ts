const INTEGER_FORMAT = new Intl.NumberFormat('en-US');

/** Group exact integers without rebuilding locale data or rounding supplied digits. */
export function formatInteger(value: bigint): string {
  return INTEGER_FORMAT.format(value);
}
