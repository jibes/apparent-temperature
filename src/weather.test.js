import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchCurrentWeather, fetchHourlyForecast, searchLocation, toEpoch } from './weather.js'

describe('toEpoch (timezone handling)', () => {
  it('interprets a zone-less local string with the location offset', () => {
    // 12:00 wall clock at UTC+2 is 10:00 UTC
    expect(toEpoch('2026-07-01T12:00', 2 * 3600000))
      .toBe(Date.parse('2026-07-01T10:00:00Z'))
  })
  it('interprets a west-of-UTC offset correctly', () => {
    // 12:00 wall clock at UTC-5 is 17:00 UTC
    expect(toEpoch('2026-07-01T12:00', -5 * 3600000))
      .toBe(Date.parse('2026-07-01T17:00:00Z'))
  })
  it('trusts a string that already carries a zone', () => {
    expect(toEpoch('2026-07-01T12:00:00.000Z', 2 * 3600000))
      .toBe(Date.parse('2026-07-01T12:00:00.000Z'))
  })
})

afterEach(() => { vi.restoreAllMocks() })

function mockFetch(payload, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok, status, json: async () => payload,
  }))
}

describe('fetchCurrentWeather (multi-model median)', () => {
  it('takes the per-variable median across models', async () => {
    mockFetch({
      current: {
        // three models with different values → median is robust to the outlier
        temperature_2m_icon_seamless: 20,
        temperature_2m_gfs_seamless:  22,
        temperature_2m_ecmwf_ifs025:  30, // outlier
        relative_humidity_2m_icon_seamless: 50,
        relative_humidity_2m_gfs_seamless:  60,
        relative_humidity_2m_ecmwf_ifs025:  55,
        wind_speed_10m_icon_seamless: 10,
        wind_speed_10m_gfs_seamless:  12,
        wind_speed_10m_ecmwf_ifs025:  20,
        shortwave_radiation_icon_seamless: 300,
        shortwave_radiation_gfs_seamless:  320,
        shortwave_radiation_ecmwf_ifs025:  280,
        cloud_cover_icon_seamless: 40,
        cloud_cover_gfs_seamless:  60,
        cloud_cover_ecmwf_ifs025:  50,
      },
    })
    const w = await fetchCurrentWeather(52, 13)
    expect(w.temp).toBe(22)      // median(20,22,30) = 22, not the 24 a mean would give
    expect(w.humidity).toBe(55)
    expect(w.wind).toBe(12)
    expect(w.solar).toBe(300)
    expect(w.clouds).toBe(50)
    expect(w.sources).toBe(3)
    expect(w.spread.temp).toBe(10) // 30 − 20
  })

  it('throws when no model returned data', async () => {
    mockFetch({ current: {} })
    await expect(fetchCurrentWeather(0, 0)).rejects.toThrow(/no model data/)
  })

  it('throws on HTTP error', async () => {
    mockFetch({}, false, 503)
    await expect(fetchCurrentWeather(0, 0)).rejects.toThrow(/503/)
  })
})

