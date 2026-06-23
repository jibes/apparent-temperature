/**
 * Sättigungsdampfdruck nach Magnus-Formel (hPa)
 */
export function saturationPressure(tempC) {
  return 6.1078 * Math.pow(10, (7.5 * tempC) / (237.3 + tempC))
}

/**
 * Absolute Feuchte (g/m³)
 */
export function absoluteHumidity(tempC, relHumidity) {
  const es = saturationPressure(tempC)
  const e = (relHumidity / 100) * es
  return (216.7 * e) / (tempC + 273.15)
}

/**
 * Hitzeindex nach Rothfusz/Steadman (°C → °C)
 * Gültig ab ~27 °C und rel. Feuchte ≥ 40 %
 */
export function heatIndex(tempC, relHumidity) {
  const T = tempC * 9 / 5 + 32 // Fahrenheit
  const R = relHumidity

  let HI =
    -42.379 +
    2.04901523 * T +
    10.14333127 * R -
    0.22475541 * T * R -
    6.83783e-3 * T * T -
    5.481717e-2 * R * R +
    1.22874e-3 * T * T * R +
    8.5282e-4 * T * R * R -
    1.99e-6 * T * T * R * R

  // Korrekturen für extreme Werte
  if (R < 13 && T >= 80 && T <= 112) {
    HI -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17)
  } else if (R > 85 && T >= 80 && T <= 87) {
    HI += ((R - 85) / 10) * ((87 - T) / 5)
  }

  return (HI - 32) * 5 / 9 // zurück zu Celsius
}

/**
 * Windchill nach Environment Canada (2001)
 * Gültig unter 10 °C und ab 5 km/h
 */
export function windChill(tempC, windKmh) {
  return (
    13.12 +
    0.6215 * tempC -
    11.37 * Math.pow(windKmh, 0.16) +
    0.3965 * tempC * Math.pow(windKmh, 0.16)
  )
}

/**
 * Berechnet die gefühlte Temperatur basierend auf den Eingabewerten.
 * Gibt Objekt zurück: { apparentTemp, formula, ventilationAdvice }
 */
export function calcApparentTemp(tempC, relHumidity, windKmh) {
  let apparentTemp
  let formula

  if (tempC >= 27) {
    apparentTemp = heatIndex(tempC, relHumidity)
    formula = 'hitzeindex'
  } else if (tempC <= 10 && windKmh >= 5) {
    apparentTemp = windChill(tempC, windKmh)
    formula = 'windchill'
  } else {
    apparentTemp = tempC
    formula = 'keine'
  }

  return { apparentTemp, formula }
}
