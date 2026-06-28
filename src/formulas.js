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

// UTCI polynomial approximation (Bröde et al. 2012, Int J Biometeorol 56:481-494)
// 6th-order polynomial in 4 variables: Ta [°C], vel [m/s], d_tr [°C], Pa [kPa]
// Coefficients from the ladybug-tools reference implementation (faithful to Bröde 2012).
// Valid range: Ta −50–50°C, vel 0.5–17 m/s, D_Tmrt −30–70°C, RH 5–100%.
//
// Physical meaning of leading first-order coefficients:
//   vel: −2.258 → wind cools (large effect)
//   d_tr: +0.398 → radiation warms
//   Pa:  +5.127 → humid air increases heat stress
//
// Usage: set d_tr = 0 for shade (Tr = Ta); set vel = 0.5 for calm indoor air.

// Mean radiant temperature from global (shortwave) solar radiation.
// In shade Tr ≈ Ta. Sunlight absorbed by a body raises the radiant
// environment well above air temperature. This is a simplified linear
// approximation, calibrated so that full midday sun (~1000 W/m²) yields
// ΔTmrt ≈ 25 °C — consistent with globe-thermometer observations.
// (A rigorous treatment would use SolarCal / ASHRAE 55 with solar
// geometry, albedo and clothing absorptivity.)
export function meanRadiantTemp(Ta, solar) {
  return Ta + 0.025 * Math.max(0, solar)
}

// Peak clear-sky global irradiance [W/m²] at solar noon for a given latitude
// and date — the strongest the sun can get that day. Captures the seasonal
// effect: a low winter sun yields far less radiation than a high summer sun.
//   declination: Cooper (1969); clear-sky GHI: Haurwitz model.
export function clearSkyMax(lat, date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0)
  const N = Math.floor((date - start) / 86400000)          // day of year
  const decl = 23.45 * Math.sin((2 * Math.PI * (284 + N)) / 365) // °
  const elev = 90 - Math.abs(lat - decl)                   // solar elevation at noon
  if (elev <= 0) return 0
  const cosZ = Math.cos(((90 - elev) * Math.PI) / 180)     // cos(zenith)
  if (cosZ <= 0) return 0
  return Math.max(0, 1098 * cosZ * Math.exp(-0.057 / cosZ))
}

