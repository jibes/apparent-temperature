import { useState, useEffect, useRef } from 'react'
import {
  utci, utciCategory, meanRadiantTemp, clearSkyMax, comfortAdjust,
  ventilationAssessment,
  dewPoint,
  absoluteHumidity,
} from './formulas.js'
import { fetchCurrentWeather, fetchHourlyForecast, searchLocation } from './weather.js'
import './App.css'

// helpers

function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1) }

// State that survives reloads via localStorage.
function usePersistentState(key, initial) {
  const [val, setVal] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw != null ? JSON.parse(raw) : initial
    } catch { return initial }
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
  }, [key, val])
  return [val, setVal]
}

function colorClass(t) {
  if (t >= 40) return 'very-hot'
  if (t >= 32) return 'hot'
  if (t >= 26) return 'warm'
  if (t >= 16) return 'comfortable'
  if (t >= 8)  return 'cool'
  if (t >= -5) return 'cold'
  return 'very-cold'
}

// Sun presets — intuitive sky conditions as a fraction of the day's peak
// clear-sky irradiance, so each level scales with season & latitude.
const SUN_LEVELS = [
  { frac: 0,    icon: '🌙', label: 'Schatten' },
  { frac: 0.2,  icon: '☁️', label: 'Bedeckt' },
  { frac: 0.5,  icon: '⛅', label: 'Wechselhaft' },
  { frac: 0.85, icon: '🌤️', label: 'Sonnig' },
  { frac: 1.0,  icon: '☀️', label: 'Pralle Sonne' },
]

function sunLevelValues(clearSky) {
  return SUN_LEVELS.map(l => ({ ...l, val: Math.round(l.frac * clearSky) }))
}

function nearestSunLevel(solar, clearSky) {
  return sunLevelValues(clearSky).reduce((best, lvl) =>
    Math.abs(lvl.val - solar) < Math.abs(best.val - solar) ? lvl : best
  )
}

// Wind presets (Beaufort-ish), used alongside the slider.
const WIND_LEVELS = [
  { val: 0,  label: 'Windstill' },
  { val: 8,  label: 'Brise' },
  { val: 20, label: 'Mäßig' },
  { val: 35, label: 'Frisch' },
  { val: 60, label: 'Stürmisch' },
]

function nearestPreset(levels, v) {
  return levels.reduce((best, lvl) =>
    Math.abs(lvl.val - v) < Math.abs(best.val - v) ? lvl : best
  )
}

// Activity (MET) and clothing (clo) presets for personalisation.
const ACT_LEVELS = [
  { val: 1.0, label: '🪑 Ruhend' },
  { val: 2.3, label: '🚶 Gehen' },
  { val: 4.0, label: '🏃 Sport' },
]
const CLO_LEVELS = [
  { val: 0.3, label: '👕 Leicht' },
  { val: 0.7, label: '🧥 Normal' },
  { val: 1.2, label: '🧣 Warm' },
]
// Ground reflectivity (added albedo above ordinary dark ground).
const GROUND_LEVELS = [
  { val: 0.0, label: '🌿 Normal' },
  { val: 0.3, label: '🏖️ Sand' },
  { val: 0.1, label: '🌊 Wasser' },
  { val: 0.8, label: '❄️ Schnee' },
]

function ventVerdict(Tin, RHin, Tout, RHout) {
  const a = ventilationAssessment(Tin, RHin, Tout, RHout)
  const dry  = a.deltaAH < -0.3
  const wet  = a.deltaAH >  0.3
  const cool = a.deltaH  < -0.5
  const warm = a.deltaH  >  0.5
  if (a.condensationRisk)      return { short: 'Kondens.gefahr', cls: 'bad' }
  if (dry && cool)             return { short: 'Empfohlen',      cls: 'good' }
  if (dry && !warm)            return { short: 'Sinnvoll',       cls: 'good' }
  if (dry || cool)             return { short: 'Abwägen',        cls: 'warn' }
  if (!wet && !warm)           return { short: 'Kein Effekt',    cls: 'neutral' }
  return                              { short: 'Nicht empfohlen',cls: 'bad' }
}

