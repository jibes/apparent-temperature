import { useState, useEffect, useRef, useMemo } from 'react'
import {
  utci, utciCategory, meanRadiantTemp, clearSkyMax, clearSkyGHI, solarElevation,
  ventilationAssessment, indoorApparentTemp,
  dewPoint,
  absoluteHumidity, specificEnthalpy,
} from './formulas.js'
import { fetchCurrentWeather, fetchHourlyForecast, searchLocation, MODEL_INFO } from './weather.js'
import './App.css'

// helpers

function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1) }

// Relative "updated X ago" label.
function agoLabel(ms) {
  if (!ms) return null
  const min = Math.floor(Math.max(0, Date.now() - ms) / 60000)
  if (min < 1)  return 'gerade aktualisiert'
  if (min < 60) return `aktualisiert vor ${min} min`
  const hrs = Math.floor(min / 60)
  return `aktualisiert vor ${hrs} Std`
}

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

// Text-only temperature colour (no card background) for the headline value.
const TEMP_COLOR = {
  'very-hot': '#fca5a5', hot: '#fdba74', warm: '#86efac', comfortable: '#93c5fd',
  cool: '#a5b4fc', cold: '#7dd3fc', 'very-cold': '#bae6fd',
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

// Clear-sky irradiance [W/m²] at the instant `h.ts` — matches the instantaneous
// shortwave_radiation_instant used for "real" sun, so both (and the instant
// temp/RH/wind) describe the same moment T. No interval/instant mismatch.
function clearSkyAt(h, ctx) {
  return clearSkyGHI(solarElevation(ctx.lat, ctx.lon, new Date(h.ts)))
}

// Selectable forecast metrics. `dual` shows sun+shade felt temp; `at(h,ctx)`
// returns the per-hour value array (one per model sample, or a single value for
// deterministic quantities); `val` is shorthand for a simple per-sample value.
// `dp` = decimals in the readout.
// A derivation graph, not a flat list. The user toggles BASE inputs; DERIVED
// outputs appear automatically once their input bases are active. No mediator
// lines, no hardcoded shade/sun pair — "Gefühlt" is one line that composes
// whatever bases are on. `val(s)` reads a model sample; `hourVal(h,ctx)` is a
// deterministic per-hour value (no ensemble spread). `dp` = readout decimals.
const BASES = [
  { key: 'temp',   label: 'Lufttemp.',    unit: '°C',   color: '#fb923c', dp: 0, val: s => s.t },
  { key: 'ah',     label: 'Abs. Feuchte', unit: 'g/m³', color: '#22d3ee', dp: 1, val: s => absoluteHumidity(s.t, s.rh) },
  { key: 'wind',   label: 'Wind',         unit: 'km/h', color: '#94a3b8', dp: 0, val: s => s.w },
  { key: 'csun',   label: 'Sonne (klar)', unit: 'W/m²', color: '#fbbf24', dp: 0, hourVal: clearSkyAt },
  { key: 'clouds', label: 'Bewölkung',    unit: '%',    color: '#cbd5e1', dp: 0, val: s => s.c },
]

// `deps` = base keys that must all be active for the derived line to appear.
// Gefühlt needs only temp: humidity is intrinsic to the air (always folded into
// UTCI from the forecast), while Wind and Sonne are optional exposure factors
// that refine it when active. Derived colors are tints of their base metric so
// related lines read as one family instead of adding new hues.
const DERIVED = [
  { key: 'rh',     label: 'rel. Feuchte',   unit: '%',    color: '#67e8f9', dp: 0, deps: ['temp', 'ah'], val: s => s.rh },
  { key: 'effsun', label: 'Sonne effektiv', unit: 'W/m²', color: '#f59e0b', dp: 0, deps: ['csun', 'clouds'], val: s => s.s },
  { key: 'felt',   label: 'Gefühlt',        unit: '°C',   color: '#f472b6', dp: 0, felt: true,
    show: a => a.temp && (a.ah || a.wind || a.csun) },
]

// A "nice" gridline step giving ~5 divisions over the range (1/2/5 × 10ⁿ).
function niceStep(range) {
  if (!(range > 0)) return 1
  const raw = range / 5
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / pow
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * pow
}

// Shared y-scale for one unit's points (each {med,lo,hi} or null). Non-negative
// quantities anchor the baseline at 0 and % is fixed 0–100, so adding a
// same-unit series (e.g. effektive Sonne alongside klare Sonne) doesn't
// re-range the others — only °C floats freely (can be negative, no natural 0).
function pointsScale(points, unit) {
  if (unit === '%') return { yMin: 0, yMax: 100, step: 20 }
  let yMin = Infinity, yMax = -Infinity
  for (const p of points) { if (!p) continue; yMin = Math.min(yMin, p.lo); yMax = Math.max(yMax, p.hi) }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = 0; yMax = 1 } // no data → avoid Inf/NaN
  if (unit !== '°C') yMin = Math.min(0, yMin) // irradiance/humidity/wind start at 0
  const step = niceStep(yMax - yMin)
  yMin = Math.floor(yMin / step) * step
  yMax = Math.ceil(yMax / step) * step
  if (yMax <= yMin) yMax = yMin + step
  return { yMin, yMax, step }
}

