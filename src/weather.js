// Weather from Open-Meteo (no API key, CORS-friendly). To get a multi-source
// consensus we request several global models in one call and take the
// per-variable MEDIAN — robust to a single model outlier. The model spread is
// returned as a free uncertainty estimate.
const BASE = 'https://api.open-meteo.com/v1/forecast'
const MODELS = [
  'icon_seamless',      // DWD (Germany)
  'gfs_seamless',       // NOAA (USA)
  'ecmwf_ifs025',       // ECMWF (Europe)
  'gem_seamless',       // Environment Canada
  'meteofrance_seamless', // Météo-France
]
const VARS = ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'shortwave_radiation']

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

// Fetches current weather, consolidated across models.
// Returns { temp, humidity, wind, solar, sources, spread:{temp,humidity,wind} }.
export async function fetchCurrentWeather(lat, lon) {
  const url =
    `${BASE}?latitude=${lat}&longitude=${lon}` +
    `&current=${VARS.join(',')}` +
    `&models=${MODELS.join(',')}` +
    `&wind_speed_unit=kmh&timezone=auto`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const c = (await res.json()).current

  // With multiple models, keys are suffixed: temperature_2m_icon_seamless …
  // Fall back to the un-suffixed key if a single model / older shape is returned.
  const pick = v => {
    const vals = MODELS.map(m => c[`${v}_${m}`]).filter(x => x != null && !Number.isNaN(x))
    return vals.length ? vals : (c[v] != null ? [c[v]] : [])
  }
  const temps = pick('temperature_2m')
  const rhs   = pick('relative_humidity_2m')
  const winds = pick('wind_speed_10m')
  const sols  = pick('shortwave_radiation')

  if (!temps.length) throw new Error('Open-Meteo: no model data')

  return {
    temp:     Math.round(median(temps) * 2) / 2,
    humidity: Math.round(median(rhs)),
    wind:     Math.round(median(winds)),
    solar:    Math.round(median(sols) ?? 0),
    sources:  temps.length,
    spread: {
      temp:     spread(temps),
      humidity: spread(rhs),
      wind:     spread(winds),
    },
  }
}

// Fetches up to `hours` of hourly forecast across the full 16-day horizon,
// keeping the per-model samples so callers can build a confidence band.
// Each entry: { time, temp, humidity, wind, solar (medians),
//               samples: [{ t, rh, w, s }] one per model that has data }.
export async function fetchHourlyForecast(lat, lon, futureHours = 384, pastHours = 6) {
  const url =
    `${BASE}?latitude=${lat}&longitude=${lon}` +
    `&hourly=${VARS.join(',')}` +
    `&models=${MODELS.join(',')}` +
    `&wind_speed_unit=kmh&timezone=auto&forecast_days=16&past_days=1`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const h = await res.json().then(d => d.hourly)

  // Build one sample per model (suffixed keys), keeping only complete rows.
  const sampleAt = i => {
    const out = []
    for (const m of MODELS) {
      const t  = h[`temperature_2m_${m}`]?.[i]
      const rh = h[`relative_humidity_2m_${m}`]?.[i]
      const w  = h[`wind_speed_10m_${m}`]?.[i]
      const s  = h[`shortwave_radiation_${m}`]?.[i]
      if (t != null && rh != null && w != null) out.push({ t, rh, w, s: s ?? null })
    }
    // Fallback to un-suffixed shape (single model).
    if (!out.length && h.temperature_2m?.[i] != null) {
      out.push({ t: h.temperature_2m[i], rh: h.relative_humidity_2m?.[i],
                 w: h.wind_speed_10m?.[i], s: h.shortwave_radiation?.[i] ?? null })
    }
    return out
  }

  const all = h.time.map((t, i) => {
    const samples = sampleAt(i)
    if (!samples.length) return null
    return {
      time:     new Date(t),
      samples,
      temp:     median(samples.map(s => s.t)),
      humidity: median(samples.map(s => s.rh)),
      wind:     median(samples.map(s => s.w)),
      solar:    median(samples.map(s => s.s).filter(x => x != null)) ?? 0,
    }
  }).filter(Boolean)

  // Keep `pastHours` before the current hour, then `futureHours` ahead.
  const now = Date.now()
  const nowIdx = Math.max(0, all.findIndex(e => e.time.getTime() + 3600000 > now))
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
