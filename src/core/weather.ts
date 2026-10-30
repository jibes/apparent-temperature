// Weather from Open-Meteo (no API key, CORS-friendly). To get a multi-source
// consensus we request several global models in one call and take the
// per-variable MEDIAN — robust to a single model outlier. The model spread is
// returned as a free uncertainty estimate.
const BASE = 'https://api.open-meteo.com/v1/forecast';

// Ensemble members. Display metadata (name, native grid resolution) is shown in
// the app's methodology section; resolutions are approximate because "seamless"
// blends a fine regional model near its home region with a coarser global one.
// resKm is the finest (lower-bound) grid spacing, used to find whichever
// active member currently gives the sharpest local detail. MeteoSwiss's
// ICON-CH1/CH2 are regional (Central Europe only, short lead time: CH1 33h,
// CH2 5d) — they contribute only near the Alps and only early in the
// forecast, then drop out like any other model whose horizon ends.
// The operating organisation's name is translated, so it lives in i18n
// (`models.<key>`), not here.
export const MODEL_INFO = {
  icon_seamless: { name: 'DWD ICON', res: '2–11 km', resKm: 2 },
  gfs_seamless: { name: 'NOAA GFS', res: '3–25 km', resKm: 3 },
  ecmwf_ifs025: { name: 'ECMWF IFS', res: '25 km', resKm: 25 },
  gem_seamless: { name: 'GEM', res: '2.5–15 km', resKm: 2.5 },
  meteofrance_seamless: { name: 'Météo-France', res: '1.5–25 km', resKm: 1.5 },
  meteoswiss_icon_ch1: { name: 'MeteoSwiss ICON-CH1', res: '1 km', resKm: 1 },
  meteoswiss_icon_ch2: { name: 'MeteoSwiss ICON-CH2', res: '2 km', resKm: 2 },
} as const;
export type ModelKey = keyof typeof MODEL_INFO;
const MODELS = Object.keys(MODEL_INFO) as ModelKey[];

// Instant variables are values AT the timestamp. Open-Meteo's hourly
// shortwave_radiation is a MEAN of the *preceding* hour (timestamp = end of
// interval), which is misaligned with the instant temp/RH/wind/cloud. We use
// shortwave_radiation_instant so every input to a felt-temp represents the same
// instant T (the plain mean is requested only as a whole-ensemble fallback).
const INSTANT_VARS = ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'cloud_cover'];
const HOURLY_VARS = [...INSTANT_VARS, 'shortwave_radiation_instant', 'shortwave_radiation'];

/** One ensemble member's values for one hour. */
export interface Sample {
  m: ModelKey | 'merged';
  t: number;
  rh: number;
  w: number;
  s: number | null;
  c: number | null;
}

/** One hour of the consolidated forecast. */
export interface Hour {
  /** Location wall clock, parsed in the device zone: for display only. */
  time: Date;
  /** True UTC instant, for comparisons. */
  ts: number;
  samples: Sample[];
  temp: number;
  humidity: number;
  wind: number;
  solar: number;
  clouds: number | null;
}

export interface GridCell {
  lat: number;
  lon: number;
  elevation: number | null;
  timezone: string | null;
}

export interface CurrentWeather {
  temp: number;
  humidity: number;
  wind: number;
  clouds: number | null;
  sources: number;
  spread: { temp: number; humidity: number; wind: number };
  grid: GridCell;
}

export interface Place {
  lat: number;
  lon: number;
  name: string | null;
}

type Num = number | null | undefined;
type Json = Record<string, unknown>;
type Series = Record<string, Num[] | undefined>;

const valid = (v: Num): v is number => v != null && !Number.isNaN(v);

