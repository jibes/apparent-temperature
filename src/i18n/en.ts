// Source catalogue. Every other language must `satisfies Messages`.
// Light inline markup is rendered by ui/Rich: **strong**, _em_, `code`.
const en = {
  appName: 'Apparent Temperature',
  appShort: 'Feels like',
  appDescription: 'Apparent temperature (UTCI) with sun, wind and ventilation advice.',

  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  /** Short date of a wall-clock day. */
  date: (wd: string, d: number, m: number) => `${wd} ${m}/${d}`,
  /** Day number label on the chart axis and day tiles. */
  dayNum: (wd: string, d: number) => `${wd} ${d}`,

  now: 'Now',
  tapForNow: ' · tap for now',
  backToNow: 'Back to now',
  info: 'Info',
  build: (sha: string, date: string) => `Build ${sha} · ${date}`,

  tabs: { felt: 'Feels like', vent: 'Ventilate' },

  update: { available: 'A new version is available.', reload: 'Update', dismiss: 'Later' },

  geo: {
    useMyLocation: 'Use my location',
    searchPlaceholder: 'Search place…',
    search: 'Search',
    cancel: 'Cancel',
    locating: 'Getting your location…',
    updating: 'Updating…',
    searching: 'Searching…',
    notFound: 'Place not found – search again',
    failed: 'Update failed',
    choose: 'Choose a location…',
    searchTitle: 'Search place',
    pinnedTitle: 'Fixed place (searched) – tap to change',
    followTitle: 'Follows your location – tap to change',
  },

  age: {
    now: 'just updated',
    min: (n: number) => `updated ${n} min ago`,
    hours: (n: number) => `updated ${n} h ago`,
    days: (n: number) => `updated ${n} days ago`,
  },

  metrics: {
    temp: 'Air temp.',
    ah: 'Abs. humidity',
    wind: 'Wind',
    csun: 'Sun (clear)',
    clouds: 'Cloud cover',
    rh: 'Rel. humidity',
    effsun: 'Sun effective',
    felt: 'Feels like',
  },
  metricShort: { temp: 'Temp.', ah: 'Humidity', wind: 'Wind', csun: 'Sun', clouds: 'Clouds' },

  utci: {
    extremeHeat: 'Extreme heat stress',
    veryStrongHeat: 'Very strong heat stress',
    strongHeat: 'Strong heat stress',
    moderateHeat: 'Moderate heat stress',
    noStress: 'No thermal stress',
    slightCold: 'Slight cold stress',
    moderateCold: 'Moderate cold stress',
    strongCold: 'Strong cold stress',
    veryStrongCold: 'Very strong cold stress',
    extremeCold: 'Extreme cold stress',
  },

  chart: {
    preview: 'Forecast',
    loading: 'Loading forecast…',
    title: (days: number) => `${days}-day forecast`,
    spread: 'Spread',
    spreadShow: 'Show model spread',
    spreadHide: 'Hide model spread',
    liveTitle: 'Live – follows the current time',
    jumpNow: 'Jump to now',
    dayRange: (label: string, lo: number, hi: number, unit: string) =>
      `${label} ${lo}–${hi} ${unit} · tap to show in the chart`,
    dayScroll: (date: string) => `Scroll to ${date}`,
    empty: 'no values selected',
    note:
      'Toggle base values (dashed) on and off – derived values (solid: rel. humidity, effective sun, feels like) appear automatically. ' +
      '“Feels like” appears with air temp. plus one factor (humidity, wind or sun) and uses only the active factors (without humidity: a neutral 50 %). ' +
      'Line width grows with the number of inputs. Equal units share one scale (directly comparable). Dark bands = night. ' +
      'Tap to pick a time; tap a legend row to highlight a metric; “Spread” shows the model spread.',
  },

  felt: {
    stepBack: 'One hour back',
    stepForward: 'One hour ahead',
    waiting: 'Waiting for weather data…',
    airOnly: 'Air temperature — pick at least one more factor above for “feels like”.',
    perModel: (lo: string, hi: string) => `${lo}–${hi}°C depending on model · `,
    vsAir: (d: string) => `${d}°C vs. air`,
    muggy: { noticeable: 'noticeable', strong: 'strong' },
    muggyChip: (level: string, dp: string) => `💧 Muggy, ${level} · dew pt ${dp}°C`,
  },

  method: {
    title: 'Formulas & method',
    utci: '**UTCI** – Bröde et al. (2012). Universal Thermal Climate Index: a 210-term 6th-order polynomial in air temperature, wind speed, mean radiant temperature and vapour pressure. Wind limits: 0.5–17 m/s.',
    shadeSun:
      '**Shade vs. sun** – shade means no radiation (Tmrt = air), sun means clear sky. The clear-sky maximum comes from the sun position (NOAA algorithm: date, time, latitude & longitude) and the Haurwitz model – weaker in winter and in the evening, zero at night.',
    elevation:
      '**Elevation** – always included, since it belongs to the place like latitude and longitude: clear-sky radiation is altitude-corrected (thinner atmosphere → less scattering and absorption, empirically about +8 % per 1000 m), and the enthalpy on the Ventilate tab uses the barometric pressure at the grid cell’s elevation. The temperature itself is already scaled to terrain height by the weather model (~0.65 K/100 m).',
    mrt: '**Radiant temperature** – simplified linear approximation `Tmrt = T + 0.025·I` from global radiation I [W/m²].',
    magnus:
      '**Magnus-Tetens** (Alduchov & Eskridge 1996): `e_s = 6.1094·exp(17.625T / (243.04+T))`. Dew point by inversion. Abs. humidity: `rho_w = 216.7·e / T_K`.',
    finest: (name: string, resKm: number, place: string | null) =>
      `**Finest resolution here** – ${name} (~${resKm} km)${place ? ` at **${place}**` : ''}. Changes with the place and can get coarser further out, once the finest model reaches its forecast horizon.`,
    data: (base: number, rad: number, cloud: number) =>
      `**Data** – consensus (median) of the weather models via Open-Meteo. Members per variable (now): temperature / humidity / wind **${base}** · solar radiation **${rad}** · cloud cover **${cloud}**. Derived values inherit the count of their inputs (feels like in shade/sun: ${base}, cloudy: ${rad}); “Sun (clear)” is pure astronomy (no model). Models drop out one by one as the horizon grows – the spread further out rests on fewer members.`,
    member: (name: string, org: string, res: string, days: number) =>
      `**${name}** (${org}, ~${res}) – reaches ~${days} days`,
    noRad: ' · no radiation',
    noCloud: ' · no cloud cover',
    grid: (lat: string, lon: string, elev: number | null, km: string) =>
      `**Grid** – values apply to the model grid cell around ${lat}°N, ${lon}°E${elev != null ? ` at ${elev} m a.s.l.` : ''}, ~${km} km from the chosen point. No model resolves microclimate (street canyons, slopes, nearby water).`,
    disclaimer:
      'UTCI assumes a walking person in adapted clothing. Guide values, not measurements.',
  },

  models: {
    icon_seamless: 'German Weather Service',
    gfs_seamless: 'USA',
    ecmwf_ifs025: 'Europe',
    gem_seamless: 'Canada',
    meteofrance_seamless: 'France',
    meteoswiss_icon_ch1: 'MeteoSwiss',
    meteoswiss_icon_ch2: 'MeteoSwiss',
  },

  vent: {
    verdict: {
      condensation: 'Condensation risk',
      recommended: 'Recommended',
      sensible: 'Worthwhile',
      weigh: 'Trade-off',
      noEffect: 'No effect',
      notRecommended: 'Not recommended',
    },
    hero: {
      condensation: 'Keep windows closed',
      recommended: 'Airing recommended',
      sensible: 'Airing worthwhile',
      weigh: 'Trade-off',
      noEffect: 'Little effect',
      notRecommended: 'Keep windows closed',
    },
    reason: {
      condensation: (dpOut: string, tin: string) =>
        `Outdoor dew point (${dpOut}°C) is above the indoor temperature (${tin}°C) → condensation on cool surfaces possible.`,
      drierCooler: (ahOut: string, ahIn: string, dH: string) =>
        `The outdoor air is drier (${ahOut} vs. ${ahIn} g/m³) and cooler (Δh = ${dH} kJ/kg).`,
      drierWarmer: (dH: string) => `The outdoor air is drier but warmer (Δh = ${dH} kJ/kg).`,
      drierSimilar: (dH: string) =>
        `The outdoor air is drier but thermally similar (Δh = ${dH} kJ/kg).`,
      coolerWetter: (ahOut: string, ahIn: string) =>
        `The outdoor air is cooler but more humid (${ahOut} vs. ${ahIn} g/m³).`,
      same: 'Indoors and outdoors are almost the same – airing mainly brings fresh air (CO₂).',
      wetter: (ahOut: string, ahIn: string) =>
        `The outdoor air is more humid (${ahOut} vs. ${ahIn} g/m³).`,
      wetterWarmer: (ahOut: string, ahIn: string, dH: string) =>
        `The outdoor air is more humid (${ahOut} vs. ${ahIn} g/m³) and warmer (Δh = +${dH} kJ/kg).`,
    },
    effect: {
      condensation: '⚠ Condensation risk',
      moisture: (arrow: string, v: string) => `Humidity ${arrow} ${v} g/m³`,
      heat: (arrow: string, v: string) => `Heat load ${arrow} ${v} kJ/kg`,
      freshAir: 'fresh air only (CO₂)',
    },
    manual: '✎ Manual · tap for now',
    hourWhen: (wd: string, hh: string) => `${wd} ${hh}:00 · tap for now`,
    timelineTitle: 'Next 24 h · tap an hour',
    hourLabel: (hh: string, verdict: string, temp: string, rh: number) =>
      `${hh}:00: ${verdict} (${temp} °C, ${rh} %)`,
    loading: 'Loading forecast…',
    today: 'today',
    slot: (day: string, from: string, to: string) => `${day} ${from}:00–${to}:00`,
    allDay: 'almost all day',
    does: {
      driesCools: 'dries and cools',
      dries: 'dries the room air',
      cools: 'cools the room',
      freshens: 'freshens the air',
    },
    duration: {
      short: 'a short burst (5–10 min) is enough',
      medium: 'air for about 10–20 min',
      long: 'rather air for 20–30 min',
    },
    bestWindow: (slot: string, does: string, dT: number, dur: string) =>
      `🪟 Best window: **${slot}** – ${does} · ΔT ${dT} °C → ${dur}.`,
    noWindow:
      'In the next 24 h the outdoor air offers no clear advantage – just air briefly for fresh air (CO₂).',
    indoor: 'Indoor',
    outdoor: 'Outdoor',
    temperature: 'Temperature',
    humidity: 'Humidity',
    table: {
      temp: 'Temperature',
      dewPoint: 'Dew point',
      dewPointInfo:
        'Dew point comparison: if it is higher outdoors than indoors, airing brings in more moisture.',
      absHum: 'Abs. humidity',
      absHumInfo:
        'Absolute water content. The primary signal for airing: if outdoor > indoor, it gets more humid.',
      enthalpy: 'Enthalpy',
      enthalpyInfo:
        'Specific enthalpy of moist air (sensible + latent heat). If outdoor < indoor, airing reduces the thermal load.',
    },
    note: 'The advice (_whether_ to air) depends only on temperature and humidity on both sides – wind and sun don’t change it. The _best window_ rates each hour by drying effect (Δ abs. humidity, works in winter too: cold air is absolutely dry), directional temperature effect (brief airing hardly cools walls – cold counts little, cooling an overheated room counts a lot) and exchange speed: a large temperature difference and wind exchange the room air faster – hence the shorter recommended duration.',
  },
};

export type Messages = typeof en;
export default en;
