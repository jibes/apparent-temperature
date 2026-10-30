// Persistence. Small prefs live in localStorage, the weather cache in
// IndexedDB. Keys follow `apparent-temperature.<name>.v<N>`; never rename a
// key — bump the version and migrate.
import { get, set } from 'idb-keyval';
import type { GridCell, Hour } from './core/weather';

const APP = 'apparent-temperature';
export const prefKey = (name: string, v = 1): string => `${APP}.${name}.v${v}`;

/** Pre-standard keys (bare names) that are migrated on first read. */
const LEGACY: Record<string, string> = {
  tab: 'tab',
  inTemp: 'inTemp',
  inRH: 'inRH',
  outTemp: 'outTemp',
  outRH: 'outRH',
  geoLocation: 'geoLocation',
  locSource: 'locSource',
  metrics: 'metrics',
};

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Reads a pref, migrating its legacy key once. */
export function readPref<T>(name: string, fallback: T): T {
  const ls = storage();
  if (!ls) return fallback;
  try {
    const raw = ls.getItem(prefKey(name));
    if (raw != null) return JSON.parse(raw) as T;
    const legacy = LEGACY[name];
    const old = legacy != null ? ls.getItem(legacy) : null;
    if (old != null) {
      ls.setItem(prefKey(name), old);
      ls.removeItem(legacy);
      return JSON.parse(old) as T;
    }
  } catch {
    /* corrupt value → fallback */
  }
  return fallback;
}

export function hasPref(name: string): boolean {
  const ls = storage();
  const legacy = LEGACY[name];
  return (
    !!ls && (ls.getItem(prefKey(name)) != null || (legacy != null && ls.getItem(legacy) != null))
  );
}

export function writePref(name: string, value: unknown): void {
  try {
    storage()?.setItem(prefKey(name), JSON.stringify(value));
  } catch {
    /* quota / private mode: prefs are a convenience */
  }
}

/** One-time cleanup of keys from removed features. */
export function dropObsoletePrefs(): void {
  try {
    storage()?.removeItem('outManual');
  } catch {
    /* ignore */
  }
}

export interface WxMeta {
  sources: number;
  spread: { temp: number; humidity: number; wind: number };
  grid: GridCell;
}

export interface WxCache {
  hours: Hour[];
  wxMeta: WxMeta | null;
  updatedAt: number | null;
}

const WX_KEY = prefKey('wxCache');

// Last successful weather, for an offline / flaky cold start. IndexedDB
// keeps Dates intact (structured clone); the pre-standard localStorage blob
// (Dates as ISO strings) is revived and moved over once.
export async function loadWxCache(): Promise<WxCache | null> {
  try {
    const cached = await get<WxCache>(WX_KEY);
    if (cached) return cached;
    const ls = storage();
    const raw = ls?.getItem('wxCache');
    if (!raw) return null;
    ls?.removeItem('wxCache');
    const old = JSON.parse(raw) as WxCache & { hours: (Omit<Hour, 'time'> & { time: string })[] };
    const migrated: WxCache = {
      hours: old.hours.map((h) => ({ ...h, time: new Date(h.time) })),
      wxMeta: old.wxMeta ?? null,
      updatedAt: old.updatedAt ?? null,
    };
    await set(WX_KEY, migrated);
    return migrated;
  } catch {
    return null;
  }
}

export async function saveWxCache(c: WxCache): Promise<void> {
  try {
    await set(WX_KEY, c);
  } catch {
    /* storage unavailable: the cache is an optimisation */
  }
}