// Slider with pointer capture + touch resistance

function Slider({ label, value, onChange, min, max, step, unit, sublabel }) {
  const inputRef = useRef()

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  return (
    <div className="slider-group">
      <div className="slider-header">
        <span className="slider-label">{label}</span>
        <span className="value-badge">{value}{' '}{unit}</span>
      </div>
      <input
        ref={inputRef}
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        onPointerDown={onPointerDown}
        style={{ touchAction: 'pan-y' }}
      />
      <div className="slider-ends">
        <span>{min}{' '}{unit}</span>
        {sublabel ? <span className="slider-sub">{sublabel}</span> : null}
        <span>{max}{' '}{unit}</span>
      </div>
    </div>
  )
}

// Preset chip row (used for wind) — quick presets above/below a slider.

function PresetRow({ levels, value, onChange, unit }) {
  const active = nearestPreset(levels, value)
  return (
    <div className="preset-row">
      {levels.map(lvl => (
        <button
          key={lvl.val}
          type="button"
          className={`preset-btn ${lvl.val === active.val ? 'active' : ''}`}
          onClick={() => onChange(lvl.val)}
        >
          {lvl.label}
        </button>
      ))}
    </div>
  )
}

// Sun selector — icon presets (season-scaled) + fine-tune slider.

function SunSelect({ value, onChange, clearSky }) {
  const levels = sunLevelValues(clearSky)
  const active = nearestSunLevel(value, clearSky)
  const inputRef = useRef()
  return (
    <div className="slider-group">
      <div className="slider-header">
        <span className="slider-label">
          Sonne
          <Info>Wie stark trifft die Sonne dich? Direkte Sonne heizt den Körper über die Lufttemperatur hinaus auf; im Schatten zählt nur die Luft. Die Stufen sind an Jahreszeit und Breitengrad angepasst (heutiges Klarhimmel-Maximum: {Math.round(clearSky)} W/m²).</Info>
        </span>
        <span className="value-badge">{active.label} · {value} W/m²</span>
      </div>
      <div className="sun-select">
        {levels.map(lvl => (
          <button
            key={lvl.label}
            type="button"
            className={`sun-btn ${lvl.val === active.val ? 'active' : ''}`}
            onClick={() => onChange(lvl.val)}
            title={`${lvl.label} (~${lvl.val} W/m²)`}
            aria-label={lvl.label}
          >
            <span className="sun-icon">{lvl.icon}</span>
            <span className="sun-cap">{lvl.label}</span>
          </button>
        ))}
      </div>
      <input
        ref={inputRef}
        type="range"
        min={0} max={1000} step={10} value={value}
        onChange={e => onChange(Number(e.target.value))}
        onPointerDown={e => e.currentTarget.setPointerCapture(e.pointerId)}
        style={{ touchAction: 'pan-y' }}
      />
      <div className="slider-ends">
        <span>0 W/m²</span>
        <span>1000 W/m²</span>
      </div>
    </div>
  )
}

// Info tooltip

function Info({ children }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="info-wrap">
      <button
        className="info-btn"
        onClick={e => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o) }}
        aria-label="Info"
      >i</button>
      {open && <span className="info-tip">{children}</span>}
    </span>
  )
}

// Value chips in collapsible summary

function Chip({ children, cls }) {
  return <span className={`chip ${cls ?? ''}`}>{children}</span>
}

// Ventilation table

function DeltaRow({ label, inVal, outVal, unit, info }) {
  const delta = outVal - inVal
  const sign  = delta >= 0 ? '+' : ''
  const cls   = Math.abs(delta) < 0.4 ? 'neutral' : delta < 0 ? 'good' : 'bad'
  return (
    <div className="d-row">
      <span className="d-label">
        {label}
        {info && <Info>{info}</Info>}
      </span>
      <span className="d-in">{fmt1(inVal)}</span>
      <span className="d-arrow">&#8594;</span>
      <span className="d-out">{fmt1(outVal)}</span>
      <span className={`d-delta ${cls}`}>{sign}{fmt1(delta)}{' '}{unit}</span>
    </div>
  )
}

