// "Now" and time helpers over the hourly forecast — pure, no DOM.
import type { Hour } from './weather';

/** {median, lo, hi} of an ensemble at one instant (the confidence band). */
export interface StatPoint {
  med: number;
  lo: number;
  hi: number;
}

/** Interpolated current outdoor reading. */
export interface NowReading {
  temp: number;
  humidity: number;
  wind: number;
  clouds: number | null;
}

// Index of the hour bucket containing "now" — the single definition of
// "current" shared by the headline value, the graph, and the outdoor
// reading, so they never disagree about which sample is "now".
export function nowHourIndex(hours: readonly Hour[], now = Date.now()): number {
  const i = hours.findIndex((h) => h.ts + 3600000 > now);
  // All hours in the past (data went stale, e.g. after a long offline spell):
  // the *newest* hour is the least-wrong stand-in for "now" — not index 0,
  // which would be the very oldest reading in the window.
  return i === -1 ? hours.length - 1 : i;
}

// How far "now" sits between hours[nowIdx] and the next hour, as a 0–1
// fraction — the hourly data is only exact on the hour, so anything in
// between is a linear estimate rather than a real 5-min reading.
export function nowFraction(hours: readonly Hour[], nowIdx: number, now = Date.now()): number {
  const a = hours[nowIdx];
  const b = hours[nowIdx + 1];
  if (!a || !b) return 0;
  return Math.min(1, Math.max(0, (now - a.ts) / (b.ts - a.ts)));
}

// Linear interpolation between two stat points (or null, at the edges of the
// data where there's nothing to blend with).
export function interpPoint(
  a: StatPoint | null | undefined,
  b: StatPoint | null | undefined,
  t: number,
): StatPoint | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return {
    med: a.med + (b.med - a.med) * t,
    lo: a.lo + (b.lo - a.lo) * t,
    hi: a.hi + (b.hi - a.hi) * t,
  };
}

// Interpolated current outdoor reading from the hourly forecast, using the
// same nowFraction the headline and graph use. This is THE single source for
// every outdoor value on screen — the Gefühlt-tab air-temp baseline and the
// Lüften-tab outdoor values both read it — so they can never disagree about
// "now". Returns null when there's no forecast yet.
export function nowReading(
  hours: readonly Hour[] | null | undefined,
  now = Date.now(),
): NowReading | null {
  if (!hours || !hours.length) return null;
  const i = nowHourIndex(hours, now);
  const a = hours[i];
  const b = hours[i + 1];
  const frac = nowFraction(hours, i, now);
  const lerp = (sel: (h: Hour) => number) => (b ? sel(a) + (sel(b) - sel(a)) * frac : sel(a));
  const bothClouds = a.clouds != null && (!b || b.clouds != null);
  return {
    temp: lerp((h) => h.temp),
    humidity: lerp((h) => h.humidity),
    wind: lerp((h) => h.wind),
    clouds: bothClouds ? lerp((h) => h.clouds as number) : (a.clouds ?? null),
  };
}

/** Age of the data, bucketed for the freshness label. */
export type Age =
  | { unit: 'now' }
  | { unit: 'min'; n: number }
  | { unit: 'hours'; n: number }
  | { unit: 'days'; n: number };

// The days tier matters since the offline cache made multi-day-old data a
// realistic display ("78 h ago" reads worse than "3 days ago").
export function ageOf(ms: number, now = Date.now()): Age {
  const min = Math.floor(Math.max(0, now - ms) / 60000);
  if (min < 1) return { unit: 'now' };
  if (min < 60) return { unit: 'min', n: min };
  const hrs = Math.floor(min / 60);
  if (hrs < 48) return { unit: 'hours', n: hrs };
  return { unit: 'days', n: Math.floor(hrs / 24) };
}

/** One decimal, always shown ("21.0"). */
export function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** Two-digit hour of a (wall-clock) Date. */
export function hh(d: Date): string {
  return String(d.getHours()).padStart(2, '0');
}

// Great-circle distance [km].
export function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}
