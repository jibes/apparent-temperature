import { describe, it, expect } from 'vitest'
import {
  saturationPressure, vaporPressure, dewPoint, absoluteHumidity,
  specificEnthalpy, heatIndex, windChill,
  utci, utciCategory, meanRadiantTemp, clearSkyMax,
  solarElevation, clearSkyGHI,
} from './formulas.js'

// ── Psychrometrics (exact, hand-verified) ──────────────────────────────────

describe('humidity formulas', () => {
  it('saturation pressure at 20°C ≈ 23.3 hPa', () => {
    expect(saturationPressure(20)).toBeCloseTo(23.3, 0)
  })
  it('saturation pressure at 0°C ≈ 6.11 hPa', () => {
    expect(saturationPressure(0)).toBeCloseTo(6.108, 2)
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
