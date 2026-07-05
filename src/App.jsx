import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import {
  utci, utciCategory, meanRadiantTemp, clearSkyMax, clearSkyGHI, solarElevation,
  ventilationAssessment, indoorApparentTemp,
  dewPoint,
  absoluteHumidity, specificEnthalpy,
} from './formulas.js'
import { fetchCurrentWeather, fetchHourlyForecast, searchLocation, reverseGeocode, MODEL_INFO } from './weather.js'
import './App.css'

// helpers

function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1) }

// Index of the hour bucket containing "now" — the single definition of
// "current" shared by the headline value, the graph, and the outdoor
// reading, so they never disagree about which sample is "now".
function nowHourIndex(hours) {
  return Math.max(0, hours.findIndex(h => h.ts + 3600000 > Date.now()))
}

// How far "now" sits between hours[nowIdx] and the next hour, as a 0–1
// fraction — the hourly data is only exact on the hour, so anything in
// between is a linear estimate rather than a real 5-min reading.
function nowFraction(hours, nowIdx) {
  const a = hours[nowIdx], b = hours[nowIdx + 1]
  if (!a || !b) return 0
  return Math.min(1, Math.max(0, (Date.now() - a.ts) / (b.ts - a.ts)))
}

// Linear interpolation between two {med,lo,hi} stat points (or null, at the
// edges of the data where there's nothing to blend with).
function interpPoint(a, b, t) {
  if (!a) return b
  if (!b) return a
  return { med: a.med + (b.med - a.med) * t, lo: a.lo + (b.lo - a.lo) * t, hi: a.hi + (b.hi - a.hi) * t }
}

// Interpolated current outdoor reading (temp/humidity/wind/clouds) from the
// hourly forecast, using the same nowFraction the headline and graph use. This
// is THE single source for every outdoor value on screen — the Gefühlt-tab
// air-temp baseline and the Lüften-tab Aussen inputs both read it — so they can
// never disagree about "now". Returns null when there's no forecast yet.
function nowReading(hours) {
  if (!hours || !hours.length) return null
  const i = nowHourIndex(hours)
  const a = hours[i], b = hours[i + 1]
  const frac = nowFraction(hours, i)
  const lerp = sel => (b ? sel(a) + (sel(b) - sel(a)) * frac : sel(a))
  const bothClouds = a.clouds != null && (!b || b.clouds != null)
  return {
    temp:     lerp(h => h.temp),
    humidity: lerp(h => h.humidity),
    wind:     lerp(h => h.wind),
    clouds:   bothClouds ? lerp(h => h.clouds) : (a.clouds ?? null),
  }
}

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

