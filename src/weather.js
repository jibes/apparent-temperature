// Weather from Open-Meteo (no API key, CORS-friendly). To get a multi-source
// consensus we request several global models in one call and take the
// per-variable MEDIAN — robust to a single model outlier. The model spread is
// returned as a free uncertainty estimate.
const BASE = 'https://api.open-meteo.com/v1/forecast'

// Ensemble members. Display metadata (name, native grid resolution) is shown in
// the app's methodology section; resolutions are approximate because "seamless"
// blends a fine regional model near its home region with a coarser global one.
// resKm is the finest (lower-bound) grid spacing, used to find whichever
// active member currently gives the sharpest local detail. MeteoSwiss's
// ICON-CH1/CH2 are regional (Central Europe only, short lead time: CH1 33h,
// CH2 5d) — they contribute only near the Alps and only early in the
// forecast, then drop out like any other model whose horizon ends.
export const MODEL_INFO = {
  icon_seamless:        { name: 'DWD ICON',           org: 'Deutscher Wetterdienst', res: '2–11 km',   resKm: 2 },
  gfs_seamless:         { name: 'NOAA GFS',           org: 'USA',                    res: '3–25 km',   resKm: 3 },
  ecmwf_ifs025:         { name: 'ECMWF IFS',          org: 'Europa',                 res: '25 km',     resKm: 25 },
  gem_seamless:         { name: 'GEM',                org: 'Kanada',                 res: '2.5–15 km', resKm: 2.5 },
  meteofrance_seamless: { name: 'Météo-France',       org: 'Frankreich',             res: '1.5–25 km', resKm: 1.5 },
  meteoswiss_icon_ch1:  { name: 'MeteoSwiss ICON-CH1', org: 'MeteoSchweiz',          res: '1 km',      resKm: 1 },
  meteoswiss_icon_ch2:  { name: 'MeteoSwiss ICON-CH2', org: 'MeteoSchweiz',          res: '2 km',      resKm: 2 },
}
const MODELS = Object.keys(MODEL_INFO)

// Instant variables are values AT the timestamp. Open-Meteo's hourly
// shortwave_radiation is a MEAN of the *preceding* hour (timestamp = end of
// interval), which is misaligned with the instant temp/RH/wind/cloud. We use
// shortwave_radiation_instant so every input to a felt-temp represents the same
// instant T (the plain mean is requested only as a whole-ensemble fallback).
const INSTANT_VARS = ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'cloud_cover']
const HOURLY_VARS  = [...INSTANT_VARS, 'shortwave_radiation_instant', 'shortwave_radiation']

function median(xs) {
  const a = xs.filter(v => v != null && !Number.isNaN(v)).sort((x, y) => x - y)
  if (!a.length) return null
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

function spread(xs) {
  const a = xs.filter(v => v != null && !Number.isNaN(v))
  if (a.length < 2) return 0
  return Math.max(...a) - Math.min(...a)
}

// True UTC epoch [ms] for an Open-Meteo time string. With timezone=auto the
// string carries no zone (location wall clock) → interpret as UTC and subtract
// the location offset. If a zone is present (Z or ±HH:MM), trust it as-is.
export function toEpoch(t, offsetMs) {
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(t)) return Date.parse(t)
  return Date.parse(t + 'Z') - offsetMs
}

// Fetches current weather, consolidated across models. Returns
// { temp, humidity, wind, clouds, sources, spread, grid } where `grid` is the
// model grid cell the values actually describe (its center + elevation) — the
// honest answer to "how location-specific is this?".
export async function fetchCurrentWeather(lat, lon) {
  const url =
    `${BASE}?latitude=${lat}&longitude=${lon}` +
    `&current=${INSTANT_VARS.join(',')}` +
    `&models=${MODELS.join(',')}` +
    `&wind_speed_unit=kmh&timezone=auto`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const json = await res.json()
  const c = json.current

  // Hourly responses suffix keys per model, but the `current` block is NOT
  // guaranteed to — removing this fallback broke live fetches ("Standort nicht
  // verfügbar"). Keep it: prefer suffixed keys, else accept the plain key.
  const pick = v => {
    const vals = MODELS.map(m => c[`${v}_${m}`]).filter(x => x != null && !Number.isNaN(x))
    return vals.length ? vals : (c[v] != null && !Number.isNaN(c[v]) ? [c[v]] : [])
  }
  const temps = pick('temperature_2m')
  const rhs   = pick('relative_humidity_2m')
  const winds = pick('wind_speed_10m')
  const clds  = pick('cloud_cover')

  if (!temps.length) throw new Error('Open-Meteo: no model data')

  const cloudMed = median(clds)
  return {
    temp:     Math.round(median(temps) * 2) / 2,
    humidity: Math.round(median(rhs)),
    wind:     Math.round(median(winds)),
    clouds:   cloudMed == null ? null : Math.round(cloudMed),
    sources:  temps.length,
    spread: {
      temp:     spread(temps),
      humidity: spread(rhs),
      wind:     spread(winds),
    },
    grid: {
      lat:       json.latitude,
      lon:       json.longitude,
      elevation: json.elevation ?? null,
      timezone:  json.timezone ?? null,
    },
  }
}

