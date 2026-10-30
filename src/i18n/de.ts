import type { Messages } from './en';

const de = {
  appName: 'Gefühlte Temperatur',
  appShort: 'Gefühlt',
  appDescription: 'Gefühlte Temperatur (UTCI) mit Sonne, Wind und Lüftungsempfehlung.',

  weekdays: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  date: (wd: string, d: number, m: number) => `${wd} ${d}.${m}.`,
  dayNum: (wd: string, d: number) => `${wd} ${d}.`,

  now: 'Jetzt',
  tapForNow: ' · tippen für Jetzt',
  backToNow: 'Zurück zu Jetzt',
  info: 'Info',
  build: (sha: string, date: string) => `Build ${sha} · ${date}`,

  tabs: { felt: 'Gefühlt', vent: 'Lüften' },

  update: {
    available: 'Eine neue Version ist verfügbar.',
    reload: 'Aktualisieren',
    dismiss: 'Später',
  },

  geo: {
    useMyLocation: 'Meinen Standort verwenden',
    searchPlaceholder: 'Ort suchen…',
    search: 'Suchen',
    cancel: 'Abbrechen',
    locating: 'Standort wird ermittelt…',
    updating: 'Aktualisiere…',
    searching: 'Suche…',
    notFound: 'Ort nicht gefunden – erneut suchen',
    failed: 'Aktualisierung fehlgeschlagen',
    choose: 'Standort wählen…',
    searchTitle: 'Ort suchen',
    pinnedTitle: 'Fester Ort (gesucht) – tippen zum Ändern',
    followTitle: 'Folgt deinem Standort – tippen zum Ändern',
  },

  age: {
    now: 'gerade aktualisiert',
    min: (n: number) => `aktualisiert vor ${n} min`,
    hours: (n: number) => `aktualisiert vor ${n} Std`,
    days: (n: number) => `aktualisiert vor ${n} Tagen`,
  },

  metrics: {
    temp: 'Lufttemp.',
    ah: 'Abs. Feuchte',
    wind: 'Wind',
    csun: 'Sonne (klar)',
    clouds: 'Bewölkung',
    rh: 'rel. Feuchte',
    effsun: 'Sonne effektiv',
    felt: 'Gefühlt',
  },
  metricShort: { temp: 'Temp.', ah: 'Feuchte', wind: 'Wind', csun: 'Sonne', clouds: 'Wolken' },

  utci: {
    extremeHeat: 'Extremer Hitzestress',
    veryStrongHeat: 'Sehr starker Hitzestress',
    strongHeat: 'Starker Hitzestress',
    moderateHeat: 'Mäßiger Hitzestress',
    noStress: 'Keine thermische Belastung',
    slightCold: 'Leichter Kältestress',
    moderateCold: 'Mäßiger Kältestress',
    strongCold: 'Starker Kältestress',
    veryStrongCold: 'Sehr starker Kältestress',
    extremeCold: 'Extremer Kältestress',
  },

  chart: {
    preview: 'Vorschau',
    loading: 'Vorschau lädt…',
    title: (days: number) => `${days}-Tage-Vorschau`,
    spread: 'Spanne',
    spreadShow: 'Modell-Spanne einblenden',
    spreadHide: 'Modell-Spanne ausblenden',
    liveTitle: 'Live – folgt der aktuellen Zeit',
    jumpNow: 'Zu jetzt springen',
    dayRange: (label: string, lo: number, hi: number, unit: string) =>
      `${label} ${lo}–${hi} ${unit} · tippen: im Graph anzeigen`,
    dayScroll: (date: string) => `Zum ${date} scrollen`,
    empty: 'keine Werte gewählt',
    note:
      'Basiswerte (gestrichelt) an/aus – abgeleitete Größen (durchgezogen: rel. Feuchte, effektive Sonne, Gefühlt) erscheinen automatisch. ' +
      '„Gefühlt“ erscheint ab Lufttemp. + einem Faktor (Feuchte, Wind oder Sonne) und bezieht nur die aktiven Faktoren ein (ohne Feuchte-Wahl: neutrale 50 %). ' +
      'Die Linienstärke wächst mit der Zahl einfließender Größen. Gleiche Einheiten teilen sich eine Skala (direkt vergleichbar). Dunkle Bänder = Nacht. ' +
      'Tippen wählt einen Zeitpunkt; Legende antippen hebt eine Größe hervor; „Spanne“ blendet die Modell-Spanne ein.',
  },

  felt: {
    stepBack: 'Eine Stunde zurück',
    stepForward: 'Eine Stunde vor',
    waiting: 'Warte auf Wetterdaten…',
    airOnly: 'Lufttemperatur — wähle oben mind. einen weiteren Faktor für „Gefühlt“.',
    perModel: (lo: string, hi: string) => `${lo}–${hi}°C je nach Modell · `,
    vsAir: (d: string) => `${d}°C vs. Luft`,
    muggy: { noticeable: 'spürbar', strong: 'stark' },
    muggyChip: (level: string, dp: string) => `💧 Schwüle ${level} · Tp ${dp}°C`,
  },

  method: {
    title: 'Formeln & Methodik',
    utci: '**UTCI** – Bröde et al. (2012). Universeller thermischer Klimaindex: 210-Term-Polynom 6. Grades in Lufttemperatur, Windgeschwindigkeit, mittlerer Strahlungstemperatur und Dampfdruck. Windlimit: 0.5–17 m/s.',
    shadeSun:
      '**Schatten vs. Sonne** – Schatten ohne Strahlung (Tmrt = Luft), Sonne bei klarem Himmel. Das Klarhimmel-Maximum kommt aus dem Sonnenstand (NOAA-Algorithmus: Datum, Uhrzeit, Breiten- & Längengrad) und dem Haurwitz-Modell – im Winter und abends schwächer, nachts null.',
    elevation:
      '**Höhenlage** – fließt ohne Option immer ein, da sie zum Ort gehört wie Länge und Breite: Die Klarhimmel-Strahlung ist höhenkorrigiert (dünnere Atmosphäre → weniger Streuung und Absorption, empirisch ca. +8 % pro 1000 m), die Enthalpie im Lüften-Tab rechnet mit dem barometrischen Luftdruck der Gitterzellen-Höhe. Die Temperatur selbst ist bereits vom Wettermodell auf die Geländehöhe skaliert (~0.65 K/100 m).',
    mrt: '**Strahlungstemperatur** – vereinfachte lineare Näherung `Tmrt = T + 0.025·I` aus der Globalstrahlung I [W/m²].',
    magnus:
      '**Magnus-Tetens** (Alduchov & Eskridge 1996): `e_s = 6.1094·exp(17.625T / (243.04+T))`. Taupunkt durch Invertierung. Abs. Feuchte: `rho_w = 216.7·e / T_K`.',
    finest: (name: string, resKm: number, place: string | null) =>
      `**Feinste Auflösung hier** – ${name} (~${resKm} km)${place ? ` bei **${place}**` : ''}. Wechselt mit dem Ort und kann im Verlauf gröber werden, sobald das feinste Modell seinen Vorhersagehorizont erreicht.`,
    data: (base: number, rad: number, cloud: number) =>
      `**Datenbasis** – Konsens (Median) aus den Wettermodellen via Open-Meteo. Mitglieder je Größe (jetzt): Temperatur / Feuchte / Wind **${base}** · Sonnenstrahlung **${rad}** · Bewölkung **${cloud}**. Abgeleitete Größen erben die Zahl ihrer Eingänge (gefühlt Schatten/Sonne: ${base}, gefühlt bewölkt: ${rad}); „Sonne (klar)“ ist reine Astronomie (kein Modell). Mit wachsendem Horizont fallen Modelle nacheinander aus – die Spannen im Verlauf stützen sich hinten auf weniger Mitglieder.`,
    member: (name: string, org: string, res: string, days: number) =>
      `**${name}** (${org}, ~${res}) – reicht ~${days} Tage`,
    noRad: ' · ohne Strahlung',
    noCloud: ' · ohne Bewölkung',
    grid: (lat: string, lon: string, elev: number | null, km: string) =>
      `**Ortsauflösung** – die Werte gelten für die Modell-Gitterzelle um ${lat}°N, ${lon}°O${elev != null ? ` auf ${elev} m ü. M.` : ''}, ~${km} km vom gewählten Punkt. Mikroklima (Straßenschluchten, Hanglagen, Gewässernähe) löst kein Modell auf.`,
    disclaimer:
      'UTCI nimmt eine gehende Person in angepasster Kleidung an. Richtwerte, keine Messwerte.',
  },

  models: {
    icon_seamless: 'Deutscher Wetterdienst',
    gfs_seamless: 'USA',
    ecmwf_ifs025: 'Europa',
    gem_seamless: 'Kanada',
    meteofrance_seamless: 'Frankreich',
    meteoswiss_icon_ch1: 'MeteoSchweiz',
    meteoswiss_icon_ch2: 'MeteoSchweiz',
  },

  vent: {
    verdict: {
      condensation: 'Kondens.gefahr',
      recommended: 'Empfohlen',
      sensible: 'Sinnvoll',
      weigh: 'Abwägen',
      noEffect: 'Kein Effekt',
      notRecommended: 'Nicht empfohlen',
    },
    hero: {
      condensation: 'Fenster zu lassen',
      recommended: 'Lüften empfohlen',
      sensible: 'Lüften sinnvoll',
      weigh: 'Abwägen',
      noEffect: 'Kaum Effekt',
      notRecommended: 'Fenster zu lassen',
    },
    reason: {
      condensation: (dpOut: string, tin: string) =>
        `Taupunkt außen (${dpOut}°C) liegt über der Innentemperatur (${tin}°C) → Kondensat auf kühlen Oberflächen möglich.`,
      drierCooler: (ahOut: string, ahIn: string, dH: string) =>
        `Die Außenluft ist trockener (${ahOut} vs. ${ahIn} g/m³) und kühler (Δh = ${dH} kJ/kg).`,
      drierWarmer: (dH: string) => `Die Außenluft ist trockener, aber wärmer (Δh = ${dH} kJ/kg).`,
      drierSimilar: (dH: string) =>
        `Die Außenluft ist trockener, aber thermisch ähnlich (Δh = ${dH} kJ/kg).`,
      coolerWetter: (ahOut: string, ahIn: string) =>
        `Die Außenluft ist kühler, aber feuchter (${ahOut} vs. ${ahIn} g/m³).`,
      same: 'Innen und außen sind fast gleich – Lüften bringt v.a. frische Luft (CO₂).',
      wetter: (ahOut: string, ahIn: string) =>
        `Die Außenluft ist feuchter (${ahOut} vs. ${ahIn} g/m³).`,
      wetterWarmer: (ahOut: string, ahIn: string, dH: string) =>
        `Die Außenluft ist feuchter (${ahOut} vs. ${ahIn} g/m³) und wärmer (Δh = +${dH} kJ/kg).`,
    },
    effect: {
      condensation: '⚠ Kondensationsgefahr',
      moisture: (arrow: string, v: string) => `Feuchte ${arrow} ${v} g/m³`,
      heat: (arrow: string, v: string) => `Wärmelast ${arrow} ${v} kJ/kg`,
      freshAir: 'nur Frischluft (CO₂)',
    },
    manual: '✎ Manuell · tippen für Jetzt',
    hourWhen: (wd: string, hh: string) => `${wd} ${hh}:00 · tippen für Jetzt`,
    timelineTitle: 'Nächste 24 h · Stunde antippen',
    hourLabel: (hh: string, verdict: string, temp: string, rh: number) =>
      `${hh} Uhr: ${verdict} (${temp} °C, ${rh} %)`,
    loading: 'Vorschau lädt…',
    today: 'heute',
    slot: (day: string, from: string, to: string) => `${day} ${from}–${to} Uhr`,
    allDay: 'fast durchgehend',
    does: {
      driesCools: 'trocknet und kühlt',
      dries: 'trocknet die Raumluft',
      cools: 'kühlt den Raum',
      freshens: 'frischt die Luft auf',
    },
    duration: {
      short: 'kurzes Stoßlüften (5–10 min) genügt',
      medium: 'ca. 10–20 min lüften',
      long: 'eher 20–30 min lüften',
    },
    bestWindow: (slot: string, does: string, dT: number, dur: string) =>
      `🪟 Bestes Fenster: **${slot}** – ${does} · ΔT ${dT} °C → ${dur}.`,
    noWindow:
      'In den nächsten 24 h bietet die Außenluft keinen klaren Vorteil – nur kurz für Frischluft (CO₂) lüften.',
    indoor: 'Innen',
    outdoor: 'Außen',
    temperature: 'Temperatur',
    humidity: 'Luftfeuchtigkeit',
    table: {
      temp: 'Temperatur',
      dewPoint: 'Taupunkt',
      dewPointInfo:
        'Taupunkt-Vergleich: Wenn außen höher als innen, bringt Lüften mehr Feuchte herein.',
      absHum: 'Abs. Feuchte',
      absHumInfo:
        'Absoluter Wassergehalt. Primäres Signal fürs Lüften: Wenn außen > innen, wird es feuchter.',
      enthalpy: 'Enthalpie',
      enthalpyInfo:
        'Spez. Enthalpie der Feuchtluft (fühlbare + latente Wärme). Wenn außen < innen, reduziert Lüften die thermische Last.',
    },
    note: 'Die Empfehlung (_ob_ lüften) hängt nur von Temperatur und Feuchte beider Seiten ab – Wind und Sonne ändern daran nichts. Das _beste Fenster_ bewertet jede Stunde nach Trocknungseffekt (Δ abs. Feuchte, wirkt auch im Winter: kalte Luft ist absolut trocken), gerichtetem Temperatureffekt (kurzes Lüften kühlt Wände kaum aus – Kälte zählt wenig, Abkühlung bei überwärmtem Raum viel) und Austauschgeschwindigkeit: großes Temperaturgefälle und Wind tauschen die Raumluft schneller – daher die kürzere empfohlene Dauer.',
  },
} satisfies Messages;

export default de;