export function utci(Ta, RH, va_kmh, Tr = null) {
  const vel = Math.max(0.5, Math.min(17, va_kmh / 3.6)) // km/h → m/s, clamp
  const d_tr = (Tr ?? Ta) - Ta                          // radiant offset [°C]
  const Pa   = vaporPressure(Ta, RH) / 10              // hPa → kPa

  const ta = Ta
  const ta2 = ta*ta, ta3=ta2*ta, ta4=ta3*ta, ta5=ta4*ta, ta6=ta5*ta
  const v = vel
  const v2 = v*v, v3=v2*v, v4=v3*v, v5=v4*v, v6=v5*v
  const d = d_tr
  const d2 = d*d, d3=d2*d, d4=d3*d, d5=d4*d, d6=d5*d
  const p = Pa
  const p2 = p*p, p3=p2*p, p4=p3*p, p5=p4*p, p6=p5*p

  return ta + (
    0.607562052 +
    -0.0227712343 * ta +
    8.06470249e-4 * ta2 +
    -1.54271372e-4 * ta3 +
    -3.24651735e-6 * ta4 +
    7.32602852e-8  * ta5 +
    1.35959073e-9  * ta6 +
    // --- vel ---
    -2.25836520    * v +
    0.0880326035   * ta * v +
    0.00216844454  * ta2 * v +
    -1.53347087e-5 * ta3 * v +
    -5.72983704e-7 * ta4 * v +
    -2.55090145e-9 * ta5 * v +
    // --- vel^2 ---
    -0.751269505   * v2 +
    -0.00408350271 * ta * v2 +
    -5.21670675e-5 * ta2 * v2 +
    1.94544667e-6  * ta3 * v2 +
    1.14099531e-8  * ta4 * v2 +
    // --- vel^3 ---
    0.158137256    * v3 +
    -6.57263143e-5 * ta * v3 +
    2.22697524e-7  * ta2 * v3 +
    -4.16117031e-8 * ta3 * v3 +
    // --- vel^4 ---
    -0.0127762753  * v4 +
    9.66891875e-6  * ta * v4 +
    2.52785852e-9  * ta2 * v4 +
    // --- vel^5 ---
    4.56306672e-4  * v5 +
    -1.74202546e-7 * ta * v5 +
    // --- vel^6 ---
    -5.91491269e-6 * v6 +
    // --- d_tr ---
    0.398374029    * d +
    1.83945314e-4  * ta * d +
    -1.73754510e-4 * ta2 * d +
    -7.60781159e-7 * ta3 * d +
    3.77830287e-8  * ta4 * d +
    5.43079673e-10 * ta5 * d +
    -0.0200518269  * v * d +
    8.92859837e-4  * ta * v * d +
    3.45433048e-6  * ta2 * v * d +
    -3.77925774e-7 * ta3 * v * d +
    -1.69699377e-9 * ta4 * v * d +
    1.69992415e-4  * v2 * d +
    -4.99204314e-5 * ta * v2 * d +
    2.47417178e-7  * ta2 * v2 * d +
    1.07596466e-8  * ta3 * v2 * d +
    8.49242932e-5  * v3 * d +
    1.35191328e-6  * ta * v3 * d +
    -6.21531254e-9 * ta2 * v3 * d +
    -4.99410301e-6 * v4 * d +
    -1.89489258e-8 * ta * v4 * d +
    8.15300114e-8  * v5 * d +
    // --- d_tr^2 ---
    7.55043090e-4  * d2 +
    -5.65095215e-5 * ta * d2 +
    -4.52166564e-7 * ta2 * d2 +
    2.46688878e-8  * ta3 * d2 +
    2.42674348e-10 * ta4 * d2 +
    1.54547250e-4  * v * d2 +
    5.24110970e-6  * ta * v * d2 +
    -8.75874982e-8 * ta2 * v * d2 +
    -1.50743064e-9 * ta3 * v * d2 +
    -1.56236307e-5 * v2 * d2 +
    -1.33895614e-7 * ta * v2 * d2 +
    2.49709824e-9  * ta2 * v2 * d2 +
    6.51711721e-7  * v3 * d2 +
    1.94960053e-9  * ta * v3 * d2 +
    -1.00361113e-8 * v4 * d2 +
    // --- d_tr^3 ---
    -1.21206673e-5 * d3 +
    -2.18203660e-7 * ta * d3 +
    7.51269482e-9  * ta2 * d3 +
    9.79063848e-11 * ta3 * d3 +
    1.25006734e-6  * v * d3 +
    -1.81584736e-9 * ta * v * d3 +
    -3.52197671e-10* ta2 * v * d3 +
    -3.36514630e-8 * v2 * d3 +
    1.35908359e-10 * ta * v2 * d3 +
    4.17032620e-10 * v3 * d3 +
    // --- d_tr^4 ---
    -1.30369025e-9 * d4 +
    4.13908461e-10 * ta * d4 +
    9.22652254e-12 * ta2 * d4 +
    -5.08220384e-9 * v * d4 +
    -2.24730961e-11* ta * v * d4 +
    1.17139133e-10 * v2 * d4 +
    // --- d_tr^5 ---
    6.62154879e-10 * d5 +
    4.03863260e-13 * ta * d5 +
    1.95087203e-12 * v * d5 +
    // --- d_tr^6 ---
    -4.73602469e-12* d6 +
    // --- Pa ---
    5.12733497     * p +
    -0.312788561   * ta * p +
    -0.0196701861  * ta2 * p +
    9.99690870e-4  * ta3 * p +
    9.51738512e-6  * ta4 * p +
    -4.66426341e-7 * ta5 * p +
    0.548050612    * v * p +
    -0.00330552823 * ta * v * p +
    -0.00164119440 * ta2 * v * p +
    -5.16670694e-6 * ta3 * v * p +
    9.52692432e-7  * ta4 * v * p +
    -0.0429223622  * v2 * p +
    0.00500845667  * ta * v2 * p +
    1.00601257e-6  * ta2 * v2 * p +
    -1.81748644e-6 * ta3 * v2 * p +
    -1.25813502e-3 * v3 * p +
    -1.79330391e-4 * ta * v3 * p +
    2.34994441e-6  * ta2 * v3 * p +
    1.29735808e-4  * v4 * p +
    1.29064870e-6  * ta * v4 * p +
    -2.28558686e-6 * v5 * p +
    -0.0369476348  * d * p +
    0.00162325322  * ta * d * p +
    -3.14279680e-5 * ta2 * d * p +
    2.59835559e-6  * ta3 * d * p +
    -4.77136523e-8 * ta4 * d * p +
    8.64203390e-3  * v * d * p +
    -6.87405181e-4 * ta * v * d * p +
    -9.13863872e-6 * ta2 * v * d * p +
    5.15916806e-7  * ta3 * v * d * p +
    -3.59217476e-5 * v2 * d * p +
    3.28696511e-5  * ta * v2 * d * p +
    -7.10542454e-7 * ta2 * v2 * d * p +
    -1.24382300e-5 * v3 * d * p +
    -7.38584400e-9 * ta * v3 * d * p +
    2.20609296e-7  * v4 * d * p +
    -7.32469180e-4 * d2 * p +
    -1.87381964e-5 * ta * d2 * p +
    4.80925239e-6  * ta2 * d2 * p +
    -8.75492040e-8 * ta3 * d2 * p +
    2.77862930e-5  * v * d2 * p +
    -5.06004592e-6 * ta * v * d2 * p +
    1.14325367e-7  * ta2 * v * d2 * p +
    2.53016723e-6  * v2 * d2 * p +
    -1.72857035e-8 * ta * v2 * d2 * p +
    -3.95079398e-8 * v3 * d2 * p +
    -3.59413173e-7 * d3 * p +
    7.04388046e-7  * ta * d3 * p +
    -1.89309167e-8 * ta2 * d3 * p +
    -4.79768731e-7 * v * d3 * p +
    7.96079978e-9  * ta * v * d3 * p +
    1.62897058e-9  * v2 * d3 * p +
    3.94367674e-8  * d4 * p +
    -1.18566247e-9 * ta * d4 * p +
    3.34678041e-10 * v * d4 * p +
    -1.15606447e-10* d5 * p +
    // --- Pa^2 ---
    -2.80626406    * p2 +
    0.548712484    * ta * p2 +
    -0.00399428410 * ta2 * p2 +
    -9.54009191e-4 * ta3 * p2 +
    1.93090978e-5  * ta4 * p2 +
    -0.308806365   * v * p2 +
    0.0116952364   * ta * v * p2 +
    4.95271903e-4  * ta2 * v * p2 +
    -1.90710882e-5 * ta3 * v * p2 +
    0.00210787756  * v2 * p2 +
    -6.98445738e-4 * ta * v2 * p2 +
    2.30109073e-5  * ta2 * v2 * p2 +
    4.17856590e-4  * v3 * p2 +
    -1.27043871e-5 * ta * v3 * p2 +
    -3.04620472e-6 * v4 * p2 +
    0.0514507424   * d * p2 +
    -0.00432510997 * ta * d * p2 +
    8.99281156e-5  * ta2 * d * p2 +
    -7.14663943e-7 * ta3 * d * p2 +
    -2.66016305e-4 * v * d * p2 +
    2.63789586e-4  * ta * v * d * p2 +
    -7.01199003e-6 * ta2 * v * d * p2 +
    -1.06823306e-4 * v2 * d * p2 +
    3.61341136e-6  * ta * v2 * d * p2 +
    2.29748967e-7  * v3 * d * p2 +
    3.04788893e-4  * d2 * p2 +
    -6.42070836e-5 * ta * d2 * p2 +
    1.16257971e-6  * ta2 * d2 * p2 +
    7.68023384e-6  * v * d2 * p2 +
    -5.47446896e-7 * ta * v * d2 * p2 +
    -3.59937910e-8 * v2 * d2 * p2 +
    -4.36497725e-6 * d3 * p2 +
    1.68737969e-7  * ta * d3 * p2 +
    2.67489271e-8  * v * d3 * p2 +
    3.23926897e-9  * d4 * p2 +
    // --- Pa^3 ---
    -0.0353874123  * p3 +
    -0.221201190   * ta * p3 +
    0.0155126038   * ta2 * p3 +
    -2.63917279e-4 * ta3 * p3 +
    0.0453433455   * v * p3 +
    -0.00432943862 * ta * v * p3 +
    1.45389826e-4  * ta2 * v * p3 +
    2.17508610e-4  * v2 * p3 +
    -6.66724702e-5 * ta * v2 * p3 +
    3.33217140e-5  * v3 * p3 +
    -0.00226921615 * d * p3 +
    3.80261982e-4  * ta * d * p3 +
    -5.45314314e-9 * ta2 * d * p3 +
    -7.96355448e-4 * v * d * p3 +
    2.53458034e-5  * ta * v * d * p3 +
    -6.31223658e-6 * v2 * d * p3 +
    3.02122035e-4  * d2 * p3 +
    -4.77403547e-6 * ta * d2 * p3 +
    1.73825715e-6  * v * d2 * p3 +
    -4.09087898e-7 * d3 * p3 +
    // --- Pa^4 ---
    0.614155345    * p4 +
    -0.0616755931  * ta * p4 +
    0.00133374846  * ta2 * p4 +
    0.00355375387  * v * p4 +
    -5.13027851e-4 * ta * v * p4 +
    1.02449757e-4  * v2 * p4 +
    -0.00148526421 * d * p4 +
    -4.11469183e-5 * ta * d * p4 +
    -6.80434415e-6 * v * d * p4 +
    -9.77675906e-6 * d2 * p4 +
    // --- Pa^5 ---
    0.0882773108   * p5 +
    -0.00301859306 * ta * p5 +
    0.00104452989  * v * p5 +
    2.47090539e-4  * d * p5 +
    // --- Pa^6 ---
    0.00148348065  * p6
  )
}

// UTCI stress category (ISO 15743 / Bröde 2012)
export function utciCategory(utciVal) {
  if (utciVal > 46)  return { label: 'Extremer Hitzestress',         cls: 'very-hot' }
  if (utciVal > 38)  return { label: 'Sehr starker Hitzestress',     cls: 'hot' }
  if (utciVal > 32)  return { label: 'Starker Hitzestress',          cls: 'hot' }
  if (utciVal > 26)  return { label: 'Mäßiger Hitzestress',          cls: 'warm' }
  if (utciVal > 9)   return { label: 'Keine thermische Belastung',   cls: 'comfortable' }
  if (utciVal > 0)   return { label: 'Leichter Kältestress',         cls: 'cool' }
  if (utciVal > -13) return { label: 'Mäßiger Kältestress',          cls: 'cold' }
  if (utciVal > -27) return { label: 'Starker Kältestress',          cls: 'cold' }
  if (utciVal > -40) return { label: 'Sehr starker Kältestress',     cls: 'very-cold' }
  return               { label: 'Extremer Kältestress',              cls: 'very-cold' }
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
