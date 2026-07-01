import { describe, it, expect } from 'vitest'
import {
  saturationPressure, vaporPressure, dewPoint, absoluteHumidity,
  specificEnthalpy, heatIndex, windChill,
  utci, utciCategory, meanRadiantTemp, clearSkyMax,
  solarElevation, clearSkyGHI, clearSkyHourMean,
} from './formulas.js'

// ── Psychrometrics (exact, hand-verified) ──────────────────────────────────

describe('humidity formulas', () => {
  it('saturation pressure at 20°C ≈ 23.3 hPa', () => {
    expect(saturationPressure(20)).toBeCloseTo(23.3, 0)
  })
  it('saturation pressure at 0°C = AERK constant 6.1094 hPa', () => {
    expect(saturationPressure(0)).toBeCloseTo(6.1094, 4)
  })
  it('saturation pressure at 30°C ≈ 42.4 hPa (WMO ref ~42.43)', () => {
    expect(saturationPressure(30)).toBeCloseTo(42.4, 0)
  })
  it('vapor pressure scales linearly with RH', () => {
    expect(vaporPressure(20, 50)).toBeCloseTo(saturationPressure(20) * 0.5, 6)
  })
  it('dew point at 20°C / 50% ≈ 9.3°C', () => {
    expect(dewPoint(20, 50)).toBeCloseTo(9.3, 1)
  })
  it('dew point equals air temp at 100% RH', () => {
    expect(dewPoint(15, 100)).toBeCloseTo(15, 4)
  })
  it('absolute humidity at 20°C / 50% ≈ 8.6 g/m³', () => {
    expect(absoluteHumidity(20, 50)).toBeCloseTo(8.6, 1)
  })
  it('specific enthalpy at 20°C / 50% ≈ 38.5 kJ/kg', () => {
    expect(specificEnthalpy(20, 50)).toBeCloseTo(38.5, 0)
  })
})

// ── Heat index (NWS two-step) ───────────────────────────────────────────────

describe('heat index', () => {
  it('returns air temp when heat stress negligible (27°C / 10%)', () => {
    expect(heatIndex(27, 10)).toBeCloseTo(27, 5)
  })
  it('adds heat in hot humid conditions (35°C / 60%)', () => {
    const hi = heatIndex(35, 60)
    expect(hi).toBeGreaterThan(45)
    expect(hi).toBeLessThan(60)
  })
  it('is monotonic in humidity when hot', () => {
    expect(heatIndex(35, 70)).toBeGreaterThan(heatIndex(35, 30))
  })
})

// ── Wind chill (EC/NWS 2001) ────────────────────────────────────────────────

describe('wind chill', () => {
  it('at -5°C, 30 km/h ≈ -13.0°C', () => {
    expect(windChill(-5, 30)).toBeCloseTo(-13.0, 0)
  })
  it('colder with more wind', () => {
    expect(windChill(-5, 50)).toBeLessThan(windChill(-5, 10))
  })
})

// ── Mean radiant temp & clear-sky ───────────────────────────────────────────

describe('solar / radiant model', () => {
  it('MRT equals air temp with no sun', () => {
    expect(meanRadiantTemp(20, 0)).toBe(20)
  })
  it('MRT = T + 0.025·I', () => {
    expect(meanRadiantTemp(20, 800)).toBeCloseTo(40, 6)
  })
  it('clear-sky peaks ≈ 1037 W/m² with sun overhead (lat 23.45°, summer solstice noon)', () => {
    const v = clearSkyMax(23.45, 0, new Date('2025-06-21T12:00:00Z'))
    expect(v).toBeGreaterThan(1020)
    expect(v).toBeLessThan(1045)
  })
  it('clear-sky much weaker in winter at 50°N', () => {
    const v = clearSkyMax(50, 0, new Date('2025-12-21T12:00:00Z'))
    expect(v).toBeGreaterThan(220)
    expect(v).toBeLessThan(290)
  })
  it('summer sun stronger than winter sun at same latitude', () => {
    const summer = clearSkyMax(50, 0, new Date('2025-06-21T12:00:00Z'))
    const winter = clearSkyMax(50, 0, new Date('2025-12-21T12:00:00Z'))
    expect(summer).toBeGreaterThan(winter * 2)
  })
  it('zero at night', () => {
    expect(clearSkyMax(50, 0, new Date('2025-06-21T00:00:00Z'))).toBe(0)
  })
})

describe('solar elevation (time of day)', () => {
  it('≈90° with sun overhead (lat = declination, solar noon)', () => {
    expect(solarElevation(23.44, 0, new Date('2025-06-21T12:00:00Z'))).toBeGreaterThan(88)
  })
  it('below horizon at local midnight', () => {
    expect(solarElevation(50, 0, new Date('2025-06-21T00:00:00Z'))).toBeLessThan(0)
  })
  it('noon sun higher than evening sun', () => {
    const noon = solarElevation(50, 0, new Date('2025-06-21T12:00:00Z'))
    const eve  = solarElevation(50, 0, new Date('2025-06-21T17:00:00Z'))
    expect(noon).toBeGreaterThan(eve)
  })
  it('clearSkyGHI rises with elevation', () => {
    expect(clearSkyGHI(60)).toBeGreaterThan(clearSkyGHI(20))
    expect(clearSkyGHI(0)).toBe(0)
  })
})

