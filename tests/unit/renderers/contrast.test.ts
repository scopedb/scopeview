import { describe, expect, it } from 'vitest';
import { contrastingInk, inspectionFill } from '../../../src/renderers/canvas/contrast.js';

describe('Canvas label contrast', () => {
  it('chooses readable ink across the categorical palette and host theme overrides', () => {
    expect(contrastingInk('rgb(50, 128, 221)', 'rgb(255, 255, 255)', 'red')).toBe('#000000');
    expect(contrastingInk('rgb(150, 61, 80)', 'rgb(255, 255, 255)', 'red')).toBe('#ffffff');
    expect(contrastingInk('rgb(10, 20, 30)', 'rgb(255, 255, 255)', 'red')).toBe('#ffffff');
  });
  it('accounts for transparency on both light and dark host surfaces', () => {
    expect(contrastingInk('rgba(0, 0, 0, 0.1)', 'rgb(255, 255, 255)', 'red')).toBe('#000000');
    expect(contrastingInk('rgba(255, 255, 255, 0.1)', 'rgb(0, 0, 0)', 'red')).toBe('#ffffff');
  });
  it('retains the supplied ink for paints outside resolved sRGB', () => {
    expect(contrastingInk('color(display-p3 1 0 0)', 'rgb(255, 255, 255)', 'purple')).toBe(
      'purple'
    );
  });
  it('supports CSS Color 4 color(srgb ...), none, % RGB, wide-gamut clamping, and rejects invalid syntax', () => {
    const inks = ['rgb(23, 33, 46)', 'rgb(246, 248, 251)'];
    expect(
      contrastingInk(
        'color(srgb 0.2549019607843137 0.5450980392156862 0.9019607843137255)',
        'color(srgb 1 1 1)',
        'red',
        inks
      )
    ).toBe(inks[0]);
    expect(
      contrastingInk(
        'color(srgb 0.0392156862745098 0.0784313725490196 0.11764705882352941)',
        'color(srgb 1 1 1)',
        'red',
        inks
      )
    ).toBe(inks[1]);
    expect(contrastingInk('rgb(0 0 0 / 10%)', 'color(srgb 1 1 1)', 'red', inks)).toBe(inks[0]);
    expect(contrastingInk('color(srgb 1 1 1 / 10%)', 'color(srgb 0 0 0)', 'red', inks)).toBe(
      inks[1]
    );
    expect(contrastingInk('color(srgb 1 none 1)', 'rgb(255, 255, 255)', 'red', inks)).toBe(inks[0]);
    expect(contrastingInk('color(srgb 0 none 0 / none)', 'rgb(255, 255, 255)', 'red', inks)).toBe(
      inks[0]
    );
    expect(contrastingInk('color(srgb 50% 75% 95% / 80%)', 'rgb(255, 255, 255)', 'red', inks)).toBe(
      inks[0]
    );
    expect(contrastingInk('rgb(100% 100% 100%)', 'rgb(0, 0, 0)', 'red', inks)).toBe(inks[0]);
    // Out-of-gamut sRGB channels clamp to [0, 255] instead of corrupting luminance.
    expect(contrastingInk('color(srgb 1.5 -0.1 0.5)', 'rgb(255, 255, 255)', 'purple')).toBe(
      '#000000'
    );
    expect(contrastingInk('rgb(300, -10, 0)', 'rgb(255, 255, 255)', 'purple')).toBe('#000000');
    // Reject missing channel, 4-arg space syntax without `/`, comma+slash mix, and multi-slash.
    expect(contrastingInk('color(srgb 1 1)', 'rgb(255, 255, 255)', 'purple')).toBe('purple');
    expect(contrastingInk('color(srgb 1 0 0 0.5)', 'rgb(255, 255, 255)', 'purple')).toBe('purple');
    expect(contrastingInk('rgb(1 0 0 0.5)', 'rgb(255, 255, 255)', 'purple')).toBe('purple');
    expect(contrastingInk('color(srgb 1 0 0 / 0.5 / 0.5)', 'rgb(255, 255, 255)', 'purple')).toBe(
      'purple'
    );
    expect(contrastingInk('rgb(0, 0, 0 / 50%)', 'rgb(255, 255, 255)', 'purple')).toBe('purple');
  });
  it('uses softer entity inks only when they maintain readable contrast', () => {
    const inks = ['rgb(23, 33, 46)', 'rgb(246, 248, 251)'];
    expect(contrastingInk('rgb(65, 139, 230)', 'rgb(255, 255, 255)', 'red', inks)).toBe(inks[0]);
    expect(contrastingInk('rgb(10, 20, 30)', 'rgb(255, 255, 255)', 'red', inks)).toBe(inks[1]);
    // Neither preferred ink reaches 4.5:1 on this middle gray.
    expect(contrastingInk('rgb(118, 118, 118)', 'rgb(255, 255, 255)', 'red', inks)).toBe('#000000');
    // An almost transparent override must not pass a contrast check as opaque ink.
    expect(
      contrastingInk('rgb(255, 255, 255)', 'rgb(255, 255, 255)', 'red', ['rgba(23, 33, 46, 0.1)'])
    ).toBe('#000000');
    expect(contrastingInk('rgba(0, 0, 0, 0.1)', 'rgb(255, 255, 255)', 'red', inks)).toBe(inks[0]);
  });
});

