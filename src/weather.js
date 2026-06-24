// Fetches current weather from Open-Meteo (no API key required).
// Returns { temp, humidity, wind } or throws on error.
export async function fetchCurrentWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m` +
    `&wind_speed_unit=kmh&timezone=auto`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const data = await res.json()
  const c = data.current
  return {
    temp:     Math.round(c.temperature_2m * 2) / 2,   // round to 0.5 step
    humidity: Math.round(c.relative_humidity_2m),
    wind:     Math.round(c.wind_speed_10m),
  }
}
