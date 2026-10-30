import { describe, expect, it } from 'vitest';
import {
  ageOf,
  distKm,
  interpPoint,
  nowFraction,
  nowHourIndex,
  nowReading,
} from '../src/core/time';
import type { Hour } from '../src/core/weather';

const H = 3600000;
const T0 = Date.UTC(2026, 5, 1, 12);
const hour = (i: number, temp: number, clouds: number | null = 50): Hour => ({
  time: new Date(T0 + i * H),
  ts: T0 + i * H,
  samples: [],
  temp,
  humidity: 50 + i,
  wind: 10,
  solar: 0,
  clouds,
});
const hours = [hour(0, 10), hour(1, 20), hour(2, 30)];

describe('now helpers', () => {
  it('finds the bucket containing now', () => {
    expect(nowHourIndex(hours, T0 + 1.5 * H)).toBe(1);
  });
  it('falls back to the newest hour when all data is in the past', () => {
    expect(nowHourIndex(hours, T0 + 10 * H)).toBe(2);
  });
  it('interpolates within the hour', () => {
    expect(nowFraction(hours, 0, T0 + 0.25 * H)).toBeCloseTo(0.25);
    expect(nowReading(hours, T0 + 0.5 * H)?.temp).toBeCloseTo(15);
  });
  it('keeps clouds null when a neighbour has none', () => {
    const hs = [hour(0, 10, 40), hour(1, 20, null)];
    expect(nowReading(hs, T0 + 0.5 * H)?.clouds).toBe(40);
  });
  it('returns null without data', () => {
    expect(nowReading(null)).toBeNull();
    expect(nowReading([])).toBeNull();
  });
  it('interpolates stat points and tolerates missing edges', () => {
    const a = { med: 0, lo: -1, hi: 1 };
    const b = { med: 10, lo: 9, hi: 11 };
    expect(interpPoint(a, b, 0.5)).toEqual({ med: 5, lo: 4, hi: 6 });
    expect(interpPoint(null, b, 0.5)).toBe(b);
    expect(interpPoint(a, undefined, 0.5)).toBe(a);
  });
});

describe('ageOf', () => {
  const now = T0;
  it('buckets minutes, hours and days', () => {
    expect(ageOf(now - 30000, now)).toEqual({ unit: 'now' });
    expect(ageOf(now - 5 * 60000, now)).toEqual({ unit: 'min', n: 5 });
    expect(ageOf(now - 3 * H, now)).toEqual({ unit: 'hours', n: 3 });
    expect(ageOf(now - 78 * H, now)).toEqual({ unit: 'days', n: 3 });
  });
});

describe('distKm', () => {
  it('Berlin–Munich ≈ 504 km', () => {
    expect(distKm(52.52, 13.405, 48.137, 11.575)).toBeCloseTo(504, -1);
  });
});
