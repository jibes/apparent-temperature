import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchHourlyForecast, searchLocation } from './weather.js'

afterEach(() => { vi.restoreAllMocks() })

function mockFetch(payload, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok, status, json: async () => payload,
  }))
}

describe('fetchHourlyForecast', () => {
  it('shapes and slices hourly data from the current hour', async () => {
    // Build 48 hours starting 3h ago so "now" falls mid-array.
    const base = Date.now() - 3 * 3600000
    const times = Array.from({ length: 48 }, (_, i) =>
      new Date(base + i * 3600000).toISOString()
    )
    mockFetch({
      hourly: {
        time: times,
        temperature_2m:        times.map(() => 20),
        relative_humidity_2m:  times.map(() => 50),
        wind_speed_10m:        times.map(() => 10),
        shortwave_radiation:   times.map(() => 300),
      },
    })

    const out = await fetchHourlyForecast(52, 13, 24)
    expect(out).toHaveLength(24)
    expect(out[0]).toMatchObject({ temp: 20, humidity: 50, wind: 10, solar: 300 })
    expect(out[0].time).toBeInstanceOf(Date)
    // First returned hour should be the current hour or later, not the past.
    expect(out[0].time.getTime() + 3600000).toBeGreaterThan(Date.now())
  })

  it('throws on HTTP error', async () => {
    mockFetch({}, false, 500)
    await expect(fetchHourlyForecast(0, 0)).rejects.toThrow(/500/)
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
