import { describe, expect, it } from 'vitest';
import {
  ALL_ON,
  buildBandPath,
  buildLinePath,
  buildSeries,
  ensembleInfo,
  lineWidth,
  niceStep,
  nightBands,
  pointsScale,
  stats,
} from '../src/core/series';
import type { Hour, Sample } from '../src/core/weather';

const H = 3600000;
const T0 = Date.UTC(2026, 5, 21, 0);
const ctx = { lat: 52.5, lon: 13.4, elevation: 0 };
const sample = (m: Sample['m'], t: number): Sample => ({ m, t, rh: 50, w: 10, s: 300, c: 50 });
const hours: Hour[] = Array.from({ length: 48 }, (_, i) => ({
  time: new Date(T0 + i * H),
  ts: T0 + i * H,
  samples: [sample('icon_seamless', 15), sample('gfs_seamless', 17), sample('ecmwf_ifs025', 16)],
  temp: 16,
  humidity: 50,
  wind: 10,
  solar: 300,
  clouds: 50,
}));

describe('stats', () => {
  it('median, min and max, ignoring gaps', () => {
    expect(stats([3, null, 1, 2, NaN])).toEqual({ med: 2, lo: 1, hi: 3 });
    expect(stats([1, 2, 3, 4])?.med).toBe(2.5);
    expect(stats([])).toBeNull();
  });
});

describe('scales', () => {
  it('nice steps are 1/2/5 × 10ⁿ', () => {
    expect(niceStep(10)).toBe(2);
    expect(niceStep(37)).toBe(10);
    expect(niceStep(20)).toBe(5);
    expect(niceStep(0)).toBe(1);
  });
  it('% is fixed 0–100, non-negative units start at 0', () => {
    expect(pointsScale([], '%')).toEqual({ yMin: 0, yMax: 100, step: 20 });
    expect(pointsScale([{ med: 20, lo: 18, hi: 22 }], 'km/h').yMin).toBe(0);
    expect(pointsScale([{ med: 20, lo: 18, hi: 22 }], '°C').yMin).toBeGreaterThan(0);
  });
});

describe('buildSeries', () => {
  it('shows derived lines only when their inputs are active', () => {
    const keys = (a: typeof ALL_ON) => buildSeries(hours, ctx, a).map((s) => s.key);
    expect(keys(ALL_ON)).toEqual(['temp', 'ah', 'wind', 'csun', 'clouds', 'rh', 'effsun', 'felt']);
    const tempOnly = { temp: true, ah: false, wind: false, csun: false, clouds: false };
    expect(keys(tempOnly)).toEqual(['temp']);
    expect(keys({ ...tempOnly, wind: true })).toContain('felt');
  });
  it('same-unit series share one scale regardless of toggles', () => {
    const all = buildSeries(hours, ctx, ALL_ON);
    const temp = all.find((s) => s.key === 'temp');
    const felt = all.find((s) => s.key === 'felt');
    expect(temp?.yMin).toBe(felt?.yMin);
    const solo = buildSeries(hours, ctx, { ...ALL_ON, ah: false, wind: false, csun: false });
    expect(solo.find((s) => s.key === 'temp')?.yMin).toBe(temp?.yMin);
  });
  it('line width grows with inputs but is capped', () => {
    expect(lineWidth(1)).toBeLessThan(lineWidth(3));
    expect(lineWidth(10)).toBe(3);
  });
});

describe('paths', () => {
  const x = (i: number) => i * 10;
  const y = (v: number) => v;
  const pts = [{ med: 1, lo: 0, hi: 2 }, null, { med: 3, lo: 2, hi: 4 }, { med: 5, lo: 4, hi: 6 }];
  it('splits lines at gaps', () => {
    expect(buildLinePath(pts, x, y).match(/M/g)).toHaveLength(2);
  });
  it('closes the band', () => {
    expect(buildBandPath(pts, x, y).endsWith('Z')).toBe(true);
    expect(buildBandPath([null], x, y)).toBe('');
  });
});

describe('nightBands', () => {
  it('marks midsummer night in Berlin', () => {
    const bands = nightBands(hours.slice(0, 24), 52.5, 13.4);
    expect(bands.length).toBeGreaterThan(0);
    // 00 UTC = 02 local: night; 12 UTC: day
    expect(bands[0][0]).toBe(0);
    expect(bands.some(([s, e]) => s <= 12 && 12 < e)).toBe(false);
  });
});

describe('ensembleInfo', () => {
  it('counts members and picks the finest grid', () => {
    const info = ensembleInfo(hours, T0);
    expect(info?.now.base).toBe(3);
    expect(info?.members.map((m) => m.key)).toEqual([
      'icon_seamless',
      'gfs_seamless',
      'ecmwf_ifs025',
    ]);
    expect(info?.finest?.key).toBe('icon_seamless');
  });
});