// "Gefühlt" per hour = UTCI composed from the ACTIVE factors; inactive ones use
// neutral defaults so felt reflects only what you toggle on: real humidity if
// Feuchte is on else a neutral 50% (as wind chill is defined without humidity);
// real wind if Wind is on else calm; effective sun (Sonne+Bewölkung) or clear
// sun (Sonne only) else shade. It appears only once a factor is active, so it is
// never just a relabelled air temperature.
function feltPoints(hours, ctx, active) {
  return hours.map(h => {
    const clearSky = clearSkyAt(h, ctx)
    return stats(h.samples.map(s => {
      const rhUsed   = active.ah ? s.rh : 50
      const windUsed = active.wind ? s.w : 0
      const Tr = (active.csun && active.clouds) ? meanRadiantTemp(s.t, s.s ?? clearSky)
               : active.csun                    ? meanRadiantTemp(s.t, clearSky)
               :                                  s.t
      return utci(s.t, rhUsed, windUsed, Tr)
    }))
  })
}

const ALL_ON = { temp: true, ah: true, wind: true, csun: true, clouds: true }

// Build the flat list of scaled series to draw from the active base set.
function buildSeries(hours, ctx, active) {
  const pointsFor = def => def.hourVal
    ? hours.map(h => stats([def.hourVal(h, ctx)]))
    : hours.map(h => stats(h.samples.map(def.val)))

  // Number of base inputs that combine into "Gefühlt" for the current toggles.
  const feltInputs = 1 /* temp */ + (active.ah ? 1 : 0) + (active.wind ? 1 : 0) +
                     (active.csun ? 1 : 0) + (active.csun && active.clouds ? 1 : 0)

  const out = []
  for (const b of BASES) {
    if (!active[b.key]) continue
    out.push({ ...b, derived: false, inputs: 1, points: pointsFor(b) })
  }
  for (const d of DERIVED) {
    const visible = d.show ? d.show(active) : d.deps.every(k => active[k])
    if (!visible) continue
    const points = d.felt ? feltPoints(hours, ctx, active) : pointsFor(d)
    const inputs = d.felt ? feltInputs : d.deps.length
    out.push({ ...d, derived: true, inputs, points })
  }
  // Shared y-scale per unit, fixed as if every metric of that unit were shown —
  // so toggling a metric on/off never re-ranges (and thus visually shifts) any
  // other line sharing its unit.
  for (const unit of new Set(out.map(s => s.unit))) {
    const allDefsForUnit = [
      ...BASES.filter(b => b.unit === unit),
      ...DERIVED.filter(d => d.unit === unit),
    ]
    const allPoints = allDefsForUnit.flatMap(def =>
      def.felt ? feltPoints(hours, ctx, ALL_ON) : pointsFor(def)
    )
    const scale = pointsScale(allPoints, unit)
    for (const s of out) if (s.unit === unit) Object.assign(s, scale)
  }
  return out
}

