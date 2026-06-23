import { useState } from 'react'
import { calcApparentTemp, absoluteHumidity } from './formulas.js'
import './App.css'

const FORMULA_LABELS = {
  hitzeindex: 'Hitzeindex (Rothfusz/Steadman)',
  windchill: 'Windchill (Environment Canada, 2001)',
  keine: 'Lufttemperatur (kein Korrektureffekt)',
}

function Slider({ label, value, onChange, min, max, step, unit, hint }) {
  return (
    <div className="slider-group">
      <div className="slider-header">
        <label>{label}</label>
        <span className="value-badge">
          {value} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="slider-range">
        <span>{min} {unit}</span>
        <span>{max} {unit}</span>
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}

function TempDisplay({ value, formula }) {
  const rounded = Math.round(value * 10) / 10
  const diff = Math.round((value - window.__baseTemp) * 10) / 10

  let colorClass = 'neutral'
  if (rounded >= 35) colorClass = 'very-hot'
  else if (rounded >= 27) colorClass = 'hot'
  else if (rounded >= 15) colorClass = 'warm'
  else if (rounded >= 5) colorClass = 'cool'
  else if (rounded >= -10) colorClass = 'cold'
  else colorClass = 'very-cold'

  return (
    <div className={`temp-display ${colorClass}`}>
      <div className="temp-value">{rounded} °C</div>
      <div className="temp-formula">{FORMULA_LABELS[formula]}</div>
      {formula !== 'keine' && (
        <div className="temp-diff">
          {diff >= 0 ? '+' : ''}{diff} °C gegenüber Lufttemperatur
        </div>
      )}
    </div>
  )
}

function VentilationCard({ insideTemp, insideHumidity, outsideTemp, outsideHumidity }) {
  const absIn = absoluteHumidity(insideTemp, insideHumidity)
  const absOut = absoluteHumidity(outsideTemp, outsideHumidity)
  const diff = absOut - absIn

  let advice, adviceClass
  if (diff < -1) {
    advice = `Lüften empfohlen: Draussen ist die Luft trockener (${absOut.toFixed(1)} g/m³ vs. ${absIn.toFixed(1)} g/m³ innen). Lüften reduziert die Feuchtigkeit im Raum.`
    adviceClass = 'good'
  } else if (diff > 1) {
    advice = `Nicht lüften: Draussen ist die Luft feuchter (${absOut.toFixed(1)} g/m³ vs. ${absIn.toFixed(1)} g/m³ innen). Lüften würde Feuchtigkeit hereintragen.`
    adviceClass = 'bad'
  } else {
    advice = `Kein wesentlicher Unterschied (innen ${absIn.toFixed(1)} g/m³, aussen ${absOut.toFixed(1)} g/m³). Lüften hat keinen Effekt auf die Raumfeuchte.`
    adviceClass = 'neutral'
  }

  return (
    <div className={`card ventilation-card ${adviceClass}`}>
      <h3>Lüftungs-Check (absolute Feuchte)</h3>
      <div className="abs-humidity-grid">
        <div>
          <span className="label">Innen</span>
          <span className="abs-value">{absIn.toFixed(1)} g/m³</span>
          <span className="small">{insideTemp}°C / {insideHumidity}% rF</span>
        </div>
        <div className="arrow">↔</div>
        <div>
          <span className="label">Aussen</span>
          <span className="abs-value">{absOut.toFixed(1)} g/m³</span>
          <span className="small">{outsideTemp}°C / {outsideHumidity}% rF</span>
        </div>
      </div>
      <p className="advice">{advice}</p>
    </div>
  )
}

export default function App() {
  const [temp, setTemp] = useState(20)
  const [humidity, setHumidity] = useState(60)
  const [wind, setWind] = useState(10)
  const [showVentilation, setShowVentilation] = useState(false)
  const [insideTemp, setInsideTemp] = useState(22)
  const [insideHumidity, setInsideHumidity] = useState(55)

  window.__baseTemp = temp

  const { apparentTemp, formula } = calcApparentTemp(temp, humidity, wind)

  return (
    <div className="app">
      <header>
        <h1>Gefühlte Temperatur</h1>
        <p className="subtitle">Hitzeindex · Windchill · Lüftungscheck</p>
      </header>

      <main>
        <div className="inputs card">
          <h2>Eingabe (Aussen)</h2>
          <Slider
            label="Lufttemperatur"
            value={temp}
            onChange={setTemp}
            min={-30}
            max={50}
            step={0.5}
            unit="°C"
          />
          <Slider
            label="Relative Luftfeuchtigkeit"
            value={humidity}
            onChange={setHumidity}
            min={0}
            max={100}
            step={1}
            unit="%"
            hint={temp < 27 && temp > 10 ? 'Hitzeindex greift ab 27 °C – Feuchte hat hier keinen Effekt.' : undefined}
          />
          <Slider
            label="Windgeschwindigkeit"
            value={wind}
            onChange={setWind}
            min={0}
            max={120}
            step={1}
            unit="km/h"
            hint={temp > 10 ? 'Windchill greift unter 10 °C.' : wind < 5 ? 'Windchill greift ab 5 km/h.' : undefined}
          />
        </div>

        <div className="result card">
          <h2>Gefühlte Temperatur</h2>
          <TempDisplay value={apparentTemp} formula={formula} />
          <p className="disclaimer">
            Ohne Sonnenstrahlung und Körperaktivität. Strahlungswärme kann
            +8–15 °C hinzufügen.
          </p>
        </div>

        <div className="ventilation-section">
          <button
            className="toggle-btn"
            onClick={() => setShowVentilation(!showVentilation)}
          >
            {showVentilation ? '▲ Lüftungscheck ausblenden' : '▼ Lüftungscheck einblenden'}
          </button>

          {showVentilation && (
            <div className="ventilation-inputs card">
              <h2>Innenraum-Werte</h2>
              <Slider
                label="Innentemperatur"
                value={insideTemp}
                onChange={setInsideTemp}
                min={10}
                max={35}
                step={0.5}
                unit="°C"
              />
              <Slider
                label="Innen rel. Luftfeuchtigkeit"
                value={insideHumidity}
                onChange={setInsideHumidity}
                min={0}
                max={100}
                step={1}
                unit="%"
              />
              <VentilationCard
                insideTemp={insideTemp}
                insideHumidity={insideHumidity}
                outsideTemp={temp}
                outsideHumidity={humidity}
              />
            </div>
          )}
        </div>

        <details className="formula-details card">
          <summary>Formeln & Methodik</summary>
          <div className="formula-content">
            <h4>Hitzeindex (Rothfusz/Steadman)</h4>
            <p>
              Greift ab ~27 °C. Polynomformel mit 9 Termen kombiniert Temperatur
              und rel. Luftfeuchtigkeit, da hohe Feuchte das Schwitzen hemmt.
            </p>
            <h4>Windchill (Environment Canada, 2001)</h4>
            <p>
              Greift unter 10 °C und ab 5 km/h. Basiert auf
              Windgeschwindigkeit mit einem 0.16-Exponenten:{' '}
              <code>13.12 + 0.6215·T − 11.37·v^0.16 + 0.3965·T·v^0.16</code>
            </p>
            <h4>Absolute Feuchte (Magnus-Formel)</h4>
            <p>
              Sättigungsdampfdruck × rel. Feuchte ergibt den absoluten
              Wassergehalt der Luft (g/m³). Relevanter als rel. Feuchte fürs
              Lüften, da rel. Feuchte temperaturabhängig ist.
            </p>
          </div>
        </details>
      </main>
    </div>
  )
}