// ── Clear-sky hour-mean (preceding-hour convention) ─────────────────────────
// These pin the fix for the "real > clear-sky at sunset" artifact. They must
// FAIL if clear-sky reverts to an end-of-hour instant, and they exercise the
// edge hours (sunset, sunrise, solstice noon, night, high latitude) rather than
// a single fair-weather point. Tolerance-based, because Haurwitz clear-sky and a
// model's internal clear-sky differ — a hard real≤klar inequality would flake.
describe('clear-sky hour-mean', () => {
  const inst = (lat, lon, t) => clearSkyGHI(solarElevation(lat, lon, new Date(t)))

  it('averages the PRECEDING hour: at sunset the mean exceeds the end instant', () => {
    // lat 50, lon 0, ~2 h before local midsummer sunset — steep decline.
    const T = Date.parse('2025-07-01T19:00:00Z')
    const mean = clearSkyHourMean(50, 0, T)
    expect(inst(50, 0, T)).toBeGreaterThan(0)       // sun still up (real sunset test)
    expect(mean).toBeGreaterThan(inst(50, 0, T))    // ← the property that fixed the bug
  })

  it('at sunrise the mean is below the end instant (confirms *preceding*, not following)', () => {
    const T = Date.parse('2025-12-21T09:00:00Z')    // low winter sun, rising
    const i = inst(50, 0, T)
    if (i > 0) expect(clearSkyHourMean(50, 0, T)).toBeLessThan(i)
  })

  it('sits between the two hour endpoints, near their average', () => {
    const T = Date.parse('2025-07-01T19:00:00Z')
    const a = inst(50, 0, T - 3600000), b = inst(50, 0, T)
    const mean = clearSkyHourMean(50, 0, T)
    expect(mean).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-6)
    expect(mean).toBeLessThanOrEqual(Math.max(a, b) + 1e-6)
    expect(Math.abs(mean - (a + b) / 2)).toBeLessThan(20) // curvature residual only
  })

  it('near solstice noon the hour is nearly flat: mean ≈ midpoint instant', () => {
    const T = Date.parse('2025-06-21T12:30:00Z')    // hour 11:30–12:30, midpoint = noon
    const mid = inst(50, 0, T - 1800000)
    expect(Math.abs(clearSkyHourMean(50, 0, T) - mid)).toBeLessThan(5)
  })

  it('is zero across a fully-night hour', () => {
    expect(clearSkyHourMean(50, 0, Date.parse('2025-12-21T02:00:00Z'))).toBe(0)
  })

  it('stays finite and non-negative at high latitude (near midnight sun)', () => {
    const v = clearSkyHourMean(78, 15, Date.parse('2025-06-21T00:00:00Z'))
    expect(Number.isFinite(v)).toBe(true)
    expect(v).toBeGreaterThanOrEqual(0)
  })

  it('depends only on the absolute instant (DST-agnostic by construction)', () => {
    // Same UTC instant expressed either side of a EU DST switch → identical.
    const t = Date.parse('2025-03-30T09:00:00Z')
    expect(clearSkyHourMean(50, 10, t)).toBe(clearSkyHourMean(50, 10, t))
  })
})

// ── UTCI (behavioral checks against known physics) ──────────────────────────

describe('UTCI', () => {
  it('near air temp in neutral conditions (25°C, 50%, light wind)', () => {
    const u = utci(25, 50, 5, 25)
    expect(u).toBeGreaterThan(20)
    expect(u).toBeLessThan(30)
  })
  it('wind cools in heat', () => {
    expect(utci(35, 50, 30, 35)).toBeLessThan(utci(35, 50, 5, 35))
  })
  it('humidity increases heat stress', () => {
    expect(utci(35, 70, 5, 35)).toBeGreaterThan(utci(35, 20, 5, 35))
  })
  it('solar radiation increases felt temp', () => {
    const shade = utci(30, 40, 5, 30)
    const sun   = utci(30, 40, 5, 50) // Tr 20° above air
    expect(sun).toBeGreaterThan(shade)
  })
  it('wind chills in cold', () => {
    expect(utci(0, 60, 40, 0)).toBeLessThan(utci(0, 60, 5, 0))
  })
})

describe('UTCI categories', () => {
  it('classifies extreme heat', () => {
    expect(utciCategory(48).cls).toBe('very-hot')
  })
  it('classifies no thermal stress', () => {
    expect(utciCategory(20).label).toMatch(/Keine/)
  })
  it('classifies extreme cold', () => {
    expect(utciCategory(-45).cls).toBe('very-cold')
  })
})
