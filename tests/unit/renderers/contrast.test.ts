import { describe, expect, it } from 'vitest';
import { contrastingInk, inspectionFill } from '../../../src/renderers/canvas/contrast.js';

describe('Canvas label contrast', () => {
  it('chooses readable ink across the Console palette and host theme overrides', () => {
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
});
