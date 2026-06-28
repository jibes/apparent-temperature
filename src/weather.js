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
