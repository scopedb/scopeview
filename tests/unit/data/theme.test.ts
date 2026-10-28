import { describe, expect, it } from 'vitest';
import { defineTheme } from '../../../src/theme/config.js';
import { resolveTheme } from '../../../src/theme.js';

describe('host themes', () => {
  it('resolves defaults and categorical slots without overriding semantic or authored colors', () => {
    expect(resolveTheme({})).toEqual({ mode: 'light', properties: {} });
    expect(resolveTheme('system')).toEqual({ mode: 'system', properties: {} });
    const resolved = resolveTheme({
      mode: 'dark',
      fontSize: 26,
      fontFamily: '"My Font", system-ui',
      palette: ['#123', '#abcdef'],
      colors: { surface: '#fff', text: '#123456', mutedText: '#678' }
    });
    expect(resolved.mode).toBe('dark');
    expect(resolved.properties['--scope-chart-font-scale']).toBe('2');
    expect(resolved.properties['--font-sans']).toBe('"My Font", system-ui');
    expect(resolved.properties['--color-chart-series-1']).toBe('#123');
    expect(resolved.properties['--color-chart-series-10-line']).toBe('#abcdef');
    expect(resolved.properties['--color-surface']).toBe('#fff');
    expect(Object.keys(resolved.properties).some((key) => key.includes('semantic'))).toBe(false);
  });

  it('owns a snapshot of every nested input', () => {
    const input = { palette: ['#123'], colors: { text: '#456' } };
    const snapshot = defineTheme(input);
    input.palette[0] = '#abc';
    input.colors.text = '#def';
    expect(snapshot).toEqual({ palette: ['#123'], colors: { text: '#456' } });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it.each([
    [null, 'theme'],
    ['blue', 'theme'],
    [[], 'theme'],
    [{ colour: '#fff' }, 'theme.colour'],
    [{ mode: 'auto' }, 'theme.mode'],
    [{ fontSize: 0 }, 'theme.fontSize'],
    [{ fontSize: NaN }, 'theme.fontSize'],
    [{ fontSize: '14px' }, 'theme.fontSize'],
    [{ fontSize: 33 }, 'theme.fontSize'],
    [{ fontFamily: '' }, 'theme.fontFamily'],
    [{ fontFamily: 'Inter; color:red' }, 'theme.fontFamily'],
    [{ fontFamily: 'url(https://example.com/font)' }, 'theme.fontFamily'],
    [{ fontFamily: '"unterminated' }, 'theme.fontFamily'],
    [{ palette: [] }, 'theme.palette'],
    [{ palette: Array(2) }, 'theme.palette[0]'],
    [{ palette: Array(11).fill('#fff') }, 'theme.palette'],
    [{ palette: ['red'] }, 'theme.palette[0]'],
    [{ palette: ['#fff0'] }, 'theme.palette[0]'],
    [{ colors: { background: '#fff' } }, 'theme.colors.background'],
    [{ colors: { text: 'var(--ink)' } }, 'theme.colors.text']
  ])('rejects invalid configuration at its exact path: %j', (input, path) => {
    expect(() => defineTheme(input as never)).toThrowError(expect.objectContaining({ path }));
  });
});
