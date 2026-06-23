import { useState } from 'react'
import {
  outdoorApparentTemp,
  indoorApparentTemp,
  ventilationAssessment,
  dewPoint,
  absoluteHumidity,
} from './formulas.js'
import './App.css'

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt1(n) {
  return (Math.round(n * 10) / 10).toFixed(1)
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

// ─── components ─────────────────────────────────────────────────────────────

function Slider({ label, value, onChange, min, max, step, unit, note }) {
  return (
    <div className="slider-group">
      <div className="slider-header">
        <span className="slider-label">{label}</span>
        <span className="value-badge">{value}&thinsp;{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
      <div className="slider-ends">
        <span>{min}&thinsp;{unit}</span>
        <span>{max}&thinsp;{unit}</span>
      </div>
      {note && <p className="note">{note}</p>}
    </div>
  )
}

const FORMULA_LABEL = {
  hitzeindex: 'Hitzeindex (Rothfusz/Steadman)',
  windchill:  'Windchill (Environment Canada 2001)',
  keine:      'Lufttemperatur – kein Korrektureffekt',
}

function ApparentTempCard({ label, airTemp, apparentTemp, formula, dp, ah }) {
  const diff = apparentTemp - airTemp
  const cls = colorClass(apparentTemp)
  return (
    <div className={`apparent-card ${cls}`}>
      <div className="apparent-label">{label}</div>
      <div className="apparent-value">{fmt1(apparentTemp)}&thinsp;°C</div>
      <div className="apparent-formula">{FORMULA_LABEL[formula]}</div>
      {formula !== 'keine' && (
        <div className="apparent-diff">
          {diff >= 0 ? '+' : ''}{fmt1(diff)}&thinsp;°C vs. Lufttemperatur
        </div>
      )}
      <div className="apparent-meta">
        <span>Taupunkt&thinsp;{fmt1(dp)}&thinsp;°C</span>
        <span>abs.&thinsp;{fmt1(ah)}&thinsp;g/m³</span>
      </div>
    </div>
  )
}

function DeltaRow({ label, inVal, outVal, unit, lowerIsBetter }) {
  const delta = outVal - inVal
  const better = lowerIsBetter ? delta < -0.5 : delta > 0.5
  const worse  = lowerIsBetter ? delta > 0.5  : delta < -0.5
  const sign   = delta >= 0 ? '+' : ''
  return (
    <div className="delta-row">
      <span className="delta-metric">{label}</span>
      <span className="delta-in">{fmt1(inVal)}&thinsp;{unit}</span>
      <span className="delta-arrow">→</span>
      <span className="delta-out">{fmt1(outVal)}&thinsp;{unit}</span>
      <span className={`delta-badge ${better ? 'good' : worse ? 'bad' : 'neutral'}`}>
        {sign}{fmt1(delta)}&thinsp;{unit}
      </span>
    </div>
  )
}

function VentilationCard({ Tin, RHin, Tout, RHout }) {
  const a = ventilationAssessment(Tin, RHin, Tout, RHout)
  const ahIn = absoluteHumidity(Tin, RHin)
  const ahOut = absoluteHumidity(Tout, RHout)
  const dpIn = dewPoint(Tin, RHin)
  const dpOut = dewPoint(Tout, RHout)

  const dryBenefit  = a.deltaAH < -0.3
  const dryConcern  = a.deltaAH >  0.3
  const coolBenefit = a.deltaH  < -0.5
  const warmConcern = a.deltaH  >  0.5

  let rec, recClass
  if (a.condensationRisk) {
    rec = `Nicht lüften – Kondensationsgefahr: Der Taupunkt der Aussenluft (${fmt1(dpOut)}°C) liegt über der Innentemperatur (${fmt1(Tin)}°C). Feuchte würde an kühlen Oberflächen kondensieren.`
    recClass = 'bad'
  } else if (dryBenefit && coolBenefit) {
    rec = `Lüften empfohlen – Aussenluft ist trockener und enthält weniger Gesamtwärme. Beides verbessert das Raumklima.`
    recClass = 'good'
  } else if (dryBenefit && !warmConcern) {
    rec = `Lüften sinnvoll für Feuchte – Aussenluft ist trockener (${fmt1(ahOut)} vs. ${fmt1(ahIn)} g/m³). Thermisch kein wesentlicher Unterschied.`
    recClass = 'good'
  } else if (dryBenefit && warmConcern) {
    rec = `Abwägen – Aussenluft ist trockener, aber bringt mehr Wärme (Δh = +${fmt1(a.deltaH)} kJ/kg). Sinnvoll für Entfeuchtung, nicht zum Kühlen.`
    recClass = 'warn'
  } else if (coolBenefit && dryConcern) {
    rec = `Abwägen – Aussenluft kühlt (Δh = ${fmt1(a.deltaH)} kJ/kg), ist aber feuchter (${fmt1(ahOut)} vs. ${fmt1(ahIn)} g/m³). Nur kurz lüften.`
    recClass = 'warn'
  } else if (!dryConcern && !warmConcern) {
    rec = `Kein wesentlicher Unterschied in Feuchte und Wärme. Lüften hat kaum Effekt auf Raumklima (sinnvoll für CO₂ / Luftqualität).`
    recClass = 'neutral'
  } else {
    rec = `Nicht lüften für Kühlung/Entfeuchtung – Aussenluft ist feuchter (${fmt1(ahOut)} vs. ${fmt1(ahIn)} g/m³) und wärmer (Δh = +${fmt1(a.deltaH)} kJ/kg).`
    recClass = 'bad'
  }

  return (
    <div className="ventilation-card">
      <div className="delta-table">
        <div className="delta-header">
          <span className="delta-metric"></span>
          <span className="delta-in">Innen</span>
          <span className="delta-arrow"></span>
          <span className="delta-out">Aussen</span>
          <span className="delta-badge">Δ</span>
        </div>
        <DeltaRow
          label="Temperatur"
          inVal={Tin} outVal={Tout} unit="°C"
          lowerIsBetter={true}
        />
        <DeltaRow
          label="Taupunkt"
          inVal={dpIn} outVal={dpOut} unit="°C"
          lowerIsBetter={true}
        />
        <DeltaRow
          label="Abs. Feuchte"
          inVal={ahIn} outVal={ahOut} unit="g/m³"
          lowerIsBetter={true}
        />
        <DeltaRow
          label="Enthalpie"
          inVal={a.hIn} outVal={a.hOut} unit="kJ/kg"
          lowerIsBetter={true}
        />
      </div>
      <div className={`rec-box ${recClass}`}>{rec}</div>
      {a.condensationRisk && (
        <p className="cond-note">
          Taupunkt aussen {fmt1(dpOut)}°C &gt; Innentemperatur {fmt1(Tin)}°C
        </p>
      )}
    </div>
  )
}

// ─── main app ───────────────────────────────────────────────────────────────

export default function App() {
  const [outTemp,  setOutTemp]  = useState(28)
  const [outRH,    setOutRH]    = useState(65)
  const [wind,     setWind]     = useState(12)
  const [inTemp,   setInTemp]   = useState(24)
  const [inRH,     setInRH]     = useState(55)

  const out = outdoorApparentTemp(outTemp, outRH, wind)
  const inn = indoorApparentTemp(inTemp, inRH)
  const dpOut = dewPoint(outTemp, outRH)
  const dpIn  = dewPoint(inTemp, inRH)
  const ahOut = absoluteHumidity(outTemp, outRH)
  const ahIn  = absoluteHumidity(inTemp, inRH)

  return (
    <div className="app">
      <header>
        <h1>Gefühlte Temperatur</h1>
        <p className="subtitle">Hitzeindex · Windchill · Lüftungscheck</p>
      </header>

      <main>
        {/* ── Outside ── */}
        <section className="section-pair">
          <div className="panel card">
            <h2>Aussen</h2>
            <Slider label="Temperatur" value={outTemp} onChange={setOutTemp}
              min={-30} max={50} step={0.5} unit="°C" />
            <Slider label="Rel. Luftfeuchtigkeit" value={outRH} onChange={setOutRH}
              min={0} max={100} step={1} unit="%"
              note={outTemp < 27 && outTemp > 10
                ? 'Hitzeindex greift erst ab 27 °C.'
                : undefined} />
            <Slider label="Windgeschwindigkeit" value={wind} onChange={setWind}
              min={0} max={120} step={1} unit="km/h"
              note={outTemp > 10
                ? 'Windchill greift unter 10 °C.'
                : wind < 4.8 ? 'Windchill greift ab 4.8 km/h.'
                : undefined} />
          </div>

          {/* ── Inside ── */}
          <div className="panel card">
            <h2>Innen</h2>
            <Slider label="Temperatur" value={inTemp} onChange={setInTemp}
              min={10} max={40} step={0.5} unit="°C" />
            <Slider label="Rel. Luftfeuchtigkeit" value={inRH} onChange={setInRH}
              min={0} max={100} step={1} unit="%" />
            <div className="indoor-spacer" />
          </div>
        </section>

        {/* ── Apparent temps ── */}
        <section className="section-pair results">
          <ApparentTempCard
            label="Gefühlte Temp. Aussen"
            airTemp={outTemp}
            apparentTemp={out.value}
            formula={out.formula}
            dp={dpOut}
            ah={ahOut}
          />
          <ApparentTempCard
            label="Gefühlte Temp. Innen"
            airTemp={inTemp}
            apparentTemp={inn.value}
            formula={inn.formula}
            dp={dpIn}
            ah={ahIn}
          />
        </section>

        {/* ── Ventilation ── */}
        <section className="card">
          <h2>Lüftungscheck</h2>
          <VentilationCard Tin={inTemp} RHin={inRH} Tout={outTemp} RHout={outRH} />
        </section>

        {/* ── Formula details ── */}
        <details className="card formula-details">
          <summary>Formeln & Methodik</summary>
          <div className="formula-content">
            <h4>Hitzeindex (Rothfusz/Steadman)</h4>
            <p>
              Zweistufig nach NWS: Erst einfache Steadman-Formel – greift die
              berechnete mittlere Wärmebelastung über 80 °F, wird das
              Rothfusz-Polynom (9 Terme) angewendet. Korrigiert für sehr niedrige
              (&lt;13 %) und sehr hohe (&gt;85 %) Luftfeuchte. Kein
              Hitzeindex-Effekt bei tiefer Feuchte, auch wenn T ≥ 27 °C.
            </p>
            <h4>Windchill (Environment Canada / NWS, 2001)</h4>
            <p>
              <code>13.12 + 0.6215·T − 11.37·v^0.16 + 0.3965·T·v^0.16</code>
              <br />Kalibriert für Gesicht auf 1,5 m Höhe, Gehgeschwindigkeit 1,34 m/s.
              Gültig für T ≤ 10 °C und v ≥ 4,8 km/h.
            </p>
            <h4>Taupunkt & absolute Feuchte (Magnus-Tetens)</h4>
            <p>
              Sättigungsdampfdruck: <code>e_s = 6,1078·exp(17,625·T/(243,04+T))</code>
              (Alduchov & Eskridge 1996). Taupunkt durch Invertierung. Absolute
              Feuchte aus dem idealen Gasgesetz: <code>ρ_w = 216,7·e/(T_K)</code>.
            </p>
            <h4>Spezifische Enthalpie der Feuchtluft (Psychrometrie)</h4>
            <p>
              <code>h = 1,006·T + W·(2501 + 1,86·T)</code> [kJ/kg Trockenluft]
              <br />W = Mischungsverhältnis (kg Wasser/kg Trockenluft). Kombiniert
              fühlbare Wärme und latente Wärme. Relevant fürs Lüften: Wenn
              h_aussen &lt; h_innen, bringt Aussenluft weniger Gesamtwärme –
              unabhängig davon, ob Abkühlung oder Entfeuchtung dominiert.
            </p>
            <h4>Kondensationsrisiko</h4>
            <p>
              Wenn Taupunkt der Aussenluft über der Innentemperatur liegt, kann
              Feuchte an kühlen Oberflächen (Wände, Fensterrahmen) kondensieren
              – Schimmelgefahr.
            </p>
            <p className="disclaimer-small">
              Ohne direkte Sonnenstrahlung (kann +8–15 °C hinzufügen),
              Körperaktivität und Bekleidung (CLO-Wert). Für Innenräume kein
              Windchill, da vernachlässigbarer Luftzug.
            </p>
          </div>
        </details>
      </main>
    </div>
  )
}