function GeoBar({ status, location, freshness, onRefresh, onSearch, onLocate }) {
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
      {/* Freshness folds into whichever status chip is showing, instead of
          its own row — keeps the header to one compact line. */}
      {status === 'loading' || status === 'locating'
        ? <span className="geo-msg loading">Standort wird ermittelt…</span>
        : status === 'ok' && location
          ? <span className="geo-ok">
              📍{' '}{location.name ?? `${location.lat.toFixed(2)}, ${location.lon.toFixed(2)}`}
              {freshness && <em> · {freshness}</em>}
            </span>
          : status === 'searching'
            ? <span className="geo-msg loading">Suche…</span>
            : status === 'notfound'
              ? <span className="geo-msg warn">Ort nicht gefunden</span>
              : status === 'error' && freshness
                ? <span className="geo-msg warn">Aktualisierung fehlgeschlagen <em>· {freshness}</em></span>
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
// `short`/`icon` are for the compact single-row toggle (MetricToggles);
// `label` stays the full name used everywhere else (graph readout, etc.).
const BASES = [
  { key: 'temp',   label: 'Lufttemp.',    short: 'Temp.',   icon: '🌡️', unit: '°C',   color: '#fb923c', dp: 0, val: s => s.t },
  { key: 'ah',     label: 'Abs. Feuchte', short: 'Feuchte', icon: '💧', unit: 'g/m³', color: '#22d3ee', dp: 1, val: s => absoluteHumidity(s.t, s.rh) },
  { key: 'wind',   label: 'Wind',         short: 'Wind',    icon: '💨', unit: 'km/h', color: '#94a3b8', dp: 0, val: s => s.w },
  { key: 'csun',   label: 'Sonne (klar)', short: 'Sonne',   icon: '☀️', unit: 'W/m²', color: '#fbbf24', dp: 0, hourVal: clearSkyAt },
  { key: 'clouds', label: 'Bewölkung',    short: 'Wolken',  icon: '☁️', unit: '%',    color: '#cbd5e1', dp: 0, val: s => s.c },
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
function ForecastChart({ hours, lat, lon, active, selTs, setSelTs, visible }) {
  const wrapRef = useRef()
  const svgRef = useRef()
  const scrollRef = useRef()
  const scrollPos = useRef(0)
  const scrollRaf = useRef(null)
  const drag = useRef({ active: false, moved: false, startX: 0, startScrollLeft: 0, pointerType: 'mouse' })
  const [dragging, setDragging] = useState(false)
  const [, setRenderTick] = useState(0) // forces a re-render: scroll (bubbles) and the 5s live-mode tick (below) share it
  const [w, setW] = useState(360)
  useEffect(() => () => { if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current) }, [])

  // Desktop mouse-drag panning re-renders anyway (via `dragging` toggling),
  // which is what made bubbles reposition there — but native touch/trackpad
  // scrolling never touches React state at all, so on a phone the scroll
  // position ref updated but nothing ever re-rendered to pick it up. rAF-
  // throttled so a fast swipe doesn't spam re-renders (series/paths are
  // memoized on hours/active, not scroll, so these re-renders are cheap —
  // only the bubble/label JSX actually redoes work).
  function onChartScroll(e) {
    scrollPos.current = e.currentTarget.scrollLeft
    if (scrollRaf.current) return
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = null
      setRenderTick(t => t + 1)
    })
  }
  useEffect(() => {
    if (!wrapRef.current) return
    // Ignore the 0-width report when the tab is hidden (display:none) so the
    // last good width is kept and the chart doesn't collapse.
    const ro = new ResizeObserver(es => {
      const width = es[0].contentRect.width
      if (width > 0) setW(width)
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])
  // Restore horizontal scroll when this tab is shown again — display:none can
  // reset scrollLeft in some browsers, so we reapply the saved position. Also
  // force one more render: layoutBubbles() reads scrollRef.current.clientWidth
  // during the render phase, which happens *before* React commits this tab's
  // display:none -> block, so right after switching back the very first
  // render still sees the old (hidden, 0-width) DOM — collapsing the bubble
  // viewport window to nothing and clamping every bubble to the left edge.
  // useLayoutEffect (not useEffect) runs after the commit but before paint, so
  // the extra render this schedules recomputes with the real width before the
  // user ever sees the wrong frame.
  useLayoutEffect(() => {
    if (visible && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollPos.current
      setRenderTick(t => t + 1)
    }
  }, [visible])

  // The "Jetzt" line's position (and the interpolated now-value it drives)
  // is time-based, not data-based — it should visibly creep forward between
  // 5-min data refreshes, not just jump each time new data arrives. Ticking
  // only while live (nothing else selected) and this tab is actually on
  // screen, since neither the line's exact sub-minute position nor battery
  // spent redrawing an invisible chart matter otherwise. 5s is frequent
  // enough to look alive without doing real work: series/paths are memoized
  // separately, so this just recomputes a few numbers and repaints text/line
  // positions.
  useEffect(() => {
    if (!visible || selTs != null) return
    const id = setInterval(() => setRenderTick(t => t + 1), 5000)
    return () => clearInterval(id)
  }, [visible, selTs])

  const activeKey = Object.keys(active).filter(k => active[k]).sort().join(',')
  const series = useMemo(() => {
    if (!hours || !hours.length) return null
    return buildSeries(hours, { lat, lon }, active)
  }, [hours, activeKey, lat, lon])

  if (!series) return null

  const H = 260, padT = 10, padB = 24, padR = 10
  const units = [...new Set(series.map(s => s.unit))]
  const single = units.length === 1
  // Constant — this used to widen to 34px for a labelled side gutter when a
  // single shared unit made ticks meaningful, but that made the plot itself
  // resize (and everything scroll-jump) whenever toggling a metric changed
  // `single`. Axis labels (when shown) now render inside the scrollable
  // plot instead of in a separate reserved column, so the gutter never
  // needs to be wider than this.
  const axisW = 6
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

  // Tick marks (position + label) for one series' own scale.
  const axisTicks = s => {
    const yf = ymap(s)
    const out = []
    for (let v = s.yMin; v <= s.yMax + 1e-9; v += s.step) {
      out.push({ y: yf(v), label: s.step < 1 ? v.toFixed(1) : String(Math.round(v)) })
    }
    return out
  }

  // With exactly two active BASE toggles, show both scales — the one whose
  // button comes first (BASES order) on the left edge, the other on the
  // right. Based on active *toggles*, not total distinct units across all
  // visible series: temp+ah also brings in "rel. Feuchte" (%, a third unit),
  // which would otherwise mask the temp/humidity pair's own dual axis even
  // though exactly two base metrics are on — BASES units are all mutually
  // distinct, so counting active toggles is equivalent to counting units
  // among just the bases (ignoring derived-only additions like that one).
  const activeBaseUnits = [...new Set(BASES.filter(b => active[b.key]).map(b => b.unit))]
  const dualUnits = activeBaseUnits.length === 2
  const activeBaseIndex = unit => {
    let min = Infinity
    BASES.forEach((b, i) => { if (active[b.key] && b.unit === unit && i < min) min = i })
    return min
  }
  const [leftUnit, rightUnit] = dualUnits
    ? [...activeBaseUnits].sort((a, b) => activeBaseIndex(a) - activeBaseIndex(b))
    : [null, null]
  const leftSeries  = dualUnits ? series.find(s => s.unit === leftUnit)  : null
  const rightSeries = dualUnits ? series.find(s => s.unit === rightUnit) : null

  // Horizontal gridlines: labelled ticks off the single shared scale, or off
  // the left-hand scale when there are two, else evenly-spaced unlabelled
  // references (3+ units can't share meaningful gridlines).
  const grid = single
    ? axisTicks(series[0])
    : dualUnits
      ? axisTicks(leftSeries).map(g => ({ y: g.y, label: null }))
      : Array.from({ length: 5 }, (_, f) => ({ y: padT + (f / 4) * innerH, label: null }))

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

  const nowIdx = nowHourIndex(hours)
  const nowFrac = nowFraction(hours, nowIdx)
  const xNow = x(nowIdx) + nowFrac * pxPerHour
  const spanDays = Math.round((n - nowIdx) / 24)

  // Selecting nothing (the default) means "now" — an exact, interpolated
  // position between two hourly samples, not snapped to either one. Tapping
  // always selects a real (whole-hour) data point instead. The selection is
  // anchored to that hour's timestamp, not its array index: the hourly
  // window slides forward with every refetch, so an index could otherwise
  // silently point at a different hour (or vanish) later — in which case we
  // fall back to "now" rather than show a stale/wrong point.
  const selHourIdx = selTs != null ? hours.findIndex(h => h.ts === selTs) : -1
  const selectingNow = selHourIdx === -1
  const si    = selectingNow ? nowIdx : selHourIdx
  const selX  = selectingNow ? xNow : x(si)
  const selDate = selectingNow ? new Date() : hours[si].time
  const dateStr = `${WEEKDAY[selDate.getDay()]} ${selDate.getDate()}.${selDate.getMonth() + 1}.`
  const hhmm = selectingNow
    ? `${String(selDate.getHours()).padStart(2, '0')}:${String(selDate.getMinutes()).padStart(2, '0')}`
    : `${String(selDate.getHours()).padStart(2, '0')}:00`

  // Value at the current selection: the real hourly point when a specific
  // hour is tapped, or the interpolated "now" estimate by default.
  function pointAt(s) {
    if (!selectingNow) return s.points[si]
    return interpPoint(s.points[nowIdx], s.points[nowIdx + 1], nowFrac)
  }

  // Value bubbles at the selected point, split across both sides of the line
  // (alternating by vertical position) and decluttered within each side so
  // close-together values don't stack. Drawn in the same scrollable SVG as
  // the line itself: as the line nears the edge of the *currently visible*
  // viewport, a bubble that would clip off the outer edge flips to the inner
  // side first, so it stays readable a little longer — then, once the whole
  // selection scrolls out of view, everything (line + bubbles) simply scrolls
  // away together like normal content. No JS-level hiding, ever.
  const BUBBLE_GAP = 15
  function layoutBubbles() {
    const viewLeft = scrollRef.current ? scrollRef.current.scrollLeft : 0
    const viewRight = viewLeft + (scrollRef.current ? scrollRef.current.clientWidth : chartW)
    const items = series.map(s => {
      const p = pointAt(s); if (!p) return null
      const f = v => (s.dp ? v.toFixed(s.dp) : String(Math.round(v)))
      const text = `${f(p.med)} ${s.unit}`
      return { key: s.key, color: s.color, y: ymap(s)(p.med), text, bw: text.length * 5.4 + 10 }
    }).filter(Boolean).sort((a, b) => a.y - b.y)
    items.forEach((it, i) => {
      const pref = i % 2 === 0 ? 'right' : 'left'
      const prefBx = pref === 'left' ? selX - 8 - it.bw : selX + 8
      // Flip to the inner side once the preferred side would clip off the
      // edge of the *visible viewport* — so it moves in before it would be
      // scrolled out of view, rather than clinging to the outer side.
      const noRoom = pref === 'left' ? prefBx < viewLeft : prefBx + it.bw > viewRight
      it.side = noRoom ? (pref === 'left' ? 'right' : 'left') : pref
      it.bx = it.side === 'left' ? selX - 8 - it.bw : selX + 8
    })
    const left = items.filter(it => it.side === 'left')
    const right = items.filter(it => it.side === 'right')
    for (const side of [left, right]) {
      if (!side.length) continue
      let prev = -Infinity
      for (const it of side) { it.cy = Math.max(it.y, prev + BUBBLE_GAP); prev = it.cy }
      // If the stack ran past the bottom, shift the whole group up; if that
      // (or too many bubbles to fit at all) leaves the top one above the
      // plot, shift back down — clamped inside the plot either way.
      const bottomOverflow = side[side.length - 1].cy - (padT + innerH)
      if (bottomOverflow > 0) side.forEach(it => { it.cy -= bottomOverflow })
      const topOverflow = padT - side[0].cy
      if (topOverflow > 0) side.forEach(it => { it.cy += topOverflow })
    }
    return { left, right }
  }

  // Snap to whichever is closer: the nearest whole hour, or "now" (its own
  // snap point, not aligned to the hourly grid) — so returning to live mode
  // is just tapping near the Jetzt line, the same gesture as picking any
  // other point, rather than a separate hidden control.
  function pick(e) {
    const rect = svgRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    let idx = Math.round((px - 4) / pxPerHour)
    idx = Math.max(0, Math.min(n - 1, idx))
    const hourDist = Math.abs(px - x(idx))
    const nowDist  = Math.abs(px - xNow)
    setSelTs(nowDist < hourDist ? null : hours[idx].ts)
  }

  // Click selects a point; drag only scrolls — the two are disambiguated by
  // movement, not by input type, so both mouse and touch behave the same way.
  // Touch already scrolls natively (touchAction: pan-x below), so the manual
  // scrollLeft assignment here is mouse-only — doing it for touch too would
  // fight the browser's own scroll and jitter.
  const DRAG_THRESHOLD = 4
  function onDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      active: true, moved: false, startX: e.clientX,
      startScrollLeft: scrollRef.current ? scrollRef.current.scrollLeft : 0,
      pointerType: e.pointerType,
    }
    if (e.pointerType === 'mouse') setDragging(true)
  }
  function onMove(e) {
    const d = drag.current
    if (!d.active) return
    const dx = e.clientX - d.startX
    if (Math.abs(dx) > DRAG_THRESHOLD) d.moved = true
    if (d.moved && d.pointerType === 'mouse' && scrollRef.current) {
      scrollRef.current.scrollLeft = d.startScrollLeft - dx
    }
  }
  function onUp(e) {
    const d = drag.current
    if (d.active && !d.moved) pick(e)
    drag.current.active = false
    if (dragging) setDragging(false)
  }

  // Reset the selection to live mode and scroll all the way to the left —
  // not just "now" into view, but far enough that its value bubbles (which
  // can extend further left than the line itself) aren't cut off either.
  function jumpToNow() {
    setSelTs(null)
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0
      scrollPos.current = 0
    }
  }

  return (
    <div className="forecast" ref={wrapRef}>
      <div className="forecast-head">
        <span className="section-name muted">{spanDays}-Tage-Vorschau</span>
        <button
          type="button"
          className={`fc-now-btn ${selectingNow ? 'live' : ''}`}
          onClick={jumpToNow}
          title={selectingNow ? 'Live – folgt der aktuellen Zeit' : 'Zu jetzt springen'}
          aria-label="Zu jetzt springen"
        >
          <i className="fc-now-dot" /> Jetzt
        </button>
      </div>

      <div className="fc-plot">
        <svg className="fc-axis" width={axisW} height={H} viewBox={`0 0 ${axisW} ${H}`} aria-hidden="true" />
        <div
          className="fc-scroll"
          ref={scrollRef}
          onScroll={onChartScroll}
        >
          <svg
            ref={svgRef}
            width={chartW} height={H} viewBox={`0 0 ${chartW} ${H}`} role="img"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            className={dragging ? 'dragging' : ''}
            style={{ touchAction: 'pan-x' }}
          >
            {xNow > 0 && (
              <rect x={0} y={padT} width={xNow} height={innerH} className="fc-past" />
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

            <line x1={xNow} x2={xNow} y1={padT} y2={padT + innerH} className={`fc-now ${selectingNow ? 'live' : ''}`} />
            <text x={xNow + 3} y={padT + 9} className={`fc-nowlab ${selectingNow ? 'live' : ''}`}>Jetzt</text>

            {!selectingNow && (
              <line x1={selX} x2={selX} y1={padT} y2={padT + innerH} className="fc-cursor" />
            )}
            {series.map(s => {
              const p = pointAt(s); if (!p) return null
              return (
                <circle key={`d${s.key}`} cx={selX} cy={ymap(s)(p.med)} r="3.5" fill={s.color} stroke="var(--bg)" strokeWidth="1.5" />
              )
            })}

            {/* Experimental: value bubbles flanking the selected line instead
                of a separate legend/readout — see if this reads better or is
                just noisy with several metrics active. */}
            {(() => {
              const { left, right } = layoutBubbles()
              const bubble = (b, side) => (
                <g key={`${side}-${b.key}`}>
                  <rect x={b.bx} y={b.cy - 8} width={b.bw} height={16} rx={8} fill="var(--surface)" stroke={b.color} strokeWidth="1" />
                  <text x={b.bx + b.bw / 2} y={b.cy} dominantBaseline="middle" textAnchor="middle" style={{ fill: b.color, fontSize: '9px', fontWeight: 700 }}>
                    {b.text}
                  </text>
                </g>
              )
              return <>{left.map(b => bubble(b, 'left'))}{right.map(b => bubble(b, 'right'))}</>
            })()}

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
              <text x={xNow + 40} y={padT + innerH / 2} className="fc-empty">
                keine Werte gewählt
              </text>
            )}
          </svg>
        </div>
        {/* Anchored to the plot's own edges, not the scrollable content —
            overlaying on top rather than scrolling away with it, and without
            reserving a separate widening column next to the graph. */}
        {single && (
          <svg className="fc-ylabs fc-ylabs-left" width="34" height={H} viewBox={`0 0 34 ${H}`} aria-hidden="true">
            {grid.map((g, k) => g.label != null && (
              <text key={`yl${k}`} x={4} y={g.y} dominantBaseline="middle" className="fc-ylab-inside">{g.label}</text>
            ))}
          </svg>
        )}
        {dualUnits && (
          <>
            <svg className="fc-ylabs fc-ylabs-left" width="34" height={H} viewBox={`0 0 34 ${H}`} aria-hidden="true">
              {axisTicks(leftSeries).map((g, k) => (
                <text key={`yll${k}`} x={4} y={g.y} dominantBaseline="middle" className="fc-ylab-inside" style={{ fill: leftSeries.color }}>{g.label}</text>
              ))}
            </svg>
            <svg className="fc-ylabs fc-ylabs-right" width="34" height={H} viewBox={`0 0 34 ${H}`} aria-hidden="true">
              {axisTicks(rightSeries).map((g, k) => (
                <text key={`ylr${k}`} x={30} y={g.y} dominantBaseline="middle" textAnchor="end" className="fc-ylab-inside" style={{ fill: rightSeries.color }}>{g.label}</text>
              ))}
            </svg>
          </>
        )}
      </div>

      {/* Legend, kept alongside the in-graph bubbles — one compact row per
          metric instead of the previous two-line stat tiles. */}
      <div className="fc-readout">
        <div className="fc-rtime">{dateStr} {hhmm}</div>
        <div className="fc-rlist">
          {series.map(s => {
            const p = pointAt(s); if (!p) return null
            const f = v => (s.dp ? v.toFixed(s.dp) : String(Math.round(v)))
            return (
              <div key={s.key} className="fc-rrow">
                <i className="mdot" style={{ background: s.color }} />
                <span className="fc-rrow-label">{s.derived && '→ '}{s.label}</span>
                <span className="fc-rrow-range">{f(p.lo)}–{f(p.hi)}</span>
                <span className="fc-rrow-value">{f(p.med)} {s.unit}</span>
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
  const nowIdx = nowHourIndex(hours)
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

  // Whichever active member currently gives the sharpest local detail (the
  // smallest grid cell) — e.g. MeteoSwiss ICON-CH1 (1 km) near the Alps
  // while it's within its 33 h horizon, falling back to a coarser member
  // once it drops out.
  const nowKeys = new Set(nowSamples.map(s => s.m))
  const finest = members
    .filter(m => nowKeys.has(m.key))
    .reduce((best, m) => (!best || m.resKm < best.resKm) ? m : best, null)

  return {
    members,
    finest,
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
          className={`fc-metric ${active[b.key] ? 'active' : ''}`}
          onClick={() => onToggle(b.key)}
          style={{ '--metric-color': b.color }}
          aria-pressed={active[b.key]}
          title={b.label}
        >
          <span className="fc-metric-circle">{b.icon}</span>
          <span className="fc-metric-label">{b.short}</span>
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

function FeltTab({ outTemp, outRH, hours, wxMeta, gridPlace, lat, lon, selTs, setSelTs, visible }) {
  const [active, setActive] = useState({ temp: true, ah: true, wind: true, csun: true, clouds: true })
  const toggle = key => setActive(a => ({ ...a, [key]: !a[key] }))

  const grid = wxMeta?.grid
  const feltDef = DERIVED.find(d => d.felt)
  const nowIdx  = hours && hours.length ? nowHourIndex(hours) : null

  // Everything "now" on this tab reads the interpolated current moment (the
  // hourly data is only exact on the hour) so the headline value, its air-temp
  // baseline, the Schwüle dew point and the graph readout all agree. Uses the
  // same nowReading() source as the Lüften tab's Aussen inputs.
  const nv      = nowReading(hours)
  const airTemp = nv ? nv.temp     : outTemp
  const airRH   = nv ? nv.humidity : outRH
  const dp      = dewPoint(airTemp, airRH)

  const nowPoint = (nowIdx != null && feltDef.show(active))
    ? interpPoint(
        feltPoints([hours[nowIdx]], { lat, lon }, active)[0],
        hours[nowIdx + 1] ? feltPoints([hours[nowIdx + 1]], { lat, lon }, active)[0] : null,
        nowFraction(hours, nowIdx)
      )
    : null
  const ens = ensembleInfo(hours)

  return (
    <>
      <div className="felt-top">
        <FeltNow point={nowPoint} airTemp={airTemp} dp={dp} />
      </div>

      <MetricToggles active={active} onToggle={toggle} />

      <ForecastChart hours={hours} lat={lat} lon={lon} active={active}
        selTs={selTs} setSelTs={setSelTs} visible={visible} />

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
              {ens.finest && (
                <p><strong>Feinste Auflösung hier</strong> – {ens.finest.name} (~{ens.finest.resKm} km)
                  {gridPlace && <> bei <strong>{gridPlace}</strong></>}. Wechselt mit dem Ort und kann im
                  Verlauf gröber werden, sobald das feinste Modell seinen Vorhersagehorizont erreicht.</p>
              )}
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

function LueftenTab({
  inTemp, setInTemp, inRH, setInRH, outTemp, setOutTemp, outRH, setOutRH,
  setOutManual, outManual, onResetOutdoor, hours, graphPoint,
}) {
  const verdict   = ventVerdict(inTemp, inRH, outTemp, outRH)
  const feltIn    = indoorApparentTemp(inTemp, inRH).value
  const feltOut   = indoorApparentTemp(outTemp, outRH).value
  const win       = bestVentWindow(hours, inTemp, inRH)
  const comfyNow  = comfortPenalty(inTemp, inRH) < 0.5

  // Any direct edit to the outdoor sliders (or importing a graph point) is a
  // deliberate override — mark it so the auto-sync from live data stops
  // clobbering it, and the "back to live" button below appears.
  const setOutTempManual = v => { setOutTemp(v); setOutManual(true) }
  const setOutRHManual   = v => { setOutRH(v);   setOutManual(true) }

  // Pull the temp/humidity of the point currently selected in the Gefühlt-tab
  // graph (or "now") into the outdoor sliders, so a forecast hour can be
  // explored here without re-entering values by hand. Shown only when it would
  // actually change the sliders (i.e. they don't already match that point).
  const gpTemp = graphPoint && Math.round(graphPoint.temp * 2) / 2
  const gpRH   = graphPoint && Math.round(graphPoint.humidity)
  const canImport = graphPoint && (gpTemp !== outTemp || gpRH !== outRH)
  const importGraph = () => { setOutTempManual(gpTemp); setOutRHManual(gpRH) }

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
          {outManual && (
            <button type="button" className="graph-import" onClick={onResetOutdoor}>
              ↺ Zurück zu Live-Daten
            </button>
          )}
          {canImport && (
            <button type="button" className="graph-import" onClick={importGraph}>
              ⟳ Graphpunkt übernehmen ({graphPoint.label}: {fmt1(graphPoint.temp)} °C · {gpRH} %)
            </button>
          )}
          <Slider label="Temperatur"       value={outTemp} onChange={setOutTempManual} min={-30} max={50}  step={0.5} unit="°C" />
          <Slider label="Luftfeuchtigkeit" value={outRH}   onChange={setOutRHManual}   min={0}   max={100} step={1}   unit="%" />
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
  const [inTemp,  setInTemp]  = usePersistentState('inTemp', 24)
  const [inRH,    setInRH]    = usePersistentState('inRH', 55)
  // Once the user edits the Lüften Aussen sliders directly, stop silently
  // overwriting them on every refetch — they're deliberately exploring a
  // "what if" scenario. resetOutdoorToLive() is the explicit way back.
  const [outManual, setOutManual] = usePersistentState('outManual', false)

  const [geoStatus,   setGeoStatus]   = useState('idle')
  const [geoLocation, setGeoLocation] = usePersistentState('geoLocation', null)
  const [locSource,   setLocSource]   = usePersistentState('locSource', 'gps') // 'gps' | 'search'
  const [hours,       setHours]       = useState(null)
  // Graph selection, lifted so both tabs share it. Anchored to the selected
  // hour's timestamp (not its array index!) — hours is a sliding window that
  // shifts forward with every refetch, so an index can silently point at a
  // different hour (or vanish) once the window moves. null → "now".
  const [selTs,       setSelTs]       = useState(null)
  const [wxMeta,      setWxMeta]      = useState(null) // { sources, spread }
  const [gridPlace,   setGridPlace]   = useState(null) // reverse-geocoded name of wxMeta.grid
  const [updatedAt,   setUpdatedAt]   = useState(null) // ms of last successful fetch
  const [nowTick,     setNowTick]     = useState(0)    // forces the freshness label to refresh

  // The `current` endpoint only feeds methodology metadata (member count,
  // spread, grid cell) here — the actual outdoor temp/RH used everywhere
  // (headline, graph, Lüften tab) come from the hourly forecast's "now"
  // bucket instead (effect below), so there is exactly one definition of
  // "the current outdoor reading" instead of two independent fetches that
  // can disagree (they hit the same models but current vs. hourly aggregation
  // differ, which showed up as a real gap e.g. in humidity).
  const prefilledRef = useRef(false)
  function applyWeather(w) {
    if (w.sources) setWxMeta({ sources: w.sources, spread: w.spread, grid: w.grid })
    setUpdatedAt(Date.now())
  }

  // Reverse-geocode the grid cell (not the raw query point) so the methodology
  // section can name a place for whichever model is currently sharpest there,
  // instead of just bare coordinates. Re-runs only when the grid cell itself
  // moves (a new location, or the API resolving to a different cell nearby).
  const gridLat = wxMeta?.grid?.lat, gridLon = wxMeta?.grid?.lon
  useEffect(() => {
    if (gridLat == null || gridLon == null) return
    let cancelled = false
    reverseGeocode(gridLat, gridLon).then(name => { if (!cancelled) setGridPlace(name) }).catch(() => {})
    return () => { cancelled = true }
  }, [gridLat, gridLon])

  // Sync outdoor inputs from the interpolated "now" reading whenever a fresh
  // forecast arrives (same source as the Gefühlt tab, quantized to the slider
  // steps), so Lüften's Aussen matches the Gefühlt tab — but only while the
  // user hasn't overridden them by hand (see outManual above). Prefill indoor
  // temp once so the Lüften tab starts from a sensible baseline (= outdoor temp).
  useEffect(() => {
    const nv = nowReading(hours)
    if (!nv) return
    if (!outManual) {
      setOutTemp(Math.round(nv.temp * 2) / 2)
      setOutRH(Math.round(nv.humidity))
    }
    if (!prefilledRef.current) {
      setInTemp(Math.round(nv.temp * 2) / 2)
      prefilledRef.current = true
    }
  }, [hours, outManual])

  // Explicit way back to live data after outManual has diverged from it.
  function resetOutdoorToLive() {
    const nv = nowReading(hours)
    if (!nv) return
    setOutTemp(Math.round(nv.temp * 2) / 2)
    setOutRH(Math.round(nv.humidity))
    setOutManual(false)
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
          const name = await reverseGeocode(coords.latitude, coords.longitude).catch(() => null)
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

  // Keep the freshness label ticking; auto-refresh every 5 min while the tab
  // is visible, and immediately whenever the app is reactivated and the data
  // has gone stale. "Reactivated" covers two distinct browser signals:
  // visibilitychange (tab switched back to / unminimized) and window focus
  // (OS brought this browser window back to front without changing tabs) —
  // relying on only one misses the other, which is why a stale reload could
  // sit unrefreshed until the 5-min interval happened to land.
  useEffect(() => {
    const REFRESH_MS = 5 * 60000
    const id = setInterval(() => setNowTick(t => t + 1), 60000)
    const refreshId = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, REFRESH_MS)
    function refreshIfStale() {
      if (document.visibilityState === 'visible' &&
          updatedAt && Date.now() - updatedAt > REFRESH_MS) {
        refresh()
      }
    }
    document.addEventListener('visibilitychange', refreshIfStale)
    window.addEventListener('focus', refreshIfStale)
    return () => {
      clearInterval(id)
      clearInterval(refreshId)
      document.removeEventListener('visibilitychange', refreshIfStale)
      window.removeEventListener('focus', refreshIfStale)
    }
  }, [updatedAt, locSource, geoLocation])

  // Temp/humidity of the point currently selected in the graph (or the
  // interpolated "now" when nothing is tapped, or the selection has aged out
  // of the hourly window), for the Lüften import button.
  const graphPoint = (() => {
    if (geoStatus !== 'ok' || !hours || !hours.length) return null
    const h = selTs != null ? hours.find(h => h.ts === selTs) : null
    if (!h) {
      const nv = nowReading(hours)
      return nv && { temp: nv.temp, humidity: nv.humidity, label: 'jetzt' }
    }
    return {
      temp: h.temp, humidity: h.humidity,
      label: `${WEEKDAY[h.time.getDay()]} ${String(h.time.getHours()).padStart(2, '0')}:00`,
    }
  })()

  return (
    <div className="app">
      {/* No separate title: the tabs are the heading, with the (global, not
          tab-specific) location right below in the same box — one sleek
          unit instead of alternating boxed/unboxed rows. */}
      <div className="top-bar">
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
        {/* Freshness folds into the GeoBar chip (see there) instead of its
            own row. */}
        <GeoBar
          status={geoStatus}
          location={geoLocation}
          freshness={updatedAt ? agoLabel(updatedAt) : null}
          onRefresh={refresh}
          onSearch={searchWeather}
          onLocate={loadWeather}
        />
      </div>

      {/* Both tabs stay mounted (inactive one hidden) so the graph selection,
          toggles and scroll position survive switching back and forth. */}
      <main>
        <div style={{ display: tab === 'felt' ? undefined : 'none' }}>
          <FeltTab
            outTemp={outTemp}
            outRH={outRH}
            hours={hours}
            wxMeta={geoStatus === 'ok' ? wxMeta : null}
            gridPlace={geoStatus === 'ok' ? gridPlace : null}
            lat={geoLocation?.lat ?? 50}
            lon={geoLocation?.lon ?? 10}
            selTs={selTs}
            setSelTs={setSelTs}
            visible={tab === 'felt'}
          />
        </div>
        <div style={{ display: tab === 'lueften' ? undefined : 'none' }}>
          <LueftenTab
            inTemp={inTemp}   setInTemp={setInTemp}
            inRH={inRH}       setInRH={setInRH}
            outTemp={outTemp} setOutTemp={setOutTemp}
            outRH={outRH}     setOutRH={setOutRH}
            setOutManual={setOutManual}
            outManual={outManual}
            onResetOutdoor={resetOutdoorToLive}
            hours={geoStatus === 'ok' ? hours : null}
            graphPoint={graphPoint}
          />
        </div>
      </main>
    </div>
  )
}
