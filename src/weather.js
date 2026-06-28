// Fetches current weather from Open-Meteo (no API key required).
// Returns { temp, humidity, wind, solar } or throws on error.
export async function fetchCurrentWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation` +
    `&wind_speed_unit=kmh&timezone=auto`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const data = await res.json()
  const c = data.current
  return {
    temp:     Math.round(c.temperature_2m * 2) / 2,   // round to 0.5 step
    humidity: Math.round(c.relative_humidity_2m),
    wind:     Math.round(c.wind_speed_10m),
    solar:    Math.round(c.shortwave_radiation ?? 0), // global horizontal W/m²
  }
}

// Fetches the next `hours` of hourly forecast from Open-Meteo.
// Returns an array of { time: Date, temp, humidity, wind, solar }.
export async function fetchHourlyForecast(lat, lon, hours = 24) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation` +
    `&wind_speed_unit=kmh&timezone=auto&forecast_days=2`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const data = await res.json()
  const h = data.hourly
  const all = h.time.map((t, i) => ({
    time:     new Date(t),
    temp:     h.temperature_2m[i],
    humidity: h.relative_humidity_2m[i],
    wind:     h.wind_speed_10m[i],
    solar:    h.shortwave_radiation[i] ?? 0,
  }))
  // Start from the current hour (drop past entries), then take `hours`.
  const now = Date.now()
  const startIdx = Math.max(0, all.findIndex(e => e.time.getTime() + 3600000 > now))
  return all.slice(startIdx, startIdx + hours)
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