// Line width scales with how many base inputs combine into the value, capped so
// the busiest "Gefühlt" stays legible rather than a slab.
function lineWidth(inputs) {
  return Math.min(3, 1.4 + 0.45 * (inputs - 1))
}

// Multi-day forecast chart. BASE inputs are toggled from the shared selector
// above (same `active` state that drives the current-value readout); DERIVED
// outputs appear when their inputs are active. Same units share one scale.
function ForecastChart({ hours, lat, lon, active }) {
  const wrapRef = useRef()
  const svgRef = useRef()
  const [w, setW] = useState(360)
  const [selIdx, setSelIdx] = useState(null) // null → defaults to "now"
  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(es => setW(es[0].contentRect.width))
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const activeKey = Object.keys(active).filter(k => active[k]).sort().join(',')
  const series = useMemo(() => {
    if (!hours || !hours.length) return null
    return buildSeries(hours, { lat, lon }, active)
  }, [hours, activeKey, lat, lon])

  if (!series) return null

  const H = 260, padT = 10, padB = 24, padR = 10
  // Labelled axis only when every visible series shares one unit (one scale).
  const units = [...new Set(series.map(s => s.unit))]
  const single = units.length === 1
  const axisW = single ? 34 : 6
  const innerH = H - padT - padB
  const n = hours.length

  const pxPerHour = Math.max(6, (w - axisW) / 24)
  const chartW = Math.round((n - 1) * pxPerHour + padR + 4)
  const x = i => 4 + i * pxPerHour
  const ymap = s => v => padT + (1 - (v - s.yMin) / (s.yMax - s.yMin)) * innerH

  // Paths tolerate gaps (null points, e.g. a metric a model doesn't provide).
  const linePath = (points, yf) => {
    let d = '', pen = false
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      if (!p) { pen = false; continue }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${yf(p.med).toFixed(1)} `
      pen = true
    }
    return d
  }
  const bandPath = (points, yf) => {
    const idx = points.map((p, i) => (p ? i : -1)).filter(i => i >= 0)
    if (!idx.length) return ''
    let up = ''
    idx.forEach((i, k) => { up += `${k ? 'L' : 'M'}${x(i).toFixed(1)} ${yf(points[i].hi).toFixed(1)} ` })
    let dn = ''
    for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; dn += `L${x(i).toFixed(1)} ${yf(points[i].lo).toFixed(1)} ` }
    return `${up}${dn}Z`
  }

  // Horizontal gridlines: labelled ticks when all series share one unit (one
  // scale), else evenly-spaced unlabelled references (units would differ).
  const grid = []
  if (single) {
    const s = series[0], yf = ymap(s)
    for (let v = s.yMin; v <= s.yMax + 1e-9; v += s.step) grid.push({ y: yf(v), label: s.step < 1 ? v.toFixed(1) : String(Math.round(v)) })
  } else {
    for (let f = 0; f <= 4; f++) grid.push({ y: padT + (f / 4) * innerH, label: null })
  }

  // Gridline density adapts to how wide an hour is on screen.
  const minorStep = pxPerHour >= 11 ? 1 : pxPerHour >= 6 ? 3 : 6
  const labelStep = pxPerHour >= 8 ? 3 : 6
  const days = [], mids = [], minor = [], labels = []
  hours.forEach((h, i) => {
    const hr = h.time.getHours()
    if (i === 0 || hr === 0) days.push({ i, date: h.time })
    else if (hr % 6 === 0) mids.push(i)
    else if (hr % minorStep === 0) minor.push(i)
    if (hr !== 0 && hr % labelStep === 0) labels.push(i)
  })

  const nowMs  = Date.now()
  const nowIdx = Math.max(0, hours.findIndex(h => h.ts + 3600000 > nowMs))
  const spanDays = Math.round((n - nowIdx) / 24)
  const si  = selIdx == null ? nowIdx : Math.min(selIdx, n - 1)
  const selDate = hours[si].time
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
      </div>

      <div className="fc-plot">
        <svg className="fc-axis" width={axisW} height={H} viewBox={`0 0 ${axisW} ${H}`} aria-hidden="true">
          {grid.map((g, k) => g.label != null && (
            <text key={k} x={axisW - 3} y={g.y + 3} className="fc-ylab" textAnchor="end">{g.label}</text>
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
            {nowIdx > 0 && (
              <rect x={0} y={padT} width={x(nowIdx)} height={innerH} className="fc-past" />
            )}
            {grid.map((g, k) => (
              <line key={k} x1={0} x2={chartW} y1={g.y} y2={g.y} className="fc-grid" />
            ))}
            {minor.map(i => (
              <line key={`mn${i}`} x1={x(i)} x2={x(i)} y1={padT} y2={padT + innerH} className="fc-gridminor" />
            ))}
            {mids.map(i => (
              <line key={`m${i}`} x1={x(i)} x2={x(i)} y1={padT} y2={padT + innerH} className="fc-grid6" />
            ))}
            {days.map(({ i }) => i > 0 && (
              <line key={i} x1={x(i)} x2={x(i)} y1={padT} y2={padT + innerH} className="fc-daygrid" />
            ))}

            {series.map(s => (
              <path key={`b${s.key}`} d={bandPath(s.points, ymap(s))} fill={s.color} opacity="0.13" stroke="none" />
            ))}
            {series.map(s => (
              <path key={`l${s.key}`} d={linePath(s.points, ymap(s))} fill="none" stroke={s.color}
                strokeWidth={lineWidth(s.inputs)} strokeDasharray={s.derived ? '' : '4 2.5'} />
            ))}

            <line x1={x(nowIdx)} x2={x(nowIdx)} y1={padT} y2={padT + innerH} className="fc-now" />
            <text x={x(nowIdx) + 3} y={padT + 9} className="fc-nowlab">Jetzt</text>

            <line x1={x(si)} x2={x(si)} y1={padT} y2={padT + innerH} className="fc-cursor" />
            {series.map(s => s.points[si] && (
              <circle key={`d${s.key}`} cx={x(si)} cy={ymap(s)(s.points[si].med)} r="3.5" fill={s.color} stroke="var(--bg)" strokeWidth="1.5" />
            ))}

            {labels.map(i => (
              <text key={`h${i}`} x={x(i)} y={H - 7} className="fc-hourlab" textAnchor="middle">
                {String(hours[i].time.getHours()).padStart(2, '0')}
              </text>
            ))}
            {days.map(({ i, date }) => (
              <text key={`l${i}`} x={x(i) + 3} y={H - 7} className="fc-xlab">
                {WEEKDAY[date.getDay()]} {date.getDate()}.
              </text>
            ))}

            {series.length === 0 && (
              <text x={x(nowIdx) + 40} y={padT + innerH / 2} className="fc-empty">
                keine Werte gewählt
              </text>
            )}
          </svg>
        </div>
      </div>

      <div className="fc-readout">
        <div className="fc-rtime">{dateStr} {hhmm}</div>
        <div className="fc-rgrid">
          {series.map(s => {
            const p = s.points[si]; if (!p) return null
            const f = v => (s.dp ? v.toFixed(s.dp) : String(Math.round(v)))
            return (
              <div key={s.key} className={`fc-rcell ${s.derived ? 'derived' : ''}`}>
                <span className="fc-rlabel">
                  <i className="mdot" style={{ background: s.color }} />
                  {s.derived && '→ '}{s.label}
                </span>
                <span className="fc-rline">
                  <span className="fc-rvalue">{f(p.med)}{' '}{s.unit}</span>
                  <span className="fc-rrange">{f(p.lo)}–{f(p.hi)}</span>
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <p className="forecast-note">
        Basiswerte (gestrichelt) an/aus – abgeleitete Größen (durchgezogen: rel. Feuchte, effektive Sonne, Gefühlt) erscheinen automatisch.
        {' '}„Gefühlt“ erscheint ab Lufttemp. + einem Faktor (Feuchte, Wind oder Sonne) und bezieht nur die aktiven Faktoren ein (ohne Feuchte-Wahl: neutrale 50 %). Die Linienstärke wächst mit der Zahl einfliessender Grössen. Gleiche Einheiten teilen sich eine Skala (direkt vergleichbar). Tippen wählt einen Zeitpunkt; Schattierung = Modell-Spanne.
      </p>
    </div>
  )
}

// Great-circle distance [km] — how far the model grid cell sits from the
// requested point.
function distKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}

// Ensemble attribution from the per-model samples: which member provides which
// variables right now, and how far into the future each one reaches.
function ensembleInfo(hours) {
  if (!hours || !hours.length) return null
  const now = Date.now()
  const nowIdx = Math.max(0, hours.findIndex(h => h.ts + 3600000 > now))
  const nowSamples = hours[nowIdx].samples

  const members = Object.keys(MODEL_INFO).map(key => {
    let lastTs = null, rad = false, cloud = false
    for (const h of hours) {
      const s = h.samples.find(x => x.m === key)
      if (!s) continue
      lastTs = h.ts
      if (s.s != null) rad = true
      if (s.c != null) cloud = true
    }
    if (lastTs == null) return null
    return {
      key, ...MODEL_INFO[key], rad, cloud,
      horizonDays: Math.max(0, Math.round((lastTs - now) / 86400000)),
    }
  }).filter(Boolean)

  const count = f => nowSamples.filter(f).length
  return {
    members,
    now: {
      base:  nowSamples.length,
      rad:   count(s => s.s != null),
      cloud: count(s => s.c != null),
    },
  }
}

// Shared metric selector: BASE inputs to fold into "Gefühlt", also driving
// the graph below. Borderless row of toggle chips.
function MetricToggles({ active, onToggle }) {
  return (
    <div className="fc-metrics">
      {BASES.map(b => (
        <button
          key={b.key}
          type="button"
          className={`preset-btn ${active[b.key] ? 'active' : ''}`}
          onClick={() => onToggle(b.key)}
        >
          <i className="mdot" style={{ background: b.color }} />
          {b.label}
        </button>
      ))}
    </div>
  )
}

// The one headline number: UTCI folded from whichever factors are active.
// Borderless — color-coded text only, no card background.
function FeltNow({ point, airTemp, dp }) {
  const schwuel = dp >= 18 ? 'stark' : dp >= 16 ? 'spürbar' : null

  if (!point) {
    return (
      <div className="felt-now">
        <div className="ap-val">{fmt1(airTemp)}{' '}°C</div>
        <p className="felt-hint">Lufttemperatur — wähle oben mind. einen weiteren Faktor für „Gefühlt“.</p>
      </div>
    )
  }
  const cat  = utciCategory(point.med)
  const color = TEMP_COLOR[colorClass(point.med)]
  const diff = point.med - airTemp
  return (
    <div className="felt-now" style={{ '--felt-color': color }}>
      <div className="ap-val">{fmt1(point.med)}{' '}°C</div>
      <div className="ap-cat">{cat.label}</div>
      <p className="felt-hint">
        {fmt1(point.lo)}–{fmt1(point.hi)}°C je nach Modell · {diff >= 0 ? '+' : ''}{fmt1(diff)}°C vs. Luft
        {schwuel && <> · Schwüle {schwuel} (Tp {fmt1(dp)}°C)</>}
      </p>
    </div>
  )
}

function FeltTab({ outTemp, outRH, hours, wxMeta, lat, lon }) {
  const [active, setActive] = useState({ temp: true, ah: true, wind: true, csun: true, clouds: true })
  const toggle = key => setActive(a => ({ ...a, [key]: !a[key] }))

  const dp   = dewPoint(outTemp, outRH)
  const grid = wxMeta?.grid

  const feltDef = DERIVED.find(d => d.felt)
  const nowIdx  = hours && hours.length ? Math.max(0, hours.findIndex(h => h.ts + 3600000 > Date.now())) : null
  const nowPoint = (nowIdx != null && feltDef.show(active))
    ? feltPoints([hours[nowIdx]], { lat, lon }, active)[0]
    : null
  const ens = ensembleInfo(hours)

  return (
    <>
      <div className="felt-top">
        <FeltNow point={nowPoint} airTemp={outTemp} dp={dp} />
      </div>

      <MetricToggles active={active} onToggle={toggle} />

      <ForecastChart hours={hours} lat={lat} lon={lon} active={active} />

      <details className="section-card formula-card">
        <summary className="section-summary">
          <span className="section-name muted">Formeln & Methodik</span>
        </summary>
        <div className="section-body formula-body">
          <p><strong>UTCI</strong> – Bröde et al. (2012). Universeller thermischer Klimaindex: 210-Term-Polynom 6. Grades in Lufttemperatur, Windgeschwindigkeit, mittlerer Strahlungstemperatur und Dampfdruck. Windlimit: 0.5–17 m/s.</p>
          <p><strong>Schatten vs. Sonne</strong> – die beiden Karten zeigen die Spanne: Schatten ohne Strahlung (Tmrt = Luft), Sonne bei klarem Himmel. Das Klarhimmel-Maximum kommt aus dem Sonnenstand (NOAA-Algorithmus: Datum, Uhrzeit, Breiten- &amp; Längengrad) und dem Haurwitz-Modell – im Winter und abends schwächer, nachts null.</p>
          <p><strong>Strahlungstemperatur</strong> – vereinfachte lineare Näherung <code>Tmrt = T + 0.025·I</code> aus der Globalstrahlung I [W/m²].</p>
          <p><strong>Magnus-Tetens</strong> (Alduchov & Eskridge 1996): <code>e_s = 6.1094·exp(17.625T / (243.04+T))</code>. Taupunkt durch Invertierung. Abs. Feuchte: <code>rho_w = 216.7·e / T_K</code>.</p>

          {ens && (
            <>
              <p><strong>Datenbasis</strong> – Konsens (Median) aus den Wettermodellen via Open-Meteo. Mitglieder je Größe (jetzt): Temperatur / Feuchte / Wind <strong>{ens.now.base}</strong> · Sonnenstrahlung <strong>{ens.now.rad}</strong> · Bewölkung <strong>{ens.now.cloud}</strong>. Abgeleitete Größen erben die Zahl ihrer Eingänge (gefühlt Schatten/Sonne: {ens.now.base}, gefühlt bewölkt: {ens.now.rad}); „Sonne (klar)“ ist reine Astronomie (kein Modell). Mit wachsendem Horizont fallen Modelle nacheinander aus – die Spannen im Verlauf stützen sich hinten auf weniger Mitglieder.</p>
              <ul className="model-list">
                {ens.members.map(m => (
                  <li key={m.key}>
                    <strong>{m.name}</strong> ({m.org}, ~{m.res}) – reicht ~{m.horizonDays} Tage
                    {!m.rad && ' · ohne Strahlung'}
                    {!m.cloud && ' · ohne Bewölkung'}
                  </li>
                ))}
              </ul>
            </>
          )}
          {grid && grid.lat != null && grid.lon != null && (
            <p><strong>Ortsauflösung</strong> – die Werte gelten für die Modell-Gitterzelle um {grid.lat.toFixed(2)}°N, {grid.lon.toFixed(2)}°O
              {grid.elevation != null && <> auf {Math.round(grid.elevation)} m ü. M.</>}
              {`, ~${fmt1(distKm(lat, lon, grid.lat, grid.lon))} km vom gewählten Punkt`}.
              Mikroklima (Straßenschluchten, Hanglagen, Gewässernähe) löst kein Modell auf.</p>
          )}

          <p className="muted">UTCI nimmt eine gehende Person in angepasster Kleidung an. Richtwerte, keine Messwerte.</p>
        </div>
      </details>
    </>
  )
}

// Thermal-comfort zone (ASHRAE/DIN comfort box). Penalty = how far a (T, RH)
// state lies outside it, in °C-equivalent units (RH weighted ~0.1°C per %).
const COMFORT = { tLo: 20, tHi: 24, rhLo: 40, rhHi: 60 }
function comfortPenalty(T, RH) {
  const tp = T < COMFORT.tLo ? COMFORT.tLo - T : T > COMFORT.tHi ? T - COMFORT.tHi : 0
  const rp = RH < COMFORT.rhLo ? COMFORT.rhLo - RH : RH > COMFORT.rhHi ? RH - COMFORT.rhHi : 0
  return tp + 0.1 * rp
}

// Best ventilation window in the next 24 h to move indoor air toward the
// comfort zone: a run of hours where outdoor air is meaningfully closer to
// comfort than indoor (and won't condense). Returns the most-improving run.
// In winter outdoor air scores far worse on temperature, so no window is found.
function bestVentWindow(hours, Tin, RHin) {
  if (!hours || !hours.length) return null
  const inPen = comfortPenalty(Tin, RHin)
  const now = Date.now()
  const fut = hours.filter(h => h.ts + 3600000 > now).slice(0, 24)
  let best = null, cur = null
  for (const h of fut) {
    const improve = inPen - comfortPenalty(h.temp, h.humidity) // >0 → outdoor closer to comfort
    const ok = improve > 0.5 && dewPoint(h.temp, h.humidity) < Tin
    if (ok) {
      if (!cur) cur = { start: h.time, end: h.time, maxImprove: 0 }
      cur.end = h.time
      cur.maxImprove = Math.max(cur.maxImprove, improve)
    } else if (cur) {
      if (!best || cur.maxImprove > best.maxImprove) best = cur
      cur = null
    }
  }
  if (cur && (!best || cur.maxImprove > best.maxImprove)) best = cur
  return best
}

function fmtSlot(start, end) {
  const today = new Date().toDateString() === start.toDateString()
  const day = today ? 'heute' : WEEKDAY[start.getDay()]
  const sh = String(start.getHours()).padStart(2, '0')
  const eh = String((end.getHours() + 1) % 24).padStart(2, '0')
  return `${day} ${sh}–${eh} Uhr`
}

// Ventilation tab (indoor + outdoor: temp + humidity only)

function LueftenTab({ inTemp, setInTemp, inRH, setInRH, outTemp, setOutTemp, outRH, setOutRH, hours }) {
  const verdict   = ventVerdict(inTemp, inRH, outTemp, outRH)
  const feltIn    = indoorApparentTemp(inTemp, inRH).value
  const feltOut   = indoorApparentTemp(outTemp, outRH).value
  const win       = bestVentWindow(hours, inTemp, inRH)
  const comfyNow  = comfortPenalty(inTemp, inRH) < 0.5

  return (
    <>
      <details className="section-card">
        <summary className="section-summary">
          <span className="section-name">Innen</span>
          <span className="summary-chips">
            <Chip>{inTemp}{' '}°C</Chip>
            <Chip>{inRH}{' '}%</Chip>
            <Chip cls="felt">gefühlt {fmt1(feltIn)}°C</Chip>
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
            <Chip cls="felt">gefühlt {fmt1(feltOut)}°C</Chip>
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

      {hours && (
        win
          ? <p className="vent-window good">
              🪟 Bestes Lüftungsfenster: <strong>{fmtSlot(win.start, win.end)}</strong> –
              {' '}bringt das Raumklima näher an den Wohlfühlbereich (~20–24°C, 40–60%).
            </p>
          : comfyNow
            ? <p className="vent-window neutral">
                Innenklima liegt bereits im Wohlfühlbereich (~20–24°C, 40–60%) – Lüften v.a. für frische Luft.
              </p>
            : <p className="vent-window neutral">
                In den nächsten 24 h bringt die Aussenluft das Raumklima dem Wohlfühlbereich nicht näher (z.&nbsp;B. im Winter zu kalt).
              </p>
      )}

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
  const [locSource,   setLocSource]   = usePersistentState('locSource', 'gps') // 'gps' | 'search'
  const [hours,       setHours]       = useState(null)
  const [wxMeta,      setWxMeta]      = useState(null) // { sources, spread }
  const [clouds,      setClouds]      = useState(null) // current cloud cover %
  const [updatedAt,   setUpdatedAt]   = useState(null) // ms of last successful fetch
  const [nowTick,     setNowTick]     = useState(0)    // forces the freshness label to refresh

  // Apply fetched weather to outdoor inputs; prefill indoor temp once on first
  // load so the Lüften tab starts from a sensible baseline (= outdoor temp).
  const prefilledRef = useRef(false)
  function applyWeather(w) {
    setOutTemp(w.temp); setOutRH(w.humidity); setWind(w.wind)
    if (w.clouds != null) setClouds(w.clouds)
    if (w.sources) setWxMeta({ sources: w.sources, spread: w.spread, grid: w.grid })
    setUpdatedAt(Date.now())
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
          setLocSource('gps')
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
      setLocSource('search')
      setGeoStatus('ok')
    } catch { setGeoStatus('error') }
  }

  // Reload button: re-acquire GPS when in GPS mode; for a searched location
  // just refetch its data without switching back to the device position.
  function refresh() {
    if (locSource === 'search' && geoLocation?.lat != null) {
      refetchFor(geoLocation.lat, geoLocation.lon, geoLocation.name)
    } else {
      loadWeather()
    }
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

  // Keep the freshness label ticking; auto-refresh when the tab is refocused
  // and the data has gone stale (>10 min).
  useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 60000)
    function onVisible() {
      if (document.visibilityState === 'visible' &&
          updatedAt && Date.now() - updatedAt > 10 * 60000) {
        refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [updatedAt, locSource, geoLocation])

  return (
    <div className="app">
      <header>
        <h1>Gefühlte Temperatur</h1>
        <GeoBar
          status={geoStatus}
          location={geoLocation}
          onRefresh={refresh}
          onSearch={searchWeather}
          onLocate={loadWeather}
        />
        {/* keep showing staleness even if a later refresh failed — that's when it matters */}
        {updatedAt && (
          <p className="freshness" key={nowTick}>
            {agoLabel(updatedAt)}{geoStatus === 'error' ? ' · Aktualisierung fehlgeschlagen' : ''}
          </p>
        )}
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
              outTemp={outTemp}
              outRH={outRH}
              hours={hours}
              wxMeta={geoStatus === 'ok' ? wxMeta : null}
              lat={geoLocation?.lat ?? 50}
              lon={geoLocation?.lon ?? 10}
            />
          : <LueftenTab
              inTemp={inTemp}   setInTemp={setInTemp}
              inRH={inRH}       setInRH={setInRH}
              outTemp={outTemp} setOutTemp={setOutTemp}
              outRH={outRH}     setOutRH={setOutRH}
              hours={geoStatus === 'ok' ? hours : null}
            />
        }
      </main>
    </div>
  )
}
