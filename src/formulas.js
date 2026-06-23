// Magnus-Tetens constants (Alduchov & Eskridge 1996) — valid −45°C to +60°C
const MA = 17.625
const MB = 243.04 // °C

// Saturation vapor pressure [hPa]
export function saturationPressure(T) {
  return 6.1078 * Math.exp((MA * T) / (MB + T))
}

// Actual vapor pressure [hPa]
export function vaporPressure(T, RH) {
  return (RH / 100) * saturationPressure(T)
}

// Dew point [°C] — inverse Magnus
export function dewPoint(T, RH) {
  const lnE = Math.log(vaporPressure(T, RH) / 6.1078)
  return (MB * lnE) / (MA - lnE)
}

// Absolute humidity [g/m³]
// Derived from ideal gas law for water vapor: ρ_w = e·M_w/(R·T_K)
// M_w = 18.015 g/mol, R = 8.314 J/(mol·K) → factor 216.7
export function absoluteHumidity(T, RH) {
  return (216.7 * vaporPressure(T, RH)) / (T + 273.15)
}

// Humidity mixing ratio W [kg_water / kg_dry_air]
// W = 0.622 · e / (p − e), standard atmosphere p = 1013.25 hPa
function mixingRatio(T, RH) {
  const e = vaporPressure(T, RH)
  return (0.622 * e) / (1013.25 - e)
}

// Specific enthalpy of moist air [kJ / kg_dry_air]
// h = cp_a·T + W·(L₀ + cp_v·T)
// cp_a = 1.006 kJ/(kg·K), L₀ = 2501 kJ/kg (latent heat at 0°C), cp_v = 1.86 kJ/(kg·K)
export function specificEnthalpy(T, RH) {
  const W = mixingRatio(T, RH)
  return 1.006 * T + W * (2501 + 1.86 * T)
}

// Heat index (NWS / Rothfusz 1990) [°C → °C]
// Two-step: simple Steadman formula first; only apply Rothfusz polynomial if result
// warrants it (NWS threshold: average of simple HI and T ≥ 80°F).
export function heatIndex(T_C, RH) {
  const T = (T_C * 9) / 5 + 32 // °F

  // Step 1 — simplified Steadman
  const HI_simple = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + RH * 0.094)

  // Step 2 — threshold check
  if ((HI_simple + T) / 2 < 80) {
    return T_C // heat stress negligible
  }

  // Step 3 — Rothfusz regression (9-term polynomial)
  let HI =
    -42.379 +
    2.04901523 * T +
    10.14333127 * RH -
    0.22475541 * T * RH -
    6.83783e-3 * T * T -
    5.481717e-2 * RH * RH +
    1.22874e-3 * T * T * RH +
    8.5282e-4 * T * RH * RH -
    1.99e-6 * T * T * RH * RH

  // Adjustment: low RH at high T (Rothfusz eq. 3)
  if (RH < 13 && T >= 80 && T <= 112) {
    HI -= ((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17)
  }
  // Adjustment: high RH at moderately high T (Rothfusz eq. 3)
  if (RH > 85 && T >= 80 && T <= 87) {
    HI += ((RH - 85) / 10) * ((87 - T) / 5)
  }

  return ((HI - 32) * 5) / 9 // → °C
}

// Wind chill (Environment Canada / NWS, 2001 revision) [°C, km/h → °C]
// Calibrated for human face at 1.5 m height, walking pace 1.34 m/s.
// Valid: T ≤ 10°C, v ≥ 4.8 km/h
export function windChill(T, v) {
  return (
    13.12 +
    0.6215 * T -
    11.37 * Math.pow(v, 0.16) +
    0.3965 * T * Math.pow(v, 0.16)
  )
}

// Apparent temperature for outdoor conditions
export function outdoorApparentTemp(T, RH, v) {
  if (T >= 27) {
    const hi = heatIndex(T, RH)
    return { value: hi, formula: hi > T + 0.5 ? 'hitzeindex' : 'keine' }
  }
  if (T <= 10 && v >= 4.8) {
    return { value: windChill(T, v), formula: 'windchill' }
  }
  return { value: T, formula: 'keine' }
}

// Apparent temperature for indoor conditions (no wind)
export function indoorApparentTemp(T, RH) {
  if (T >= 27) {
    const hi = heatIndex(T, RH)
    return { value: hi, formula: hi > T + 0.5 ? 'hitzeindex' : 'keine' }
  }
  return { value: T, formula: 'keine' }
}

// Ventilation assessment — compares indoor vs. outdoor air thermodynamically.
// Returns all raw values plus a recommendation based on:
//   1. Moisture: absolute humidity comparison (primary mold/comfort signal)
//   2. Thermal: specific enthalpy comparison (latent + sensible heat combined)
//   3. Condensation risk: outdoor dew point > indoor surface temperature (proxy: T_in)
export function ventilationAssessment(Tin, RHin, Tout, RHout) {
  const ahIn = absoluteHumidity(Tin, RHin)
  const ahOut = absoluteHumidity(Tout, RHout)
  const hIn = specificEnthalpy(Tin, RHin)
  const hOut = specificEnthalpy(Tout, RHout)
  const dpIn = dewPoint(Tin, RHin)
  const dpOut = dewPoint(Tout, RHout)

  const deltaAH = ahOut - ahIn   // + → outside more humid
  const deltaH = hOut - hIn      // + → outside more total heat
  const condensationRisk = dpOut > Tin

  return {
    ahIn, ahOut, deltaAH,
    hIn, hOut, deltaH,
    dpIn, dpOut,
    condensationRisk,
  }
}
