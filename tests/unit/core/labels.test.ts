import { describe, expect, it } from 'vitest';
import { fitLabel, inspectionText } from '../../../src/core/labels.js';

const measure = (text: string) => [...text].length;

describe('readable Canvas labels', () => {
  it('preserves complete emoji and combining characters at truncation boundaries', () => {
    expect(fitLabel('👩🏽‍💻工作', 4, measure)).toBe('');
    expect(fitLabel('👩🏽‍💻工作', 5, measure)).toBe('👩🏽‍💻…');
    expect(fitLabel('e\u0301clair', 2, measure)).toBe('');
    expect(fitLabel('e\u0301clair', 3, measure)).toBe('e\u0301…');
    expect(fitLabel('🇨🇳数据', 2, measure)).toBe('');
    expect(fitLabel('🇨🇳数据', 3, measure)).toBe('🇨🇳…');
  });
  it('fits ordinary and CJK text without adding a bare ellipsis', () => {
    expect(fitLabel('Read', 4, measure)).toBe('Read');
    expect(fitLabel('Read data', 5, measure)).toBe('Read…');
    expect(fitLabel('中文測試檢索', 5, measure)).toBe('中文測試…');
    expect(fitLabel('Read', 0, measure)).toBe('');
    expect(fitLabel('Read', -1, measure)).toBe('');
    expect(fitLabel('\u200b', 0, () => 0)).toBe('\u200b');
  });
  it('omits unreadable fragments while keeping complete short names and grapheme boundaries', () => {
    expect(fitLabel('retry timeout', 4, measure, 4)).toBe('');
    expect(fitLabel('retry timeout', 5, measure, 4)).toBe('retr…');
    expect(fitLabel('IO', 2, measure, 4)).toBe('IO');
    expect(fitLabel('e\u0301clair', 5, measure, 4)).toBe('');
    expect(fitLabel('e\u0301clair', 6, measure, 4)).toBe('e\u0301cla…');
  });
  it('announces full exact readings without preview truncation or empty headings', () => {
    const reading = {
      key: 'trace:scan',
      sources: [],
      tooltip: {
        context: 'Storage',
        title: 'Scan',
        previewRows: [{ label: 'Duration', value: '1 ns' }],
        rows: [{ label: 'Start (ns)', value: '1790643600000000001' }]
      }
    };
    expect(inspectionText(reading)).toBe('Storage; Scan; Start (ns): 1790643600000000001');
    expect(inspectionText({ ...reading, tooltip: { rows: reading.tooltip.rows } })).toBe(
      'Start (ns): 1790643600000000001'
    );
  });
});
