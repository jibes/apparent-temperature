import { useState, useEffect, useRef, useMemo } from 'react'
import {
  utci, utciCategory, meanRadiantTemp, clearSkyMax,
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
  return (
    <div className="control">
      <div className="control-header">
        <span className="slider-label">{label}</span>
        <span className="value-badge">{value}{' '}{unit}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        onPointerDown={e => e.currentTarget.setPointerCapture(e.pointerId)}
        style={{ touchAction: 'pan-y' }}
      />
    </div>
  )
}

// Range control with quick presets — used for wind & sun. Consistent layout:
// header (label + value), preset chips, then a fine-tune slider.

function RangeControl({ label, info, badge, presets, value, onChange, min, max, step }) {
  const active = nearestPreset(presets, value)
  return (
    <div className="control">
      <div className="control-header">
        <span className="slider-label">{label}{info && <Info>{info}</Info>}</span>
        <span className="value-badge">{badge}</span>
      </div>
      <div className="preset-row">
        {presets.map(p => (
          <button
            key={p.label}
            type="button"
            className={`preset-btn ${p.val === active.val ? 'active' : ''}`}
            onClick={() => onChange(p.val)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        onPointerDown={e => e.currentTarget.setPointerCapture(e.pointerId)}
        style={{ touchAction: 'pan-y' }}
      />
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

// median / min / max of an array (for the confidence band)
function stats(arr) {
  const a = arr.filter(x => x != null && !Number.isNaN(x)).sort((x, y) => x - y)
  if (!a.length) return null
  const m = Math.floor(a.length / 2)
  return {
    med: a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2,
    lo: a[0],
    hi: a[a.length - 1],
  }
}

const WEEKDAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

// Multi-day felt-temperature chart: shade & sun median lines with a
// model-spread confidence band each. Width is measured for crisp rendering.
function ForecastChart({ hours }) {
  const wrapRef = useRef()
  const svgRef = useRef()
  const [w, setW] = useState(360)
  const [selIdx, setSelIdx] = useState(0)
  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(es => setW(es[0].contentRect.width))
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const data = useMemo(() => {
    if (!hours || !hours.length) return null
    return hours.map(h => {
      const shade = stats(h.samples.map(s => utci(s.t, s.rh, s.w, s.t)))
      const sunS  = h.samples.filter(s => s.s != null)
      const sun   = stats((sunS.length ? sunS : h.samples)
        .map(s => utci(s.t, s.rh, s.w, meanRadiantTemp(s.t, s.s ?? 0))))
      const air   = stats(h.samples.map(s => s.t))
      return { time: h.time, shade, sun, air: air?.med, models: h.samples.length }
    })
  }, [hours])

  if (!data) return null

  const H = 175, padT = 10, padB = 24
  const axisW = 26, padR = 10
  const innerH = H - padT - padB
  const n = data.length

  let yMin = Infinity, yMax = -Infinity
  for (const d of data) for (const s of [d.shade, d.sun]) {
    if (!s) continue
    yMin = Math.min(yMin, s.lo); yMax = Math.max(yMax, s.hi)
  }
  yMin = Math.floor((yMin - 1) / 5) * 5
  yMax = Math.ceil((yMax + 1) / 5) * 5
  if (yMax === yMin) yMax = yMin + 5

  // ~one day per visible plot width on a phone.
  const pxPerHour = Math.max(6, (w - axisW) / 24)
  const chartW = Math.round((n - 1) * pxPerHour + padR + 4)
  const x = i => 4 + i * pxPerHour
  const y = v => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH

  const line = key => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d[key].med).toFixed(1)}`).join(' ')
  const band = key => {
    const up = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d[key].hi).toFixed(1)}`).join(' ')
    let dn = ''
    for (let i = n - 1; i >= 0; i--) dn += `L${x(i).toFixed(1)} ${y(data[i][key].lo).toFixed(1)} `
    return `${up} ${dn}Z`
  }

  const yStep = (yMax - yMin) <= 25 ? 5 : 10
  const yticks = []
  for (let v = yMin; v <= yMax; v += yStep) yticks.push(v)

  const days = []
  data.forEach((d, i) => { if (i === 0 || d.time.getHours() === 0) days.push({ i, date: d.time }) })
  const sixes = []
  data.forEach((d, i) => { if (d.time.getHours() % 6 === 0 && d.time.getHours() !== 0) sixes.push(i) })

  const spanDays = Math.round(n / 24)
  const si  = Math.min(selIdx, n - 1)
  const sel = data[si]
  const r1  = v => Math.round(v)
  const selDate = sel.time
  const dateStr = `${WEEKDAY[selDate.getDay()]} ${selDate.getDate()}.${selDate.getMonth() + 1}.`
  const hhmm = `${String(selDate.getHours()).padStart(2, '0')}:00`

  function pick(e) {
    const rect = svgRef.current.getBoundingClientRect()
    let idx = Math.round((e.clientX - rect.left - 4) / pxPerHour)
    setSelIdx(Math.max(0, Math.min(n - 1, idx)))
  }

  return (
    <div className="forecast" ref={wrapRef}>
      <div className="forecast-head">
        <span className="section-name muted">{spanDays}-Tage-Vorschau</span>
        <span className="forecast-legend">
          <i className="lg sun" /> Sonne <i className="lg shade" /> Schatten
        </span>
      </div>

      <div className="fc-readout">
        <span className="fc-rtime">{dateStr} {hhmm}</span>
        <span className="fc-rval sun">☀️ {r1(sel.sun.med)}° <em>{r1(sel.sun.lo)}–{r1(sel.sun.hi)}</em></span>
        <span className="fc-rval shade">🌳 {r1(sel.shade.med)}° <em>{r1(sel.shade.lo)}–{r1(sel.shade.hi)}</em></span>
        <span className="fc-rmodels">{sel.models}{' '}Mod.</span>
      </div>

      <div className="fc-plot">
        <svg className="fc-axis" width={axisW} height={H} viewBox={`0 0 ${axisW} ${H}`} aria-hidden="true">
          {yticks.map(v => (
            <text key={v} x={axisW - 3} y={y(v) + 3} className="fc-ylab" textAnchor="end">{v}°</text>
          ))}
        </svg>
        <div className="fc-scroll">
          <svg
            ref={svgRef}
            width={chartW} height={H} viewBox={`0 0 ${chartW} ${H}`} role="img"
            onPointerDown={pick}
            onPointerMove={e => { if (e.buttons) pick(e) }}
            style={{ touchAction: 'pan-x' }}
          >
            {yticks.map(v => (
              <line key={v} x1={0} x2={chartW} y1={y(v)} y2={y(v)} className="fc-grid" />
            ))}
            {sixes.map(i => (
              <line key={`s${i}`} x1={x(i)} x2={x(i)} y1={padT} y2={padT + innerH} className="fc-hourgrid" />
            ))}
            {days.map(({ i }) => i > 0 && (
              <line key={i} x1={x(i)} x2={x(i)} y1={padT} y2={padT + innerH} className="fc-daygrid" />
            ))}
            <path d={band('shade')} className="fc-band shade" />
            <path d={band('sun')}   className="fc-band sun" />
            <path d={line('shade')} className="fc-line shade" />
            <path d={line('sun')}   className="fc-line sun" />

            {/* selection cursor */}
            <line x1={x(si)} x2={x(si)} y1={padT} y2={padT + innerH} className="fc-cursor" />
            <circle cx={x(si)} cy={y(sel.sun.med)}   r="3.5" className="fc-dot sun" />
            <circle cx={x(si)} cy={y(sel.shade.med)} r="3.5" className="fc-dot shade" />

            {/* hour labels at 6h marks, weekday/date at midnight */}
            {sixes.map(i => (
              <text key={`h${i}`} x={x(i)} y={H - 7} className="fc-hourlab" textAnchor="middle">
                {String(data[i].time.getHours()).padStart(2, '0')}
              </text>
            ))}
            {days.map(({ i, date }) => (
              <text key={`l${i}`} x={x(i) + 3} y={H - 7} className="fc-xlab">
                {i === 0 ? 'Heute' : WEEKDAY[date.getDay()]}
              </text>
            ))}
          </svg>
        </div>
      </div>
      <p className="forecast-note">Tippen wählt einen Zeitpunkt. Schattierung = Spanne der Wettermodelle (Unsicherheit).</p>
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
  outTemp, setOutTemp, outRH, setOutRH, wind, setWind,
  hours, wxMeta, geoStatus, lat, lon,
}) {
  const clearSky  = clearSkyMax(lat, lon)   // full-sun ceiling for now & place
  const TrSun     = meanRadiantTemp(outTemp, clearSky)
  const feltShade = utci(outTemp, outRH, wind, outTemp)
  const feltSun   = utci(outTemp, outRH, wind, TrSun)
  const dp        = dewPoint(outTemp, outRH)
  const ah        = absoluteHumidity(outTemp, outRH)

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
          </span>
        </summary>
        <div className="section-body">
          <Slider label="Temperatur"       value={outTemp} onChange={setOutTemp} min={-30} max={50}  step={0.5} unit="°C" />
          <Slider label="Luftfeuchtigkeit" value={outRH}   onChange={setOutRH}   min={0}   max={100} step={1}   unit="%" />
          <RangeControl
            label="Wind" badge={`${wind} km/h`} presets={WIND_LEVELS}
            value={wind} onChange={setWind} min={0} max={120} step={1}
          />
        </div>
      </details>

      <section className="felt-row">
        <FeltCard side="Schatten" icon="🌳" feltTemp={feltShade} airTemp={outTemp} />
        <FeltCard side="Sonne"    icon="☀️" feltTemp={feltSun}   airTemp={outTemp} />
      </section>

      <p className="felt-range-note">
        Spanne zwischen vollem Schatten und voller Sonne. Wie warm es sich wirklich anfühlt,
        liegt je nach Bewölkung und Standort dazwischen.
      </p>

      <div className="felt-meta">
        <span>Lufttemp. {fmt1(outTemp)}°C</span>
        <span>
          Strahlungstemp. Sonne {fmt1(TrSun)}°C
          <Info>Mittlere Strahlungstemperatur bei klarem Himmel (Sonnenstand jetzt). Im Schatten ≈ Lufttemperatur.</Info>
        </span>
        <span>
          Taupunkt {fmt1(dp)}°C · {fmt1(ah)} g/m³
          <Info>Taupunkt und absolute Feuchte der Aussenluft.</Info>
        </span>
        {wxMeta && wxMeta.sources > 1 && (
          <span>
            {wxMeta.sources} Modelle · ±{fmt1(wxMeta.spread.temp / 2)}°C
            <Info>Konsens aus {wxMeta.sources} Wettermodellen (Median je Größe). Die Spanne zeigt die Unsicherheit – je grösser, desto unsicherer die Vorhersage.</Info>
          </span>
        )}
      </div>

      <ForecastChart hours={hours} />

      <details className="section-card formula-card">
        <summary className="section-summary">
          <span className="section-name muted">Formeln & Methodik</span>
        </summary>
        <div className="section-body formula-body">
          <p><strong>UTCI</strong> – Bröde et al. (2012). Universeller thermischer Klimaindex: 210-Term-Polynom 6. Grades in Lufttemperatur, Windgeschwindigkeit, mittlerer Strahlungstemperatur und Dampfdruck. Windlimit: 0.5–17 m/s.</p>
          <p><strong>Schatten vs. Sonne</strong> – die beiden Karten zeigen die Spanne: Schatten ohne Strahlung (Tmrt = Luft), Sonne bei klarem Himmel. Das Klarhimmel-Maximum kommt aus dem Sonnenstand (NOAA-Algorithmus: Datum, Uhrzeit, Breiten- &amp; Längengrad) und dem Haurwitz-Modell – im Winter und abends schwächer, nachts null.</p>
          <p><strong>Strahlungstemperatur</strong> – vereinfachte lineare Näherung <code>Tmrt = T + 0.025·I</code> aus der Globalstrahlung I [W/m²].</p>
          <p><strong>Magnus-Tetens</strong> (Alduchov & Eskridge 1996): <code>e_s = 6.1078·exp(17.625T / (243.04+T))</code>. Taupunkt durch Invertierung. Abs. Feuchte: <code>rho_w = 216.7·e / T_K</code>.</p>
          <p className="muted">UTCI nimmt eine gehende Person in angepasster Kleidung an. Richtwerte, keine Messwerte.</p>
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
  const [inTemp,  setInTemp]  = usePersistentState('inTemp', 24)
  const [inRH,    setInRH]    = usePersistentState('inRH', 55)

  const [geoStatus,   setGeoStatus]   = useState('idle')
  const [geoLocation, setGeoLocation] = usePersistentState('geoLocation', null)
  const [hours,       setHours]       = useState(null)
  const [wxMeta,      setWxMeta]      = useState(null) // { sources, spread }

  // Apply fetched weather to outdoor inputs; prefill indoor temp once on first
  // load so the Lüften tab starts from a sensible baseline (= outdoor temp).
  const prefilledRef = useRef(false)
  function applyWeather(w) {
    setOutTemp(w.temp); setOutRH(w.humidity); setWind(w.wind)
    if (w.sources) setWxMeta({ sources: w.sources, spread: w.spread })
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
              hours={hours}
              wxMeta={geoStatus === 'ok' ? wxMeta : null}
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