function VentTable({ Tin, RHin, Tout, RHout }) {
  const a   = ventilationAssessment(Tin, RHin, Tout, RHout)
  const dpI = dewPoint(Tin, RHin)
  const dpO = dewPoint(Tout, RHout)
  const ahI = absoluteHumidity(Tin, RHin)
  const ahO = absoluteHumidity(Tout, RHout)

  const v = ventVerdict(Tin, RHin, Tout, RHout)

  let detail
  if (a.condensationRisk)
    detail = `Taupunkt aussen (${fmt1(dpO)}°C) > Innentemp. (${fmt1(Tin)}°C) → Kondensat auf kühlen Oberflächen möglich.`
  else if (a.deltaAH < -0.3 && a.deltaH < -0.5)
    detail = `Aussenluft ist trockener (${fmt1(ahO)} vs. ${fmt1(ahI)} g/m³) und kühler (Δh = ${fmt1(a.deltaH)} kJ/kg).`
  else if (a.deltaAH < -0.3)
    detail = `Aussenluft trockener, aber ${a.deltaH > 0.5 ? 'wärmer' : 'thermisch ähnlich'} (Δh = ${fmt1(a.deltaH)} kJ/kg).`
  else if (a.deltaH < -0.5)
    detail = `Aussenluft kühler, aber feuchter (${fmt1(ahO)} vs. ${fmt1(ahI)} g/m³).`
  else if (Math.abs(a.deltaAH) < 0.3 && Math.abs(a.deltaH) < 0.5)
    detail = `Kein wesentlicher Unterschied. Lüften sinnvoll für CO₂ / Luftqualität.`
  else
    detail = `Aussenluft feuchter (${fmt1(ahO)} vs. ${fmt1(ahI)} g/m³) und wärmer (Δh = +${fmt1(a.deltaH)} kJ/kg).`

  return (
    <div className="vent-table">
      <div className="d-head">
        <span className="d-label"></span>
        <span className="d-in">Innen</span>
        <span className="d-arrow"></span>
        <span className="d-out">Aussen</span>
        <span className="d-delta">&#916;</span>
      </div>
      <DeltaRow label="Temperatur" inVal={Tin}  outVal={Tout} unit="°C"    />
      <DeltaRow label="Taupunkt"   inVal={dpI}  outVal={dpO}  unit="°C"
        info="Taupunkt-Vergleich: Wenn aussen höher als innen, bringt Lüften mehr Feuchte herein."
      />
      <DeltaRow label="Abs. Feuchte" inVal={ahI} outVal={ahO} unit="g/m³"
        info="Absoluter Wassergehalt. Primäres Signal fürs Lüften: Wenn aussen > innen, wird es feuchter."
      />
      <DeltaRow label="Enthalpie" inVal={a.hIn} outVal={a.hOut} unit="kJ/kg"
        info="Spez. Enthalpie der Feuchtluft (fühlbare + latente Wärme). Wenn aussen < innen, reduziert Lüften die thermische Last."
      />
      <p className={`vent-detail ${v.cls}`}>{detail}</p>
    </div>
  )
}

// Geo status + location search

function GeoBar({ status, location, onRefresh, onSearch, onLocate }) {
  const [searching, setSearching] = useState(false)
  const [query, setQuery]         = useState('')
  const inputRef                  = useRef()

  useEffect(() => {
    if (searching) inputRef.current?.focus()
  }, [searching])

  function submit(e) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    onSearch(q)
    setSearching(false)
    setQuery('')
  }

  if (searching) {
    return (
      <form className="geo-bar" onSubmit={submit}>
        <button
          type="button"
          className="geo-icon"
          onClick={() => { setSearching(false); onLocate() }}
          title="Eigenen Standort verwenden"
          aria-label="Standort verwenden"
        >📍</button>
        <input
          ref={inputRef}
          className="geo-search"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Ort suchen…"
          enterKeyHint="search"
        />
        <button type="submit" className="geo-icon" title="Suchen" aria-label="Suchen">🔍</button>
      </form>
    )
  }

  return (
    <div className="geo-bar">
      {status === 'loading' || status === 'locating'
        ? <span className="geo-msg loading">Standort wird ermittelt…</span>
        : status === 'ok' && location
          ? <span className="geo-ok">
              📍{' '}{location.name ?? `${location.lat.toFixed(2)}, ${location.lon.toFixed(2)}`}
            </span>
          : status === 'searching'
            ? <span className="geo-msg loading">Suche…</span>
            : status === 'notfound'
              ? <span className="geo-msg warn">Ort nicht gefunden</span>
              : <span className="geo-msg warn">Standort nicht verfügbar</span>
      }
      <button
        className="geo-icon"
        onClick={() => setSearching(true)}
        title="Ort suchen"
        aria-label="Ort suchen"
      >🔍</button>
      {(status === 'ok' || status === 'denied' || status === 'error' || status === 'notfound') && (
        <button className="geo-icon" onClick={onRefresh} title="Neu laden" aria-label="Neu laden">&#8635;</button>
      )}
    </div>
  )
}