// Fetches up to `futureHours` of hourly forecast (plus `pastHours` of history),
// keeping the per-model samples so callers can build a confidence band and
// attribute members. Each entry:
// { time, ts, temp, humidity, wind, solar (medians),
//   samples: [{ m, t, rh, w, s, c }] one per model with valid base data }.
export async function fetchHourlyForecast(lat, lon, futureHours = 384, pastHours = 6) {
  const url =
    `${BASE}?latitude=${lat}&longitude=${lon}` +
    `&hourly=${HOURLY_VARS.join(',')}` +
    `&models=${MODELS.join(',')}` +
    `&wind_speed_unit=kmh&timezone=auto&forecast_days=16&past_days=1`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const json = await res.json()
  const h = json.hourly
  // With timezone=auto the time strings are the location's local wall clock
  // (no offset). `new Date(str)` parses them in the *device* zone — fine for
  // display (the hour numbers are preserved) but wrong for absolute comparison.
  // So we also compute the true UTC instant `ts` using the location offset.
  const offsetMs = (json.utc_offset_seconds ?? 0) * 1000

  // One sample per model (suffixed keys), keeping only rows with valid base data.
  const sampleAt = i => {
    // Radiation: don't mix conventions within one hour's ensemble. Use the
    // preceding-hour mean only if NO model provides the instant value at this
    // hour — a mixed median would skew wherever the two differ (sunrise/sunset).
    const anyInstant = MODELS.some(m => h[`shortwave_radiation_instant_${m}`]?.[i] != null)
    const out = []
    for (const m of MODELS) {
      const t  = h[`temperature_2m_${m}`]?.[i]
      const rh = h[`relative_humidity_2m_${m}`]?.[i]
      const w  = h[`wind_speed_10m_${m}`]?.[i]
      const c  = h[`cloud_cover_${m}`]?.[i]
      const s  = anyInstant
        ? h[`shortwave_radiation_instant_${m}`]?.[i]
        : h[`shortwave_radiation_${m}`]?.[i]
      if (t != null && rh != null && w != null) out.push({ m, t, rh, w, s: s ?? null, c: c ?? null })
    }
    // Un-suffixed shape (API served a single/merged model despite models=…):
    // same load-bearing fallback as in fetchCurrentWeather.
    if (!out.length && h.temperature_2m?.[i] != null) {
      out.push({ m: 'merged',
                 t: h.temperature_2m[i], rh: h.relative_humidity_2m?.[i],
                 w: h.wind_speed_10m?.[i],
                 s: h.shortwave_radiation_instant?.[i] ?? h.shortwave_radiation?.[i] ?? null,
                 c: h.cloud_cover?.[i] ?? null })
    }
    return out
  }

  const all = h.time.map((t, i) => {
    const samples = sampleAt(i)
    if (!samples.length) return null
    return {
      time:     new Date(t),          // wall clock, for display
      ts:       toEpoch(t, offsetMs),  // true UTC instant, for compares
      samples,
      temp:     median(samples.map(s => s.t)),
      humidity: median(samples.map(s => s.rh)),
      wind:     median(samples.map(s => s.w)),
      solar:    median(samples.map(s => s.s).filter(x => x != null)) ?? 0,
      clouds:   median(samples.map(s => s.c).filter(x => x != null)),
    }
  }).filter(Boolean)

  // Keep `pastHours` before the current hour, then `futureHours` ahead.
  // If every row is already in the past (stale response), anchor on the
  // newest row rather than index 0 — same fallback as the app's own
  // nowHourIndex, so both agree on which hour stands in for "now".
  const now = Date.now()
  if (!all.length) return all
  const idx = all.findIndex(e => e.ts + 3600000 > now)
  const nowIdx = idx === -1 ? all.length - 1 : idx
  const start = Math.max(0, nowIdx - pastHours)
  return all.slice(start, nowIdx + futureHours)
}

// Forward geocoding via Nominatim (OpenStreetMap, no key required).
// Returns { lat, lon, name } for the best match, or null if none found.
export async function searchLocation(query) {
  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`
  const res = await fetch(url, { headers: { 'Accept-Language': 'de' } })
  if (!res.ok) throw new Error(`Nominatim ${res.status}`)
  const list = await res.json()
  if (!list.length) return null
  const hit = list[0]
  const a = hit.address ?? {}
  const name =
    a.city ?? a.town ?? a.village ?? a.county ?? a.state ??
    hit.display_name?.split(',')[0] ?? query
  return { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon), name }
}

// Reverse geocoding via Nominatim. Returns a short place name for a
// coordinate (e.g. the grid cell a model's data actually describes), or null
// if nothing resolves (open ocean, no address data, etc.).
export async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`
  const res = await fetch(url, { headers: { 'Accept-Language': 'de' } })
  if (!res.ok) throw new Error(`Nominatim ${res.status}`)
  const g = await res.json()
  const a = g.address ?? {}
  return a.city ?? a.town ?? a.village ?? a.county ?? null
}