describe('source-colored metric emphasis', () => {
  it('uses the same blue hue at a darker light-host step and brighter dark-host step', () => {
    expect(inspectionFill('rgb(65, 139, 230)', 'rgb(255, 255, 255)')).toBe('rgba(40, 116, 205, 1)');
    expect(inspectionFill('rgb(65, 139, 230)', 'rgb(25, 33, 43)')).toBe('rgba(93, 165, 255, 1)');
  });
  it('retains custom paint opacity and keeps neutral extremes visibly inspectable', () => {
    expect(inspectionFill('rgba(200, 101, 143, 0.6)', 'rgb(255, 255, 255)')).toBe(
      'rgba(175, 78, 121, 0.6)'
    );
    expect(inspectionFill('rgb(0, 0, 0)', 'rgb(255, 255, 255)')).toBe('rgba(58, 58, 58, 1)');
    expect(inspectionFill('rgb(255, 255, 255)', 'rgb(25, 33, 43)')).toBe('rgba(228, 228, 228, 1)');
  });
  it('preserves unsupported custom color spaces instead of substituting a neutral paint', () => {
    const paint = 'color(display-p3 1 0 0)';
    expect(inspectionFill(paint, 'rgb(255, 255, 255)')).toBe(paint);
  });
  it('computes the exact same Oklab lightness step for color(srgb ...), % RGB/alpha, clamped sRGB, and rejects malformed space syntax', () => {
    expect(
      inspectionFill(
        'color(srgb 0.2549019607843137 0.5450980392156862 0.9019607843137255)',
        'color(srgb 1 1 1)'
      )
    ).toBe('rgba(40, 116, 205, 1)');
    expect(
      inspectionFill(
        'color(srgb 0.7843137254901961 0.396078431372549 0.5607843137254902 / 60%)',
        'color(srgb 1 1 1)'
      )
    ).toBe('rgba(175, 78, 121, 0.6)');
    expect(inspectionFill('rgba(200, 101, 143, 60%)', 'rgb(255, 255, 255)')).toBe(
      'rgba(175, 78, 121, 0.6)'
    );
    expect(inspectionFill('color(srgb 1.5 -0.1 1)', 'rgb(255, 255, 255)')).toBe(
      inspectionFill('rgb(255, 0, 255)', 'rgb(255, 255, 255)')
    );
    expect(inspectionFill('color(srgb 1 0 0 0.5)', 'rgb(255, 255, 255)')).toBe(
      'color(srgb 1 0 0 0.5)'
    );
    expect(inspectionFill('rgb(1 0 0 0.5)', 'rgb(255, 255, 255)')).toBe('rgb(1 0 0 0.5)');
  });
});
