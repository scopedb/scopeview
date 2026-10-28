import { describe, expect, it } from 'vitest';
import { placeChartTooltip } from '../../../src/ui/inspection-position.js';
import { timeTooltipHeader } from '../../../src/families/metrics/tooltip.js';

describe('chart tooltip presentation', () => {
  it('deduplicates aligned bucket dates and zones while retaining the field', () => {
    expect(
      timeTooltipHeader(
        'recorded_at',
        Date.parse('2026-09-15T14:00Z'),
        Date.parse('2026-09-15T15:00Z'),
        'Asia/Shanghai'
      )
    ).toEqual({
      title: '22:00 – 23:00',
      context: 'recorded_at · Sep 15, 2026 · GMT+8'
    });
  });
  it('keeps dates across midnight and years, seconds and exact subsecond endpoints', () => {
    const midnight = timeTooltipHeader(
      'time',
      Date.parse('2026-12-31T23:59:59.123Z'),
      Date.parse('2027-01-01T00:00:00Z'),
      'UTC'
    );
    expect(midnight.title).toBe('23:59:59.123 – 00:00:00.000');
    expect(midnight.context).toContain('Dec 31, 2026');
    expect(midnight.context).toContain('Jan 1, 2027');
    expect(
      timeTooltipHeader('time', Date.parse('2026-09-15T00:00:09Z'), undefined, 'Asia/Kathmandu')
    ).toEqual({
      title: '05:45:09',
      context: 'time · Sep 15, 2026 · GMT+5:45'
    });
  });
  it('distinguishes repeated clocks at a daylight-saving transition', () => {
    expect(
      timeTooltipHeader(
        'time',
        Date.parse('2026-11-01T05:30Z'),
        Date.parse('2026-11-01T06:30Z'),
        'America/New_York'
      )
    ).toEqual({
      title: '01:30 EDT – 01:30 EST',
      context: 'time · Nov 1, 2026'
    });
  });
  it('flips at the right edge and allows a tooltip taller than its chart within the viewport', () => {
    const size = { width: 288, height: 300 },
      viewport = { width: 768, height: 900 };
    expect(placeChartTooltip({ x: 100, y: 150 }, size, viewport)).toEqual({ left: 112, top: 130 });
    expect(placeChartTooltip({ x: 750, y: 890 }, size, viewport)).toEqual({ left: 450, top: 592 });
    expect(
      placeChartTooltip({ x: 0, y: 0 }, { width: 300, height: 384 }, { width: 320, height: 400 })
    ).toEqual({ left: 12, top: 8 });
  });
  it('keeps the inspected point exposed when a narrow viewport cannot fit either side', () => {
    const size = { width: 304, height: 160 },
      viewport = { width: 320, height: 600 };
    expect(placeChartTooltip({ x: 160, y: 160 }, size, viewport)).toEqual({ left: 8, top: 172 });
    expect(placeChartTooltip({ x: 160, y: 500 }, size, viewport)).toEqual({ left: 8, top: 328 });
  });
  it('places a fixed reading outside its supplied exclusion rectangle', () => {
    const size = { width: 260, height: 120 },
      viewport = { width: 768, height: 900 },
      anchor = { x: 350, y: 210 };
    expect(
      placeChartTooltip(anchor, size, viewport, { x: 100, y: 200, width: 50, height: 24 })
    ).toEqual({ left: 162, top: 200 });
    expect(
      placeChartTooltip(anchor, size, viewport, { x: 100, y: 200, width: 500, height: 24 })
    ).toEqual({ left: 220, top: 236 });
    expect(
      placeChartTooltip(anchor, size, viewport, { x: 100, y: 800, width: 500, height: 24 })
    ).toEqual({ left: 220, top: 668 });
  });
});