function median(xs: Num[]): number | null {
  const a = xs.filter(valid).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function spread(xs: number[]): number {
  if (xs.length < 2) return 0;
  return Math.max(...xs) - Math.min(...xs);
}

// True UTC epoch [ms] for an Open-Meteo time string. With timezone=auto the
// string carries no zone (location wall clock) → interpret as UTC and subtract
// the location offset. If a zone is present (Z or ±HH:MM), trust it as-is.
export function toEpoch(t: string, offsetMs: number): number {
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(t)) return Date.parse(t);
  return Date.parse(t + 'Z') - offsetMs;
}

async function getJson(url: string, init?: RequestInit, label = 'Open-Meteo'): Promise<Json> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${label} ${res.status}`);
  return (await res.json()) as Json;
}

// Fetches current weather, consolidated across models. `grid` is the model
// grid cell the values actually describe (its center + elevation) — the
// honest answer to "how location-specific is this?".
export async function fetchCurrentWeather(lat: number, lon: number): Promise<CurrentWeather> {
  const url =
    `${BASE}?latitude=${lat}&longitude=${lon}` +
    `&current=${INSTANT_VARS.join(',')}` +
    `&models=${MODELS.join(',')}` +
    `&wind_speed_unit=kmh&timezone=auto`;

  const json = await getJson(url);
  const c = (json.current ?? {}) as Record<string, Num>;

  // Hourly responses suffix keys per model, but the `current` block is NOT
  // guaranteed to — removing this fallback broke live fetches ("Standort nicht
  // verfügbar"). Keep it: prefer suffixed keys, else accept the plain key.
  const pick = (v: string): number[] => {
    const vals = MODELS.map((m) => c[`${v}_${m}`]).filter(valid);
    const plain = c[v];
    return vals.length ? vals : valid(plain) ? [plain] : [];
  };
  const temps = pick('temperature_2m');
  const rhs = pick('relative_humidity_2m');
  const winds = pick('wind_speed_10m');
  const clds = pick('cloud_cover');

  if (!temps.length) throw new Error('Open-Meteo: no model data');

  const cloudMed = median(clds);
  return {
    temp: Math.round((median(temps) ?? 0) * 2) / 2,
    humidity: Math.round(median(rhs) ?? 0),
    wind: Math.round(median(winds) ?? 0),
    clouds: cloudMed == null ? null : Math.round(cloudMed),
    sources: temps.length,
    spread: {
      temp: spread(temps),
      humidity: spread(rhs),
      wind: spread(winds),
    },
    grid: {
      lat: json.latitude as number,
      lon: json.longitude as number,
      elevation: (json.elevation as number | undefined) ?? null,
      timezone: (json.timezone as string | undefined) ?? null,
    },
  };
}

// Fetches up to `futureHours` of hourly forecast (plus `pastHours` of history),
// keeping the per-model samples so callers can build a confidence band and
// attribute members.
export async function fetchHourlyForecast(
  lat: number,
  lon: number,
  futureHours = 384,
  pastHours = 6,
): Promise<Hour[]> {
  const url =
    `${BASE}?latitude=${lat}&longitude=${lon}` +
    `&hourly=${HOURLY_VARS.join(',')}` +
    `&models=${MODELS.join(',')}` +
    `&wind_speed_unit=kmh&timezone=auto&forecast_days=16&past_days=1`;

  const json = await getJson(url);
  const h = (json.hourly ?? {}) as Series & { time?: string[] };
  // With timezone=auto the time strings are the location's local wall clock
  // (no offset). `new Date(str)` parses them in the *device* zone — fine for
  // display (the hour numbers are preserved) but wrong for absolute comparison.
  // So we also compute the true UTC instant `ts` using the location offset.
  const offsetMs = ((json.utc_offset_seconds as number | undefined) ?? 0) * 1000;
  const at = (key: string, i: number): Num => h[key]?.[i];

  // One sample per model (suffixed keys), keeping only rows with valid base data.
  const sampleAt = (i: number): Sample[] => {
    // Radiation: don't mix conventions within one hour's ensemble. Use the
    // preceding-hour mean only if NO model provides the instant value at this
    // hour — a mixed median would skew wherever the two differ (sunrise/sunset).
    const anyInstant = MODELS.some((m) => at(`shortwave_radiation_instant_${m}`, i) != null);
    const out: Sample[] = [];
    for (const m of MODELS) {
      const t = at(`temperature_2m_${m}`, i);
      const rh = at(`relative_humidity_2m_${m}`, i);
      const w = at(`wind_speed_10m_${m}`, i);
      const c = at(`cloud_cover_${m}`, i);
      const s = anyInstant
        ? at(`shortwave_radiation_instant_${m}`, i)
        : at(`shortwave_radiation_${m}`, i);
      if (valid(t) && valid(rh) && valid(w)) out.push({ m, t, rh, w, s: s ?? null, c: c ?? null });
    }
    // Un-suffixed shape (API served a single/merged model despite models=…):
    // same load-bearing fallback as in fetchCurrentWeather.
    const t = at('temperature_2m', i);
    if (!out.length && valid(t)) {
      out.push({
        m: 'merged',
        t,
        rh: at('relative_humidity_2m', i) ?? NaN,
        w: at('wind_speed_10m', i) ?? NaN,
        s: at('shortwave_radiation_instant', i) ?? at('shortwave_radiation', i) ?? null,
        c: at('cloud_cover', i) ?? null,
      });
    }
    return out;
  };

  const all: Hour[] = [];
  (h.time ?? []).forEach((t, i) => {
    const samples = sampleAt(i);
    if (!samples.length) return;
    all.push({
      time: new Date(t), // wall clock, for display
      ts: toEpoch(t, offsetMs), // true UTC instant, for compares
      samples,
      temp: median(samples.map((s) => s.t)) ?? NaN,
      humidity: median(samples.map((s) => s.rh)) ?? NaN,
      wind: median(samples.map((s) => s.w)) ?? NaN,
      solar: median(samples.map((s) => s.s)) ?? 0,
      clouds: median(samples.map((s) => s.c)),
    });
  });

  // Keep `pastHours` before the current hour, then `futureHours` ahead.
  // If every row is already in the past (stale response), anchor on the
  // newest row rather than index 0 — same fallback as the app's own
  // nowHourIndex, so both agree on which hour stands in for "now".
  const now = Date.now();
  if (!all.length) return all;
  const idx = all.findIndex((e) => e.ts + 3600000 > now);
  const nowIdx = idx === -1 ? all.length - 1 : idx;
  const start = Math.max(0, nowIdx - pastHours);
  return all.slice(start, nowIdx + futureHours);
}

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
}

// Forward geocoding via Nominatim (OpenStreetMap, no key required). `lang`
// asks for place names in the UI language. Returns null if nothing matches.
export async function searchLocation(query: string, lang = 'en'): Promise<Place | null> {
  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`;
  const res = await fetch(url, { headers: { 'Accept-Language': lang } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const list = (await res.json()) as {
    lat: string;
    lon: string;
    display_name?: string;
    address?: NominatimAddress;
  }[];
  if (!list.length) return null;
  const hit = list[0];
  const a = hit.address ?? {};
  const name =
    a.city ??
    a.town ??
    a.village ??
    a.county ??
    a.state ??
    hit.display_name?.split(',')[0] ??
    query;
  return { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon), name };
}

// Reverse geocoding via Nominatim. Returns a short place name for a
// coordinate (e.g. the grid cell a model's data actually describes), or null
// if nothing resolves (open ocean, no address data, etc.).
export async function reverseGeocode(
  lat: number,
  lon: number,
  lang = 'en',
): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
  const g = (await getJson(url, { headers: { 'Accept-Language': lang } }, 'Nominatim')) as {
    address?: NominatimAddress;
  };
  const a = g.address ?? {};
  return a.city ?? a.town ?? a.village ?? a.county ?? null;
}
