import { describe, expect, it } from 'vitest';
import { compactFormat, formatInspectionNumber } from '../../../src/data/format.js';

describe('compact and complete numerical readings', () => {
  it('bounds huge summaries while preserving complete ordinary inspection values', () => {
    expect(compactFormat('9007199254740993')).toBe('9.01e+15');
    expect(compactFormat('-9007199254740993')).toBe('-9.01e+15');
    expect(compactFormat(1e12)).toBe('1.00e+12');
    expect(compactFormat(43820)).toBe('43.8K');
    expect(compactFormat(0)).toBe('0');
    expect(formatInspectionNumber(1234567)).toBe('1,234,567');
  });
});
