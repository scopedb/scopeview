import { describe, expect, it } from 'vitest';
import { formatQuantity } from '../../../src/data/semantics.js';

describe('exact default quantity readings', () => {
  it.each([
    ['0.1234567890123456789', '0.1234567890123456789'],
    ['1.0000000000000000001', '1.0000000000000000001'],
    ['12345678901234567890.1234567890123456789', '12,345,678,901,234,567,890.1234567890123456789'],
    ['-0.00000000000000000000000000001', '-0.00000000000000000000000000001'],
    ['1.234567890123456789e-8', '0.00000001234567890123456789'],
    ['1.25e3', '1,250'],
    ['1.25e-3', '0.00125'],
    ['+001234.5000', '1,234.5'],
    ['.5', '0.5'],
    ['-0.00', '-0'],
    ['9007199254740993', '9,007,199,254,740,993'],
    ['0', '0'],
    [null, 'NULL']
  ])('preserves the supplied value of %s', (raw, expected) => {
    expect(formatQuantity(raw)).toBe(expected);
  });

  it.each([
    [' 42 ', '42'],
    ['\t0.1234567890123456789\n', '0.1234567890123456789'],
    [' 9007199254740993 ', '9,007,199,254,740,993'],
    [' -0 ', '-0'],
    [' 1.25e3 ', '1,250'],
    ['', '0'],
    [' \t\r\n', '0'],
    ['\u00a0\ufeff', '0'],
    ['0x10', '16'],
    [' 0X20000000000001 ', '9,007,199,254,740,993'],
    ['0o20', '16'],
    ['0b10000', '16']
  ])('keeps compiler-compatible numeric input %j readable', (raw, expected) => {
    expect(formatQuantity(raw)).toBe(expected);
  });

  it('retains extreme exponent notation without an unbounded text expansion', () => {
    expect(formatQuantity('1e-1000000')).toBe('1e-1000000');
    expect(formatQuantity('1e1000000')).toBe('1e1000000');
  });

  it('keeps explicit display scaling and decimals as the declared reading contract', () => {
    expect(formatQuantity('0.1234567890123456789', { divisor: '1', decimals: 2, unit: 's' })).toBe(
      '0.12 s'
    );
    expect(
      formatQuantity('1.0000000000000000001', { divisor: '1000', decimals: 3, unit: 's' })
    ).toBe('0.001 s');
  });
});