// Felt-temperature tab (outdoor: temp + humidity + wind + sun)

// 24-hour felt-temperature strip

function ForecastStrip({ hours, met, clo, albedo }) {
  if (!hours || hours.length === 0) return null

  const felts = hours.map(h =>
    comfortAdjust(utci(h.temp, h.humidity, h.wind, meanRadiantTemp(h.temp, h.solar, albedo)), met, clo)
  )
  const min = Math.min(...felts)
  const max = Math.max(...felts)
  const span = Math.max(1, max - min)

  return (
    <div className="forecast">
      <div className="forecast-head">
        <span className="section-name muted">24-Stunden-Verlauf</span>
        <span className="forecast-sub">gefühlt, in der Sonne</span>
      </div>
      <div className="forecast-strip">
        {hours.map((h, i) => {
          const felt = felts[i]
          const hour = h.time.getHours()
          const barH = 6 + Math.round(((felt - min) / span) * 34) // 6–40 px
          return (
            <div className="fc-col" key={i}>
              <span className="fc-temp">{Math.round(felt)}°</span>
              <span className={`fc-bar ${colorClass(felt)}`} style={{ height: `${barH}px` }} />
              <span className="fc-hour">
                {h.solar > 10 ? '' : '🌙'}{String(hour).padStart(2, '0')}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FeltCard({ side, icon, feltTemp, airTemp }) {
  const cat  = utciCategory(feltTemp)
  const cls  = colorClass(feltTemp)
  const diff = feltTemp - airTemp
  return (
    <div className={`felt-card ${cls}`}>
      <div className="felt-head">{icon} {side}</div>
      <div className="ap-val">{fmt1(feltTemp)}{' '}°C</div>
      <div className="ap-cat">{cat.label}</div>
      <div className="ap-formula">
        <span className="ap-diff">{diff >= 0 ? '+' : ''}{fmt1(diff)}°C vs. Luft</span>
      </div>
    </div>
  )
}

function FeltTab({
  outTemp, setOutTemp, outRH, setOutRH, wind, setWind, solar, setSolar,
  met, setMet, clo, setClo, albedo, setAlbedo,
  hours, geoStatus, lat, lon,
}) {
  const clearSky  = clearSkyMax(lat, lon)
  const Tr        = meanRadiantTemp(outTemp, solar, albedo)
  const feltSun   = comfortAdjust(utci(outTemp, outRH, wind, Tr), met, clo)
  const feltShade = comfortAdjust(utci(outTemp, outRH, wind, outTemp), met, clo)
  const dp        = dewPoint(outTemp, outRH)
  const ah        = absoluteHumidity(outTemp, outRH)
  const actLabel  = nearestPreset(ACT_LEVELS, met).label
  const cloLabel  = nearestPreset(CLO_LEVELS, clo).label

  return (
    <>
      <details className="section-card" open>
        <summary className="section-summary">
          <span className="section-name">
            Aussen
            {geoStatus === 'ok' && <span className="live-dot" title="Live-Wetter">●</span>}
          </span>
          <span className="summary-chips">
            <Chip>{outTemp}{' '}°C</Chip>
            <Chip>{outRH}{' '}%</Chip>
            <Chip>{wind}{' '}km/h</Chip>
            <Chip>{nearestSunLevel(solar, clearSky).icon}</Chip>
          </span>
        </summary>
        <div className="section-body">
          <Slider label="Temperatur"       value={outTemp} onChange={setOutTemp} min={-30} max={50}   step={0.5} unit="°C" />
          <Slider label="Luftfeuchtigkeit" value={outRH}   onChange={setOutRH}   min={0}   max={100}  step={1}   unit="%" />
          <Slider label="Wind"             value={wind}    onChange={setWind}    min={0}   max={120}  step={1}   unit="km/h" />
          <PresetRow levels={WIND_LEVELS} value={wind} onChange={setWind} />
          <SunSelect value={solar} onChange={setSolar} clearSky={clearSky} />
          <div className="slider-group">
            <span className="slider-label">
              Untergrund
              <Info>Heller Boden reflektiert Sonnenlicht zusätzlich auf den Körper. Schnee und Sand erhöhen die Strahlungstemperatur spürbar.</Info>
            </span>
            <PresetRow levels={GROUND_LEVELS} value={albedo} onChange={setAlbedo} />
          </div>
        </div>
      </details>

      <details className="section-card">
        <summary className="section-summary">
          <span className="section-name">
            Persönlich
            <Info>Standard-UTCI nimmt eine gehende Person (~2,3 MET) in angepasster Kleidung an. Diese Stufen sind eine vereinfachte Personalisierung – kein UTCI-Standard.</Info>
          </span>
          <span className="summary-chips">
            <Chip>{actLabel}</Chip>
            <Chip>{cloLabel}</Chip>
          </span>
        </summary>
        <div className="section-body">
          <div className="slider-group">
            <span className="slider-label">Aktivität</span>
            <PresetRow levels={ACT_LEVELS} value={met} onChange={setMet} />
          </div>
          <div className="slider-group">
            <span className="slider-label">Kleidung</span>
            <PresetRow levels={CLO_LEVELS} value={clo} onChange={setClo} />
          </div>
        </div>
      </details>

      <section className="felt-row">
        <FeltCard side="Schatten" icon="🌳" feltTemp={feltShade} airTemp={outTemp} />
        <FeltCard side="Sonne"    icon="☀️" feltTemp={feltSun}   airTemp={outTemp} />
      </section>

      <div className="felt-meta">
        <span>
          Lufttemp. {fmt1(outTemp)}°C
        </span>
        <span>
          Strahlungstemp. {fmt1(Tr)}°C
          <Info>Mittlere Strahlungstemperatur: berücksichtigt Sonneneinstrahlung. Im Schatten ≈ Lufttemperatur.</Info>
        </span>
        <span>
          Taupunkt {fmt1(dp)}°C · {fmt1(ah)} g/m³
          <Info>Taupunkt und absolute Feuchte der Aussenluft.</Info>
        </span>
      </div>

      <ForecastStrip hours={hours} met={met} clo={clo} albedo={albedo} />

      <details className="section-card formula-card">
        <summary className="section-summary">
          <span className="section-name muted">Formeln & Methodik</span>
        </summary>
        <div className="section-body formula-body">
          <p><strong>UTCI</strong> – Bröde et al. (2012). Universeller thermischer Klimaindex: 210-Term-Polynom 6. Grades in Lufttemperatur, Windgeschwindigkeit, mittlerer Strahlungstemperatur und Dampfdruck. Windlimit: 0.5–17 m/s.</p>
          <p><strong>Strahlungstemperatur</strong> – vereinfachte lineare Näherung <code>Tmrt = T + 0.025·I</code> aus der Globalstrahlung I [W/m²].</p>
          <p><strong>Sonnenstufen</strong> – als Anteil des aktuellen Klarhimmel-Maximums (Haurwitz-Modell). Der Sonnenstand wird per NOAA-Algorithmus aus Datum, <em>Uhrzeit</em>, Breiten- und Längengrad berechnet – „Pralle Sonne&ldquo; ist daher im Winter und abends schwächer, nachts null.</p>
          <p><strong>Magnus-Tetens</strong> (Alduchov & Eskridge 1996): <code>e_s = 6.1078·exp(17.625T / (243.04+T))</code>. Taupunkt durch Invertierung. Abs. Feuchte: <code>rho_w = 216.7·e / T_K</code>.</p>
          <p><strong>Persönlich</strong> – Aktivität (MET) &amp; Kleidung (clo) als vereinfachter, begrenzter Aufschlag auf den UTCI. Kein UTCI-Standard: dort sind Gehen (~2,3 MET) und adaptive Kleidung bereits fix angenommen.</p>
          <p className="muted">Strahlungsmodell ohne Albedo. Richtwerte, keine Messwerte.</p>
        </div>
      </details>
    </>
  )
}

// Ventilation tab (indoor + outdoor: temp + humidity only)

function LueftenTab({ inTemp, setInTemp, inRH, setInRH, outTemp, setOutTemp, outRH, setOutRH }) {
  const verdict = ventVerdict(inTemp, inRH, outTemp, outRH)

  return (
    <>
      <details className="section-card">
        <summary className="section-summary">
          <span className="section-name">Innen</span>
          <span className="summary-chips">
            <Chip>{inTemp}{' '}°C</Chip>
            <Chip>{inRH}{' '}%</Chip>
          </span>
        </summary>
        <div className="section-body">
          <Slider label="Temperatur"       value={inTemp} onChange={setInTemp} min={10} max={40}  step={0.5} unit="°C" />
          <Slider label="Luftfeuchtigkeit" value={inRH}   onChange={setInRH}   min={0}  max={100} step={1}   unit="%" />
        </div>
      </details>

      <details className="section-card">
        <summary className="section-summary">
          <span className="section-name">Aussen</span>
          <span className="summary-chips">
            <Chip>{outTemp}{' '}°C</Chip>
            <Chip>{outRH}{' '}%</Chip>
          </span>
        </summary>
        <div className="section-body">
          <Slider label="Temperatur"       value={outTemp} onChange={setOutTemp} min={-30} max={50}  step={0.5} unit="°C" />
          <Slider label="Luftfeuchtigkeit" value={outRH}   onChange={setOutRH}   min={0}   max={100} step={1}   unit="%" />
        </div>
      </details>

      <div className="vent-result">
        <div className="vent-result-head">
          <span className="section-name">Empfehlung</span>
          <span className={`verdict-chip ${verdict.cls}`}>{verdict.short}</span>
        </div>
        <VentTable Tin={inTemp} RHin={inRH} Tout={outTemp} RHout={outRH} />
      </div>

      <p className="vent-note">
        Wind und Sonne fliessen hier bewusst nicht ein: Sie ändern nicht, <em>ob</em> die
        Aussenluft trockener oder kühler ist. Wind beschleunigt zwar den Luftaustausch
        (schnelleres Durchlüften), die Empfehlung selbst hängt aber nur von Temperatur und
        Feuchte beider Seiten ab.
      </p>
    </>
  )
}

// App

export default function App() {
  const [tab, setTab] = usePersistentState('tab', 'felt')

  const [outTemp, setOutTemp] = usePersistentState('outTemp', 28)
  const [outRH,   setOutRH]   = usePersistentState('outRH', 65)
  const [wind,    setWind]    = usePersistentState('wind', 12)
  const [solar,   setSolar]   = usePersistentState('solar', 0)
  const [met,     setMet]     = usePersistentState('met', 2.3)
  const [clo,     setClo]     = usePersistentState('clo', 0.7)
  const [albedo,  setAlbedo]  = usePersistentState('albedo', 0)
  const [inTemp,  setInTemp]  = usePersistentState('inTemp', 24)
  const [inRH,    setInRH]    = usePersistentState('inRH', 55)

  const [geoStatus,   setGeoStatus]   = useState('idle')
  const [geoLocation, setGeoLocation] = usePersistentState('geoLocation', null)
  const [hours,       setHours]       = useState(null)

  // Apply fetched weather to outdoor inputs; prefill indoor temp once on first
  // load so the Lüften tab starts from a sensible baseline (= outdoor temp).
  const prefilledRef = useRef(false)
  function applyWeather(w) {
    setOutTemp(w.temp); setOutRH(w.humidity); setWind(w.wind); setSolar(w.solar)
    if (!prefilledRef.current) {
      setInTemp(w.temp)
      prefilledRef.current = true
    }
  }

  async function loadWeather() {
    if (!navigator.geolocation) { setGeoStatus('denied'); return }
    setGeoStatus('loading')
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        setGeoStatus('locating')
        try {
          const w = await fetchCurrentWeather(coords.latitude, coords.longitude)
          applyWeather(w)
          fetchHourlyForecast(coords.latitude, coords.longitude).then(setHours).catch(() => {})
          let name = null
          try {
            const r = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${coords.latitude}&lon=${coords.longitude}&format=json`,
              { headers: { 'Accept-Language': 'de' } }
            )
            const g = await r.json()
            name = g.address?.city ?? g.address?.town ?? g.address?.village ?? g.address?.county ?? null
          } catch {}
          setGeoLocation({ lat: coords.latitude, lon: coords.longitude, name })
          setGeoStatus('ok')
        } catch { setGeoStatus('error') }
      },
      () => setGeoStatus('denied')
    )
  }

  // Refetch fresh weather for a known location (no geolocation prompt).
  async function refetchFor(la, lo, name) {
    setGeoStatus('locating')
    try {
      const w = await fetchCurrentWeather(la, lo)
      applyWeather(w)
      fetchHourlyForecast(la, lo).then(setHours).catch(() => {})
      setGeoLocation({ lat: la, lon: lo, name })
      setGeoStatus('ok')
    } catch { setGeoStatus('error') }
  }

  async function searchWeather(query) {
    setGeoStatus('searching')
    try {
      const loc = await searchLocation(query)
      if (!loc) { setGeoStatus('notfound'); return }
      const w = await fetchCurrentWeather(loc.lat, loc.lon)
      applyWeather(w)
      fetchHourlyForecast(loc.lat, loc.lon).then(setHours).catch(() => {})
      setGeoLocation(loc)
      setGeoStatus('ok')
    } catch { setGeoStatus('error') }
  }

  // On mount: if we have a saved location, refresh its weather silently
  // (keeping persisted personal/indoor inputs); otherwise ask for GPS.
  useEffect(() => {
    if (geoLocation && geoLocation.lat != null) {
      prefilledRef.current = true // don't overwrite restored indoor temp
      refetchFor(geoLocation.lat, geoLocation.lon, geoLocation.name)
    } else {
      loadWeather()
    }
  }, [])

  return (
    <div className="app">
      <header>
        <h1>Gefühlte Temperatur</h1>
        <GeoBar
          status={geoStatus}
          location={geoLocation}
          onRefresh={loadWeather}
          onSearch={searchWeather}
          onLocate={loadWeather}
        />
      </header>

      <nav className="tabs">
        <button
          className={`tab ${tab === 'felt' ? 'active' : ''}`}
          onClick={() => setTab('felt')}
        >Gefühlt</button>
        <button
          className={`tab ${tab === 'lueften' ? 'active' : ''}`}
          onClick={() => setTab('lueften')}
        >Lüften</button>
      </nav>

      <main>
        {tab === 'felt'
          ? <FeltTab
              outTemp={outTemp} setOutTemp={setOutTemp}
              outRH={outRH}     setOutRH={setOutRH}
              wind={wind}       setWind={setWind}
              solar={solar}     setSolar={setSolar}
              met={met}         setMet={setMet}
              clo={clo}         setClo={setClo}
              albedo={albedo}   setAlbedo={setAlbedo}
              hours={hours}
              geoStatus={geoStatus}
              lat={geoLocation?.lat ?? 50}
              lon={geoLocation?.lon ?? 10}
            />
          : <LueftenTab
              inTemp={inTemp}   setInTemp={setInTemp}
              inRH={inRH}       setInRH={setInRH}
              outTemp={outTemp} setOutTemp={setOutTemp}
              outRH={outRH}     setOutRH={setOutRH}
            />
        }
      </main>
    </div>
  )
}