describe('fetchHourlyForecast (multi-model median)', () => {
  it('medians each hour and slices from the current hour', async () => {
    const base = Date.now() - 3 * 3600000
    const times = Array.from({ length: 48 }, (_, i) =>
      new Date(base + i * 3600000).toISOString()
    )
    const fill = v => times.map(() => v)
    mockFetch({
      hourly: {
        time: times,
        temperature_2m_icon_seamless: fill(18),
        temperature_2m_gfs_seamless:  fill(22),
        relative_humidity_2m_icon_seamless: fill(50),
        relative_humidity_2m_gfs_seamless:  fill(50),
        wind_speed_10m_icon_seamless: fill(8),
        wind_speed_10m_gfs_seamless:  fill(12),
        shortwave_radiation_icon_seamless: fill(200),
        shortwave_radiation_gfs_seamless:  fill(400),
      },
    })
    const out = await fetchHourlyForecast(52, 13, 24, 0) // no past hours
    expect(out).toHaveLength(24)
    expect(out[0]).toMatchObject({ temp: 20, humidity: 50, wind: 10, solar: 300 })
    expect(out[0].samples).toHaveLength(2)            // per-model samples kept
    expect(out[0].samples[0]).toMatchObject({ t: 18, rh: 50, w: 8 })
    expect(out[0].time).toBeInstanceOf(Date)
    expect(out[0].time.getTime() + 3600000).toBeGreaterThan(Date.now())
  })

  it('includes the requested number of past hours', async () => {
    const base = Date.now() - 6 * 3600000
    const times = Array.from({ length: 48 }, (_, i) =>
      new Date(base + i * 3600000).toISOString()
    )
    const fill = v => times.map(() => v)
    mockFetch({
      hourly: {
        time: times,
        temperature_2m_icon_seamless: fill(20),
        relative_humidity_2m_icon_seamless: fill(50),
        wind_speed_10m_icon_seamless: fill(10),
        shortwave_radiation_icon_seamless: fill(0),
      },
    })
    const out = await fetchHourlyForecast(52, 13, 12, 4)
    // first entry should be ~4 h in the past
    expect(out[0].time.getTime()).toBeLessThan(Date.now())
    expect(out[0].time.getTime() + 4 * 3600000).toBeLessThan(Date.now() + 3600000)
  })

  it('throws on HTTP error', async () => {
    mockFetch({}, false, 500)
    await expect(fetchHourlyForecast(0, 0)).rejects.toThrow(/500/)
  })

  // Boundary/integration coverage: run the real parse pipeline against a frozen
  // Open-Meteo-shaped payload. Catches field renames, the instant-vs-mean
  // radiation choice, and a ±1h alignment shift between radiation and the instant
  // variables — the class of bug unit tests on the math can't see. Deterministic,
  // no network. Values encode their own hour index so a shift is detectable.
  it('pipeline: instant radiation, aligned to the same hour as temperature, with hour-mean fallback', async () => {
    const N = 48
    const base = Date.now() - 3 * 3600000
    const times = Array.from({ length: N }, (_, i) => new Date(base + i * 3600000).toISOString())
    const idx = Array.from({ length: N }, (_, i) => i)
    mockFetch({
      hourly: {
        time: times,
        // icon: BOTH instant and mean present → the instant one must win
        temperature_2m_icon_seamless: idx.map(i => 100 + i),
        relative_humidity_2m_icon_seamless: idx.map(() => 50),
        wind_speed_10m_icon_seamless: idx.map(() => 10),
        cloud_cover_icon_seamless: idx.map(() => 40),
        shortwave_radiation_instant_icon_seamless: idx.map(i => 200 + i),
        shortwave_radiation_icon_seamless: idx.map(i => 900 + i),
        // gfs: only the hour-mean present → fallback path
        temperature_2m_gfs_seamless: idx.map(i => 100 + i),
        relative_humidity_2m_gfs_seamless: idx.map(() => 60),
        wind_speed_10m_gfs_seamless: idx.map(() => 12),
        cloud_cover_gfs_seamless: idx.map(() => 50),
        shortwave_radiation_gfs_seamless: idx.map(i => 300 + i),
      },
    })
    const out = await fetchHourlyForecast(52, 13, 12, 3)
    expect(out.length).toBeGreaterThan(0)
    const [icon, gfs] = out[0].samples
    // icon uses the INSTANT field (200+i), not the mean (900+i), aligned to temp's hour
    expect(icon.s - 200).toBe(icon.t - 100)
    expect(icon.s - 900).not.toBe(icon.t - 100)
    // gfs falls back to the hour-mean (300+i), still the same hour as its temp
    expect(gfs.s - 300).toBe(gfs.t - 100)
    // other fields parsed
    expect(icon.c).toBe(40)
    expect(gfs.rh).toBe(60)
  })
})

describe('searchLocation', () => {
  it('returns the first geocoding hit', async () => {
    mockFetch([{ lat: '48.137', lon: '11.575', address: { city: 'München' } }])
    const loc = await searchLocation('München')
    expect(loc).toMatchObject({ name: 'München' })
    expect(loc.lat).toBeCloseTo(48.137, 3)
    expect(loc.lon).toBeCloseTo(11.575, 3)
  })

  it('returns null when nothing is found', async () => {
    mockFetch([])
    expect(await searchLocation('asdfqwer')).toBeNull()
  })
})
