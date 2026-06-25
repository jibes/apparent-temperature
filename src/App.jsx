import { useState, useEffect, useRef } from 'react'
import {
  utci, utciCategory,
  indoorApparentTemp,
  ventilationAssessment,
  dewPoint,
  absoluteHumidity,
} from './formulas.js'
import { fetchCurrentWeather } from './weather.js'
import './App.css'

// helpers

function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1) }

function colorClass(t) {
  if (t >= 40) return 'very-hot'
  if (t >= 32) return 'hot'
  if (t >= 26) return 'warm'
  if (t >= 16) return 'comfortable'
  if (t >= 8)  return 'cool'
  if (t >= -5) return 'cold'
  return 'very-cold'
}

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

function Slider({ label, value, onChange, min, max, step, unit }) {
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
        <span>{max}{' '}{unit}</span>
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

// Felt temperature cards

function ApparentCard({ side, airTemp, feltTemp, label, dp, ah }) {
  const diff = feltTemp - airTemp
  const cls  = colorClass(feltTemp)
  return (
    <div className={`ap-card ${cls}`}>
      <div className="ap-side">{side}</div>
      <div className="ap-val">{fmt1(feltTemp)}{' '}°C</div>
      <div className="ap-formula">
        {label}
        {diff !== 0 && (
          <span className="ap-diff"> ({diff >= 0 ? '+' : ''}{fmt1(diff)})</span>
        )}
      </div>
      <div className="ap-meta">
        <span>
          Tp{' '}{fmt1(dp)}°C
          <Info>Taupunkt: Temperatur, bei der der Wasserdampf der Luft zu kondensieren beginnt.</Info>
        </span>
        <span>
          {fmt1(ah)}{' '}g/m³
          <Info>Absolute Feuchte: Tatsächlicher Wassergehalt der Luft -- temperaturunabhängig.</Info>
        </span>
      </div>
    </div>
  )
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

// Geo status

function GeoBar({ status, location, onRefresh }) {
  if (status === 'idle') return null
  return (
    <div className="geo-bar">
      {status === 'loading' || status === 'locating'
        ? <span className="geo-msg loading">Standort wird ermittelt…</span>
        : status === 'ok' && location
          ? <span className="geo-ok">
              📍{' '}{location.name ?? `${location.lat.toFixed(2)}, ${location.lon.toFixed(2)}`}
            </span>
          : <span className="geo-msg warn">Standort nicht verfügbar</span>
      }
      {(status === 'ok' || status === 'denied' || status === 'error') && (
        <button className="geo-refresh" onClick={onRefresh} title="Neu laden">&#8635;</button>
      )}
    </div>
  )
}

// App

export default function App() {
  const [outTemp, setOutTemp] = useState(28)
  const [outRH,   setOutRH]   = useState(65)
  const [wind,    setWind]    = useState(12)
  const [inTemp,  setInTemp]  = useState(24)
  const [inRH,    setInRH]    = useState(55)

  const [geoStatus,   setGeoStatus]   = useState('idle')
  const [geoLocation, setGeoLocation] = useState(null)

  async function loadWeather() {
    if (!navigator.geolocation) { setGeoStatus('denied'); return }
    setGeoStatus('loading')
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        setGeoStatus('locating')
        try {
          const w = await fetchCurrentWeather(coords.latitude, coords.longitude)
          setOutTemp(w.temp); setOutRH(w.humidity); setWind(w.wind)
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

  useEffect(() => { loadWeather() }, [])

  const utciOut    = utci(outTemp, outRH, wind)
  const utciCat    = utciCategory(utciOut)
  const inResult   = indoorApparentTemp(inTemp, inRH)
  const dpOut      = dewPoint(outTemp, outRH)
  const dpIn       = dewPoint(inTemp, inRH)
  const ahOut      = absoluteHumidity(outTemp, outRH)
  const ahIn       = absoluteHumidity(inTemp, inRH)
  const verdict    = ventVerdict(inTemp, inRH, outTemp, outRH)

  const FORMULA_SHORT = {
    hitzeindex: 'Hitzeindex',
    windchill:  'Windchill',
    keine:      '= Lufttemp.',
  }

  return (
    <div className="app">
      <header>
        <h1>Gefühlte Temperatur</h1>
        <GeoBar status={geoStatus} location={geoLocation} onRefresh={loadWeather} />
      </header>

      <main>
        {/* Aussen collapsible */}
        <details className="section-card">
          <summary className="section-summary">
            <span className="section-name">
              Aussen
              {geoStatus === 'ok' && <span className="live-dot" title="Live-Wetter">●</span>}
            </span>
            <span className="summary-chips">
              <Chip>{outTemp}{' '}°C</Chip>
              <Chip>{outRH}{' '}%</Chip>
              <Chip>{wind}{' '}km/h</Chip>
            </span>
          </summary>
          <div className="section-body">
            <Slider label="Temperatur"       value={outTemp} onChange={setOutTemp} min={-30} max={50}  step={0.5} unit="°C" />
            <Slider label="Luftfeuchtigkeit" value={outRH}   onChange={setOutRH}   min={0}   max={100} step={1}   unit="%" />
            <Slider label="Wind"             value={wind}    onChange={setWind}    min={0}   max={120} step={1}   unit="km/h" />
          </div>
        </details>

        {/* Innen collapsible */}
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

        {/* Felt temps */}
        <section className="ap-row">
          <ApparentCard
            side="Aussen"
            airTemp={outTemp}
            feltTemp={utciOut}
            label={`UTCI ${utciCat.label}`}
            dp={dpOut}
            ah={ahOut}
          />
          <ApparentCard
            side="Innen"
            airTemp={inTemp}
            feltTemp={inResult.value}
            label={FORMULA_SHORT[inResult.formula]}
            dp={dpIn}
            ah={ahIn}
          />
        </section>

        {/* Lüften collapsible */}
        <details className="section-card">
          <summary className="section-summary">
            <span className="section-name">Lüften</span>
            <span className={`verdict-chip ${verdict.cls}`}>{verdict.short}</span>
          </summary>
          <div className="section-body">
            <VentTable Tin={inTemp} RHin={inRH} Tout={outTemp} RHout={outRH} />
          </div>
        </details>

        {/* Formulas */}
        <details className="section-card formula-card">
          <summary className="section-summary">
            <span className="section-name muted">Formeln & Methodik</span>
          </summary>
          <div className="section-body formula-body">
            <p><strong>UTCI</strong> – Bröde et al. (2012). Universeller thermischer Klimaindex: 210-Term-Polynom 6. Grades in Lufttemperatur, Windgeschwindigkeit, mittlerer Strahlungstemperatur und Dampfdruck. Windlimit: 0.5–17 m/s. Ohne Sonnenstrahlung wird d_Tmrt = 0 angenommen.</p>
            <p><strong>Hitzeindex</strong> – NWS/Rothfusz (1990). Zweistufig: einfache Steadman-Formel zuerst; Polynom (9 Terme) nur wenn mittlere Wärmebelastung ≥ 80°F. Korrekturen für RH &lt;13 % und &gt;85 %.</p>
            <p><strong>Windchill</strong> – Environment Canada / NWS (2001). <code>13.12 + 0.6215T − 11.37v^0.16 + 0.3965T·v^0.16</code>. Gültig T ≤ 10°C, v ≥ 4.8 km/h.</p>
            <p><strong>Magnus-Tetens</strong> (Alduchov & Eskridge 1996): <code>e_s = 6.1078·exp(17.625T / (243.04+T))</code>. Taupunkt durch Invertierung. Abs. Feuchte: <code>rho_w = 216.7·e / T_K</code>.</p>
            <p><strong>Enthalpie</strong> (Psychrometrie): <code>h = 1.006T + W·(2501 + 1.86T)</code> kJ/kg. W = Mischungsverhältnis. Kombiniert fühlbare + latente Wärme.</p>
            <p className="muted">Ohne Sonnenstrahlung (+8–15°C möglich), Körperaktivität und CLO-Wert.</p>
          </div>
        </details>
      </main>
    </div>
  )
}
