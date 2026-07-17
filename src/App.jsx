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
  const i = hours.findIndex(h => h.ts + 3600000 > Date.now())
  // All hours in the past (data went stale, e.g. after a long offline spell):
  // the *newest* hour is the least-wrong stand-in for "now" — not index 0,
  // which would be the very oldest reading in the window.
  return i === -1 ? hours.length - 1 : i
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

function ventVerdict(Tin, RHin, Tout, RHout, elevM = 0) {
  const a = ventilationAssessment(Tin, RHin, Tout, RHout, elevM)
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

// Slider. A native range input jumps to wherever a finger first lands and
// commits that on the tap — so an accidental tap, or a tap that turns into a
// vertical page scroll, would change the value. On TOUCH we therefore ignore
// changes until the finger has actually dragged sideways past a small
// threshold (and revert the tap-jump the browser applied to the DOM),
// capturing the pointer only once it's a real drag so vertical scrolling
// (touch-action: pan-y) still works. Mouse/keyboard keep their normal
// behaviour: desktop click-to-set and arrow keys commit immediately.
const SLIDER_DRAG_PX = 6
function Slider({ label, value, onChange, min, max, step, unit }) {
  const ref = useRef()
  const g = useRef({ down: false, moved: false, startX: 0, startVal: value, touch: false, pid: null })

  function onDown(e) {
    g.current = { down: true, moved: false, startX: e.clientX, startVal: value, touch: e.pointerType !== 'mouse', pid: e.pointerId }
    // Mouse captures immediately (click-to-set/drag); touch waits until it's a
    // real horizontal drag so a vertical scroll gesture isn't hijacked.
    if (e.pointerType === 'mouse') e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onMove(e) {
    const s = g.current
    if (!s.down || s.moved) return
    if (Math.abs(e.clientX - s.startX) > SLIDER_DRAG_PX) {
      s.moved = true
      if (s.touch && ref.current) { try { ref.current.setPointerCapture(s.pid) } catch {} }
    }
  }
  function onChangeEv(e) {
    const s = g.current
    // Touch, finger down but not yet a real drag → this is the tap-jump (or a
    // scroll start): swallow it and undo the DOM change the browser made.
    if (s.touch && s.down && !s.moved) { e.target.value = String(s.startVal); return }
    onChange(Number(e.target.value))
  }
  function onUp() { g.current.down = false }

  return (
    <div className="control">
      <div className="control-header">
        <span className="slider-label">{label}</span>
        <span className="value-badge">{value}{' '}{unit}</span>
      </div>
      <input
        ref={ref}
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={onChangeEv}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onLostPointerCapture={onUp}
        style={{ touchAction: 'pan-y' }}
      />
    </div>
  )
}

// Info tooltip

function Info({ children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()
  // Close on any tap/click outside — an open tooltip otherwise stays until
  // its own "i" is hit again, unlike every other transient UI element.
  useEffect(() => {
    if (!open) return
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <span className="info-wrap" ref={ref}>
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

// One plain-language sentence explaining WHY the verdict is what it is —
// shown in the hero banner, not buried under the numbers.
function ventReason(Tin, RHin, Tout, RHout, elevM = 0) {
  const a   = ventilationAssessment(Tin, RHin, Tout, RHout, elevM)
  const dpO = dewPoint(Tout, RHout)
  const ahI = absoluteHumidity(Tin, RHin)
  const ahO = absoluteHumidity(Tout, RHout)

  if (a.condensationRisk)
    return `Taupunkt aussen (${fmt1(dpO)}°C) liegt über der Innentemperatur (${fmt1(Tin)}°C) → Kondensat auf kühlen Oberflächen möglich.`
  if (a.deltaAH < -0.3 && a.deltaH < -0.5)
    return `Die Aussenluft ist trockener (${fmt1(ahO)} vs. ${fmt1(ahI)} g/m³) und kühler (Δh = ${fmt1(a.deltaH)} kJ/kg).`
  if (a.deltaAH < -0.3)
    return `Die Aussenluft ist trockener, aber ${a.deltaH > 0.5 ? 'wärmer' : 'thermisch ähnlich'} (Δh = ${fmt1(a.deltaH)} kJ/kg).`
  if (a.deltaH < -0.5)
    return `Die Aussenluft ist kühler, aber feuchter (${fmt1(ahO)} vs. ${fmt1(ahI)} g/m³).`
  if (Math.abs(a.deltaAH) < 0.3 && Math.abs(a.deltaH) < 0.5)
    return `Innen und aussen sind fast gleich – Lüften bringt v.a. frische Luft (CO₂).`
  // "wärmer" only above the same threshold the verdict chip uses —
  // otherwise chip and sentence could disagree in the 0–0.5 kJ/kg band.
  return `Die Aussenluft ist feuchter (${fmt1(ahO)} vs. ${fmt1(ahI)} g/m³)${a.deltaH > 0.5 ? ` und wärmer (Δh = +${fmt1(a.deltaH)} kJ/kg)` : ''}.`
}

// Pure numbers ("nerd data") — the explaining sentence lives in the hero.
function VentTable({ Tin, RHin, Tout, RHout, elevM = 0 }) {
  const a   = ventilationAssessment(Tin, RHin, Tout, RHout, elevM)
  const dpI = dewPoint(Tin, RHin)
  const dpO = dewPoint(Tout, RHout)
  const ahI = absoluteHumidity(Tin, RHin)
  const ahO = absoluteHumidity(Tout, RHout)

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
    </div>
  )
}

// Geo status + location search

// Location bar. The chip itself is the tap target for changing the place
// (opens the search row — one obvious affordance instead of a bare 🔍 icon
// off to the side). A mode glyph distinguishes "follows your position" (🧭,
// GPS re-acquired on every refresh) from a pinned searched place (📍).
// The search row has explicit submit / cancel and a labeled way back to the
// device position; Escape cancels too. The refresh icon spins while a load
// is running — feedback instead of a mystery dead button.
function GeoBar({ status, location, freshness, locSource, onRefresh, onSearch, onLocate }) {
  const [searching, setSearching] = useState(false)
  const [query, setQuery]         = useState('')
  const inputRef                  = useRef()
  const busy = status === 'loading' || status === 'locating' || status === 'searching'

  useEffect(() => {
    if (searching) inputRef.current?.focus()
  }, [searching])

  function close() { setSearching(false); setQuery('') }
  function submit(e) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    onSearch(q)
    close()
  }

  if (searching) {
    return (
      <form className="geo-bar" onSubmit={submit}>
        <button
          type="button"
          className="geo-icon"
          onClick={() => { close(); onLocate() }}
          title="Meinen Standort verwenden"
          aria-label="Meinen Standort verwenden"
        >🧭</button>
        <input
          ref={inputRef}
          className="geo-search"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') close() }}
          placeholder="Ort suchen…"
          enterKeyHint="search"
        />
        <button type="submit" className="geo-icon" title="Suchen" aria-label="Suchen">🔍</button>
        <button type="button" className="geo-icon" onClick={close} title="Abbrechen" aria-label="Abbrechen">✕</button>
      </form>
    )
  }

  // Chip content + tone per status; freshness folds into the chip instead
  // of its own row. The chip lives in a flex:1 wrapper so its varying text
  // width can't push the refresh icon sideways.
  const modeGlyph = locSource === 'search' ? '📍' : '🧭'
  const modeTitle = locSource === 'search'
    ? 'Fester Ort (gesucht) – tippen zum Ändern'
    : 'Folgt deinem Standort – tippen zum Ändern'
  const [cls, content] =
    status === 'loading'
      // 'loading' = acquiring the device position; 'locating' = fetching
      // weather for already-known coordinates — saying "Standort wird
      // ermittelt" for the latter (e.g. refreshing a searched place) was
      // simply wrong.
      ? ['geo-msg loading', <>Standort wird ermittelt…</>]
      : status === 'locating'
      ? ['geo-msg loading', <>Aktualisiere…</>]
      : status === 'ok' && location
        ? ['geo-ok', <>
            {modeGlyph}{' '}{location.name ?? `${location.lat.toFixed(2)}, ${location.lon.toFixed(2)}`}
            {freshness && <em> · {freshness}</em>}
          </>]
        : status === 'searching'
          ? ['geo-msg loading', <>Suche…</>]
          : status === 'notfound'
            ? ['geo-msg warn', <>Ort nicht gefunden – erneut suchen</>]
            : status === 'error' && freshness
              ? ['geo-msg warn', <>Aktualisierung fehlgeschlagen <em>· {freshness}</em></>]
              : ['geo-msg warn', <>Standort wählen…</>]

  return (
    <div className="geo-bar">
      <span className="geo-status">
        <button
          type="button"
          className={`geo-chip ${cls}`}
          onClick={() => setSearching(true)}
          title={status === 'ok' ? modeTitle : 'Ort suchen'}
        >
          <span className="geo-chip-text">{content}</span>
          <span className="geo-chip-find" aria-hidden="true">🔍</span>
        </button>
      </span>
      {/* Always rendered; disabled + spinning while a load runs so the state
          is visible instead of a mystery dead button. */}
      <button
        className={`geo-icon ${busy ? 'busy' : ''}`}
        onClick={onRefresh}
        disabled={busy}
        title="Neu laden" aria-label="Neu laden"
      >&#8635;</button>
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
  // Altitude-corrected: thinner air above the site attenuates less. The
  // elevation comes from the model grid cell (the same one the temperature
  // describes), folded in unconditionally — a property of the place, like
  // lat/lon, not a user-toggleable factor.
  return clearSkyGHI(solarElevation(ctx.lat, ctx.lon, new Date(h.ts)), ctx.elevation ?? 0)
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
// `primary` = which BASE this derived value is grouped under in the legend
// (a visual link, since e.g. rel. Feuchte depends on both temp and ah but
// reads most naturally as "Feuchte, expressed relatively").
const DERIVED = [
  { key: 'rh',     label: 'rel. Feuchte',   unit: '%',    color: '#67e8f9', dp: 0, deps: ['temp', 'ah'], val: s => s.rh, primary: 'ah' },
  { key: 'effsun', label: 'Sonne effektiv', unit: 'W/m²', color: '#f59e0b', dp: 0, deps: ['csun', 'clouds'], val: s => s.s, primary: 'csun' },
  { key: 'felt',   label: 'Gefühlt',        unit: '°C',   color: '#f472b6', dp: 0, felt: true,
    show: a => a.temp && (a.ah || a.wind || a.csun), primary: 'temp' },
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

// Chart geometry, shared by the render body and the memoized path builder.
// axisW is constant — it used to widen to 34px for a labelled side gutter
// when a single shared unit made ticks meaningful, but that made the plot
// itself resize (and everything scroll-jump) whenever toggling a metric
// changed `single`. Axis labels (when shown) now render inside the
// scrollable plot instead of in a separate reserved column.
const H = 260, padT = 10, padB = 24, padR = 10
const axisW = 6
const innerH = H - padT - padB

// Paths tolerate gaps (null points, e.g. a metric a model doesn't provide) —
// each contiguous run of real points becomes its own subpath. Within a run,
// slight smoothing: a quadratic bezier curving toward the midpoint of each
// consecutive pair rounds off hourly corners without overshooting past the
// data (unlike a full Catmull-Rom spline, which can bulge beyond the points).
function buildLinePath(points, x, yf) {
  let d = ''
  let run = []
  const flushRun = () => {
    if (!run.length) return
    const pts = run.map(i => [x(i), yf(points[i].med)])
    d += `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} `
    for (let i = 1; i < pts.length - 1; i++) {
      const [cx, cy] = pts[i]
      const [nx, ny] = pts[i + 1]
      d += `Q${cx.toFixed(1)} ${cy.toFixed(1)} ${((cx + nx) / 2).toFixed(1)} ${((cy + ny) / 2).toFixed(1)} `
    }
    if (pts.length > 1) {
      const [lx, ly] = pts[pts.length - 1]
      d += `L${lx.toFixed(1)} ${ly.toFixed(1)} `
    }
  }
  for (let i = 0; i < points.length; i++) {
    if (points[i]) run.push(i)
    else { flushRun(); run = [] }
  }
  flushRun()
  return d
}
function buildBandPath(points, x, yf) {
  const idx = points.map((p, i) => (p ? i : -1)).filter(i => i >= 0)
  if (!idx.length) return ''
  let up = ''
  idx.forEach((i, k) => { up += `${k ? 'L' : 'M'}${x(i).toFixed(1)} ${yf(points[i].hi).toFixed(1)} ` })
  let dn = ''
  for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; dn += `L${x(i).toFixed(1)} ${yf(points[i].lo).toFixed(1)} ` }
  return `${up}${dn}Z`
}

// Static explainer under the chart — a constant so the load skeleton can
// reserve its exact height (it renders the same text), keeping the forecast
// box the same size before and after data arrives.
const FORECAST_NOTE = (
  <>
    Basiswerte (gestrichelt) an/aus – abgeleitete Größen (durchgezogen: rel. Feuchte, effektive Sonne, Gefühlt) erscheinen automatisch.
    {' '}„Gefühlt“ erscheint ab Lufttemp. + einem Faktor (Feuchte, Wind oder Sonne) und bezieht nur die aktiven Faktoren ein (ohne Feuchte-Wahl: neutrale 50 %). Die Linienstärke wächst mit der Zahl einfliessender Grössen. Gleiche Einheiten teilen sich eine Skala (direkt vergleichbar). Dunkle Bänder = Nacht. Tippen wählt einen Zeitpunkt; Legende antippen hebt eine Größe hervor; „Spanne“ blendet die Modell-Spanne ein.
  </>
)

// Multi-day forecast chart. BASE inputs are toggled from the shared selector
// above (same `active` state that drives the current-value readout); DERIVED
// outputs appear when their inputs are active. Same units share one scale.
function ForecastChart({ hours, lat, lon, elevation, active, selTs, setSelTs, visible }) {
  const wrapRef = useRef()
  const svgRef = useRef()
  const scrollRef = useRef()
  const scrollPos = useRef(0)
  const scrollRaf = useRef(null)
  const drag = useRef({ active: false, moved: false, startX: 0, startScrollLeft: 0, pointerType: 'mouse' })
  const [dragging, setDragging] = useState(false)
  const [, setRenderTick] = useState(0) // forces a re-render: scroll (bubbles) and the 5s live-mode tick (below) share it
  const [w, setW] = useState(360)
  const [showSpread, setShowSpread] = useState(false)
  const [isolated, setIsolated] = useState(null) // legend key, or null = show all at full strength
  useEffect(() => () => { if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current) }, [])

  // Desktop mouse-drag panning re-renders anyway (via `dragging` toggling),
  // which is what made bubbles reposition there — but native touch/trackpad
  // scrolling never touches React state at all, so on a phone the scroll
  // position ref updated but nothing ever re-rendered to pick it up. rAF-
  // throttled so a fast swipe doesn't spam re-renders. The series data, the
  // SVG path strings, and the night bands are all memoized (on data/width,
  // not scroll), so these re-renders only redo the bubble/label layout.
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
  // "Live" is not just selTs == null: a selected hour that has aged out of
  // the data window also falls back to live mode (see selectingNow below) —
  // the button blinks green then too, so the line must creep along as well.
  const liveMode = selTs == null || !(hours || []).some(h => h.ts === selTs)
  useEffect(() => {
    if (!visible || !liveMode) return
    const id = setInterval(() => setRenderTick(t => t + 1), 5000)
    return () => clearInterval(id)
  }, [visible, liveMode])

  const activeKey = Object.keys(active).filter(k => active[k]).sort().join(',')
  const series = useMemo(() => {
    if (!hours || !hours.length) return null
    return buildSeries(hours, { lat, lon, elevation }, active)
  }, [hours, activeKey, lat, lon, elevation])

  // The expensive per-render pieces — SVG path strings (every series × ~390
  // points) and the night bands (~390 solar-elevation evaluations) — are
  // memoized on data + width, so scroll frames and the 5s live tick only
  // redo the cheap bubble/label layout.
  const paths = useMemo(() => {
    if (!series) return null
    const pxPerHour = Math.max(6, (w - axisW) / 24)
    const x = i => 4 + i * pxPerHour
    const ymap = s => v => padT + (1 - (v - s.yMin) / (s.yMax - s.yMin)) * innerH
    return new Map(series.map(s => [s.key, {
      line: buildLinePath(s.points, x, ymap(s)),
      band: buildBandPath(s.points, x, ymap(s)),
    }]))
  }, [series, w])

  // Night shading gives free temporal context (that peak is midday, this dip
  // is 3am) without adding another line or number. Sun-below-horizon per hour
  // (using the true UTC instant, like clearSkyAt), collapsed into contiguous
  // night runs so each becomes one rect instead of one per hour. Stored as
  // hour indices; the x-positions are applied at render time.
  const nightBands = useMemo(() => {
    if (!hours || !hours.length) return []
    const bands = []
    let start = null
    for (let i = 0; i <= hours.length; i++) {
      const isNight = i < hours.length && solarElevation(lat, lon, new Date(hours[i].ts)) <= 0
      if (isNight && start === null) start = i
      if (!isNight && start !== null) { bands.push([start, i]); start = null }
    }
    return bands
  }, [hours, lat, lon])

  // If the isolated metric's series disappears (its toggle switched off, or a
  // dependency dropped), clear the isolation instead of keeping the stale key
  // around — otherwise re-enabling that toggle later would surprisingly come
  // back pre-isolated.
  useEffect(() => {
    if (isolated != null && series && !series.some(s => s.key === isolated)) {
      setIsolated(null)
    }
  }, [series, isolated])

  // Before data arrives, hold the box at the same height it will have once
  // loaded (fixed-height plot + reserved readout + the real note) so the
  // chart doesn't pop in and shove everything below it down.
  if (!series) {
    return (
      <div className="forecast" ref={wrapRef}>
        <div className="forecast-head">
          <span className="section-name muted">Vorschau</span>
        </div>
        <div className="fc-days fc-days-skeleton" />
        <div className="fc-plot-skeleton"><span className="fc-loading">Vorschau lädt…</span></div>
        <div className="fc-readout-skeleton" />
        <p className="forecast-note">{FORECAST_NOTE}</p>
      </div>
    )
  }

  // Groups each derived value under its base (rh->ah, effsun->csun, felt->temp)
  // for the legend's 2-column layout and the tap-to-isolate highlight below.
  const legendGroups = (() => {
    const bases = series.filter(s => !s.derived)
    const deriveds = series.filter(s => s.derived)
    const groups = bases.map(b => ({ base: b, children: deriveds.filter(d => d.primary === b.key) }))
    const orphans = deriveds.filter(d => !bases.some(b => b.key === d.primary))
    if (orphans.length) groups.push({ base: null, children: orphans })
    return groups
  })()

  // Clicking a legend row isolates its whole group (base + derived siblings)
  // — dims every other line/bubble so you can focus on just that metric
  // (and what it feeds into) without losing any of the others' toggles.
  const isolatedGroup = isolated != null
    ? legendGroups.find(g => g.base?.key === isolated || g.children.some(c => c.key === isolated))
    : null
  const highlightKeys = isolatedGroup
    ? new Set([isolatedGroup.base?.key, ...isolatedGroup.children.map(c => c.key)].filter(Boolean))
    : null
  const dimmed = s => highlightKeys != null && !highlightKeys.has(s.key)

  const units = [...new Set(series.map(s => s.unit))]
  const single = units.length === 1
  const n = hours.length

  const pxPerHour = Math.max(6, (w - axisW) / 24)
  const chartW = Math.round((n - 1) * pxPerHour + padR + 4)
  const x = i => 4 + i * pxPerHour
  const ymap = s => v => padT + (1 - (v - s.yMin) / (s.yMax - s.yMin)) * innerH

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

  // Coarse per-day overview strip: min/max of the "hero" series (Gefühlt
  // when shown, else air temp, else whatever is first) per calendar day.
  // The detailed graph answers "how does tonight feel?"; this answers
  // "which day next week is the hot one?" at a glance — tapping a day
  // scrolls the graph there.
  const heroSeries = series.find(s => s.key === 'felt') ?? series.find(s => s.key === 'temp') ?? series[0]
  const dayTiles = days.map((d, k) => {
    const end = k + 1 < days.length ? days[k + 1].i : n
    let lo = Infinity, hi = -Infinity
    if (heroSeries) {
      for (let i = d.i; i < end; i++) {
        const p = heroSeries.points[i]
        if (!p) continue
        lo = Math.min(lo, p.med); hi = Math.max(hi, p.med)
      }
    }
    return { i: d.i, date: d.date, lo, hi, ok: Number.isFinite(lo) }
  })

  const nowIdx = nowHourIndex(hours)
  const nowFrac = nowFraction(hours, nowIdx)
  const xNow = x(nowIdx) + nowFrac * pxPerHour
  // ceil, not round: the remaining window shrinks through the day (16 days
  // minus the hours already past today), and rounding made the heading
  // wobble between "15-" and "16-Tage-Vorschau" depending on the time.
  const spanDays = Math.ceil((n - nowIdx) / 24)

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
  // Place-local wall clock, not the phone's: in live mode interpolate "now"
  // from the forecast's own hourly wall-clock (hours[].time carries the
  // location's local time, preserved digit-for-digit) by the same nowFrac
  // the Jetzt line uses — so the legend reads the selected location's local
  // time, matching the graph's hour labels, even in another timezone.
  const selDate = selectingNow
    ? new Date(hours[nowIdx].time.getTime() + nowFrac * 3600000)
    : hours[si].time
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
    // While a group is isolated, bubbles for everything else are dropped
    // entirely (not just dimmed) — the whole point is decluttering the busy
    // spots, and a faint unreadable bubble is worse than no bubble.
    const items = series.map(s => {
      if (dimmed(s)) return null
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
  // pointercancel = the browser took the gesture over (native touch pan) —
  // never a deliberate tap, so end the drag WITHOUT picking. Routing it to
  // onUp used to select a point on scroll flicks too fast to cross the
  // movement threshold before the takeover.
  function onCancel() {
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
        <div className="forecast-head-actions">
          <button
            type="button"
            className={`fc-spread-btn ${showSpread ? 'active' : ''}`}
            onClick={() => setShowSpread(v => !v)}
            title={showSpread ? 'Modell-Spanne ausblenden' : 'Modell-Spanne einblenden'}
            aria-pressed={showSpread}
          >
            Spanne
          </button>
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
      </div>

      <div className="fc-days">
        {dayTiles.map(t => (
          <button
            key={t.i}
            type="button"
            className="fc-day"
            onClick={() => { if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, x(t.i) - 4) }}
            title={`Zum ${WEEKDAY[t.date.getDay()]} ${t.date.getDate()}.${t.date.getMonth() + 1}. scrollen`}
          >
            <span className="fc-day-name">{WEEKDAY[t.date.getDay()]} {t.date.getDate()}.</span>
            <span className="fc-day-range">
              {t.ok ? <>{Math.round(t.lo)}°<em>/{Math.round(t.hi)}°</em></> : '–'}
            </span>
          </button>
        ))}
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
            onPointerCancel={onCancel}
            className={dragging ? 'dragging' : ''}
            style={{ touchAction: 'pan-x' }}
          >
            {nightBands.map(([s, e], k) => (
              <rect key={`night${k}`} x={x(s)} y={padT} width={x(e) - x(s)} height={innerH} className="fc-night" />
            ))}
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

            {showSpread && series.map(s => (
              <path key={`b${s.key}`} d={paths.get(s.key).band} fill={s.color}
                opacity={dimmed(s) ? 0.04 : 0.13} stroke="none" />
            ))}
            {series.map(s => (
              <path key={`l${s.key}`} d={paths.get(s.key).line} fill="none" stroke={s.color}
                strokeWidth={lineWidth(s.inputs)} strokeDasharray={s.derived ? '' : '4 2.5'}
                opacity={dimmed(s) ? 0.15 : 1} style={{ transition: 'opacity 0.15s' }} />
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
          metric, laid out in 2 columns (column-flow, so a base + its derived
          rows below it stay together as a group via break-inside: avoid
          rather than splitting across columns). Clicking a row isolates its
          group, dimming everything else so you can focus on one metric
          at a time. */}
      <div className="fc-readout">
        <div className="fc-rtime">{dateStr} {hhmm}</div>
        <div className="fc-rlist">
          {(() => {
            const row = s => {
              const p = pointAt(s); if (!p) return null
              const f = v => (s.dp ? v.toFixed(s.dp) : String(Math.round(v)))
              const toggleIso = () => setIsolated(v => (v === s.key ? null : s.key))
              return (
                <div key={s.key} className={`fc-rrow ${dimmed(s) ? 'fc-rrow-dim' : ''}`}
                  role="button" tabIndex={0} aria-pressed={isolated === s.key}
                  onClick={toggleIso}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleIso() } }}>
                  <i className="mdot" style={{ background: s.color }} />
                  <span className="fc-rrow-label">{s.label}</span>
                  {showSpread && <span className="fc-rrow-range">{f(p.lo)}–{f(p.hi)}</span>}
                  <span className="fc-rrow-value">{f(p.med)} {s.unit}</span>
                </div>
              )
            }
            const groupEl = (g, gi) => (
              <div key={g.base ? g.base.key : `orphans${gi}`} className="fc-rgroup">
                {g.base && row(g.base)}
                {g.children.length > 0 && (
                  <div className="fc-rgroup-children">{g.children.map(d => row(d))}</div>
                )}
              </div>
            )
            // Explicit, deterministic two-column balance (greedy: each group to
            // the currently-shorter column). CSS multicolumn balanced
            // unpredictably at narrow widths, so the box height wasn't stable;
            // here the taller column is always ≤ half the rows, exactly what
            // the reserved min-height is sized for.
            const cols = [[], []]
            const load = [0, 0]
            legendGroups.forEach((g, gi) => {
              const rows = 1 + g.children.length
              const c = load[0] <= load[1] ? 0 : 1
              cols[c].push(groupEl(g, gi)); load[c] += rows
            })
            return cols.map((col, ci) => <div key={ci} className="fc-rcol">{col}</div>)
          })()}
        </div>
      </div>

      <p className="forecast-note">{FORECAST_NOTE}</p>
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

// The one headline number: UTCI folded from whichever factors are active,
// AT the time selected in the graph (live "now" by default) — always in sync
// with the graph's Gefühlt bubble/legend value. `when` is the small time
// label above the value ("Jetzt", green+live, or the selected date/time).
// ‹/› step the selection hour by hour (scrubbing without precise graph
// taps); tapping the number/label while a selection is active jumps back
// to live. A soft radial glow behind the number carries the stress-category
// color, so "pleasant" and "heat warning" differ at a glance, not just in
// the digits. Borderless — no card background.
function FeltNow({ point, airTemp, dp, when, live, onStep, onJumpLive }) {
  const schwuel = dp != null && dp >= 18 ? 'stark' : dp != null && dp >= 16 ? 'spürbar' : null
  const seek = !live && onJumpLive
  const whenEl = (
    <div className={`felt-when ${live ? 'live' : ''}`}>
      {live && <i className="fc-now-dot" />}{when}{seek ? ' · tippen für Jetzt' : ''}
    </div>
  )
  const valRow = inner => (
    <div className="felt-val-row">
      {onStep && (
        <button type="button" className="felt-step" aria-label="Eine Stunde zurück"
          onClick={e => { e.stopPropagation(); onStep(-1) }}>‹</button>
      )}
      {inner}
      {onStep && (
        <button type="button" className="felt-step" aria-label="Eine Stunde vor"
          onClick={e => { e.stopPropagation(); onStep(1) }}>›</button>
      )}
    </div>
  )
  const rootProps = {
    className: `felt-now ${seek ? 'seekable' : ''}`,
    onClick: seek ? onJumpLive : undefined,
    title: seek ? 'Zurück zu Jetzt' : undefined,
  }

  // No usable outdoor reading at all (no data yet AND the sliders are on a
  // manual what-if override) — show a placeholder, not a made-up number.
  // The fallback branches keep the category line as an empty spacer so the
  // number sits at the same y in every state — toggling "Gefühlt" on/off or
  // waiting for data must not move it (the felt-top centers its content).
  if (airTemp == null) {
    return (
      <div {...rootProps}>
        {whenEl}
        {valRow(<div className="ap-val">–{' '}°C</div>)}
        <div className="ap-cat">&nbsp;</div>
        <p className="felt-hint">Warte auf Wetterdaten…</p>
      </div>
    )
  }
  if (!point) {
    return (
      <div {...rootProps}>
        {whenEl}
        {valRow(<div className="ap-val">{fmt1(airTemp)}{' '}°C</div>)}
        <div className="ap-cat">&nbsp;</div>
        <p className="felt-hint">Lufttemperatur — wähle oben mind. einen weiteren Faktor für „Gefühlt“.</p>
      </div>
    )
  }
  const cat  = utciCategory(point.med)
  const color = TEMP_COLOR[colorClass(point.med)]
  const diff = point.med - airTemp
  return (
    <div {...rootProps} style={{ '--felt-color': color, '--felt-glow': color }}>
      {whenEl}
      {valRow(<div className="ap-val">{fmt1(point.med)}{' '}°C</div>)}
      <div className="ap-cat">{cat.label}</div>
      <p className="felt-hint">
        {fmt1(point.lo)}–{fmt1(point.hi)}°C je nach Modell · {diff >= 0 ? '+' : ''}{fmt1(diff)}°C vs. Luft
        {schwuel && <> <span className="schwuele-chip">💧 Schwüle {schwuel} · Tp {fmt1(dp)}°C</span></>}
      </p>
    </div>
  )
}

function FeltTab({ outTemp, outRH, outManual, hours, wxMeta, gridPlace, lat, lon, selTs, setSelTs, visible }) {
  // Persisted like the tab, sliders and location — a reload shouldn't reset
  // the metric selection while remembering everything else.
  const [active, setActive] = usePersistentState('metrics', { temp: true, ah: true, wind: true, csun: true, clouds: true })
  const toggle = key => setActive(a => ({ ...a, [key]: !a[key] }))

  const grid = wxMeta?.grid
  // Site elevation (from the model grid cell — the same terrain the
  // temperature data describes). Folded into the clear-sky sun model
  // unconditionally: altitude is intrinsic to the place, like lat/lon.
  const elevation = grid?.elevation ?? 0
  const feltDef = DERIVED.find(d => d.felt)
  const nowIdx  = hours && hours.length ? nowHourIndex(hours) : null

  // The headline follows the graph selection: a tapped hour shows THAT
  // hour's felt temp (same value as the graph's Gefühlt bubble/legend);
  // live mode ("now", the default — also the fallback when a selection
  // aged out of the data window) shows the interpolated current moment.
  // Air-temp baseline, Schwüle dew point and the graph readout all read
  // the same selected instant, so nothing on this tab ever disagrees.
  // Before the forecast arrives, the sliders' persisted values are the only
  // stand-in — but NOT when the user has manually overridden them in the
  // Lüften tab for a what-if scenario: presenting e.g. an experimental -20°C
  // as the real outdoor temperature would be plain wrong. Show a placeholder
  // until real data lands instead.
  const selHourIdx = selTs != null && hours ? hours.findIndex(h => h.ts === selTs) : -1
  const selHour = selHourIdx === -1 ? null : hours[selHourIdx]

  const nv      = nowReading(hours)
  const airTemp = selHour ? selHour.temp     : nv ? nv.temp     : (outManual ? null : outTemp)
  const airRH   = selHour ? selHour.humidity : nv ? nv.humidity : (outManual ? null : outRH)
  const dp      = airTemp != null ? dewPoint(airTemp, airRH) : null

  const feltShown = nowIdx != null && feltDef.show(active)
  const selPoint = feltShown
    ? selHour
      ? feltPoints([selHour], { lat, lon, elevation }, active)[0]
      : interpPoint(
          feltPoints([hours[nowIdx]], { lat, lon, elevation }, active)[0],
          hours[nowIdx + 1] ? feltPoints([hours[nowIdx + 1]], { lat, lon, elevation }, active)[0] : null,
          nowFraction(hours, nowIdx)
        )
    : null
  // Small time label above the value: the location's wall-clock date/time of
  // the tapped hour, or plain "Jetzt" while live (no minutes — this tab only
  // re-renders with data refreshes, so a printed clock time would go stale).
  const when = selHour
    ? `${WEEKDAY[selHour.time.getDay()]} ${selHour.time.getDate()}.${selHour.time.getMonth() + 1}. ${String(selHour.time.getHours()).padStart(2, '0')}:00`
    : 'Jetzt'

  // ‹/› scrub the selection one hour at a time; from live mode, › steps to
  // the next whole hour and ‹ to the previous one (relative to the hour
  // containing "now"). Clamped to the data window.
  const stepHour = dir => {
    if (!hours || !hours.length) return
    const base = selHour ? selHourIdx : nowIdx
    const idx = Math.max(0, Math.min(hours.length - 1, base + dir))
    setSelTs(hours[idx].ts)
  }
  const ens = ensembleInfo(hours)

  return (
    <>
      <div className="felt-top">
        <FeltNow point={selPoint} airTemp={airTemp} dp={dp} when={when} live={!selHour}
          onStep={hours && hours.length ? stepHour : undefined}
          onJumpLive={() => setSelTs(null)} />
      </div>

      <MetricToggles active={active} onToggle={toggle} />

      <ForecastChart hours={hours} lat={lat} lon={lon} elevation={elevation} active={active}
        selTs={selTs} setSelTs={setSelTs} visible={visible} />

      <details className="section-card formula-card">
        <summary className="section-summary">
          <span className="section-name muted">Formeln & Methodik</span>
        </summary>
        <div className="section-body formula-body">
          <p><strong>UTCI</strong> – Bröde et al. (2012). Universeller thermischer Klimaindex: 210-Term-Polynom 6. Grades in Lufttemperatur, Windgeschwindigkeit, mittlerer Strahlungstemperatur und Dampfdruck. Windlimit: 0.5–17 m/s.</p>
          <p><strong>Schatten vs. Sonne</strong> – die beiden Karten zeigen die Spanne: Schatten ohne Strahlung (Tmrt = Luft), Sonne bei klarem Himmel. Das Klarhimmel-Maximum kommt aus dem Sonnenstand (NOAA-Algorithmus: Datum, Uhrzeit, Breiten- &amp; Längengrad) und dem Haurwitz-Modell – im Winter und abends schwächer, nachts null.</p>
          <p><strong>Höhenlage</strong> – fliesst ohne Option immer ein, da sie zum Ort gehört wie Länge und Breite: Die Klarhimmel-Strahlung ist höhenkorrigiert (dünnere Atmosphäre → weniger Streuung und Absorption, empirisch ca. +8 % pro 1000 m), die Enthalpie im Lüften-Tab rechnet mit dem barometrischen Luftdruck der Gitterzellen-Höhe. Die Temperatur selbst ist bereits vom Wettermodell auf die Geländehöhe skaliert (~0.65 K/100 m).</p>
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

// Big-picture headline per verdict class — the tab's primary answer.
const VENT_HERO = {
  'Kondens.gefahr':  { title: 'Fenster zu lassen',  icon: '🚫' },
  'Empfohlen':       { title: 'Jetzt lüften',        icon: '🪟' },
  'Sinnvoll':        { title: 'Lüften lohnt sich',   icon: '🪟' },
  'Abwägen':         { title: 'Abwägen',             icon: '🤔' },
  'Kein Effekt':     { title: 'Kaum Effekt',         icon: '😐' },
  'Nicht empfohlen': { title: 'Fenster zu lassen',   icon: '🚫' },
}

// Hour-by-hour verdict strip for the next 24 h — answers "if not now, when?"
// at a glance instead of a single text line. Each cell is colored by the
// same ventVerdict the hero uses (with the forecast outdoor conditions), and
// the best window found by bestVentWindow is emphasized.
function VentTimeline({ hours, Tin, RHin, win, elevM = 0 }) {
  const now = Date.now()
  const fut = hours.filter(h => h.ts + 3600000 > now).slice(0, 24)
  // Fully stale data (no future hours): keep the card's exact shape with an
  // empty strip rather than returning null and collapsing it.
  if (!fut.length) {
    return (
      <div className="vent-timeline">
        <div className="vt-title section-name muted">Nächste 24 h</div>
        <div className="vt-strip vt-strip-skeleton" />
        <div className="vt-labels" />
      </div>
    )
  }
  const inWin = h => win && h.time >= win.start && h.time <= win.end
  return (
    <div className="vent-timeline">
      <div className="vt-title section-name muted">Nächste 24 h</div>
      <div className="vt-strip">
        {fut.map(h => {
          const v = ventVerdict(Tin, RHin, h.temp, h.humidity, elevM)
          return (
            <div
              key={h.ts}
              className={`vt-cell ${v.cls} ${inWin(h) ? 'best' : ''}`}
              title={`${String(h.time.getHours()).padStart(2, '0')} Uhr: ${v.short} (${fmt1(h.temp)} °C, ${Math.round(h.humidity)} %)`}
            />
          )
        })}
      </div>
      <div className="vt-labels">
        {fut.map((h, i) => (
          <span key={h.ts} className="vt-lab">{i % 6 === 0 ? `${String(h.time.getHours()).padStart(2, '0')}` : ''}</span>
        ))}
      </div>
    </div>
  )
}

// Ventilation tab (indoor + outdoor: temp + humidity only)

function LueftenTab({
  inTemp, setInTemp, inRH, setInRH, outTemp, setOutTemp, outRH, setOutRH,
  setOutManual, outManual, onResetOutdoor, hours, graphPoint, elevation = 0,
}) {
  const verdict   = ventVerdict(inTemp, inRH, outTemp, outRH, elevation)
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

  // What opening the windows would actually DO, as outcome chips. Capped at
  // two (moisture + heat) so the chip area stays within its reserved height:
  // condensation dominates everything else, and "manuelle Aussenwerte" lives
  // in the Aussen header, not here.
  const a = ventilationAssessment(inTemp, inRH, outTemp, outRH, elevation)
  const effects = []
  if (a.condensationRisk) {
    effects.push({ text: '⚠ Kondensationsgefahr', cls: 'bad' })
  } else {
    if (Math.abs(a.deltaAH) >= 0.3) {
      effects.push({ text: `Feuchte ${a.deltaAH < 0 ? '↓' : '↑'} ${fmt1(Math.abs(a.deltaAH))} g/m³`, cls: a.deltaAH < 0 ? 'good' : 'bad' })
    }
    if (Math.abs(a.deltaH) >= 0.5) {
      effects.push({ text: `Wärmelast ${a.deltaH < 0 ? '↓' : '↑'} ${fmt1(Math.abs(a.deltaH))} kJ/kg`, cls: a.deltaH < 0 ? 'good' : 'bad' })
    }
    if (!effects.length) effects.push({ text: 'nur Frischluft (CO₂)', cls: 'neutral' })
  }

  const hero = VENT_HERO[verdict.short] ?? { title: verdict.short, icon: '' }

  return (
    <>
      {/* 1 — THE ANSWER. What the user came for, first and unmissable. */}
      <div className={`vent-hero ${verdict.cls}`}>
        <div className="vh-verdict">{hero.icon} {hero.title}</div>
        <p className="vh-reason">{ventReason(inTemp, inRH, outTemp, outRH, elevation)}</p>
        <div className="vh-chips">
          {effects.map(e => (
            <span key={e.text} className={`verdict-chip ${e.cls}`}>{e.text}</span>
          ))}
        </div>
      </div>

      {/* 2 — IF NOT NOW, WHEN? Hour strip beats a single text line. Always
          rendered (skeleton while the forecast loads) so it doesn't pop in. */}
      <div className="section-card vent-when">
        {hours
          ? <VentTimeline hours={hours} Tin={inTemp} RHin={inRH} win={win} elevM={elevation} />
          : <>
              <div className="vt-title section-name muted">Nächste 24 h</div>
              <div className="vt-strip vt-strip-skeleton" />
              <div className="vt-labels" />
            </>}
        {!hours
          ? <p className="vent-window neutral">Vorschau lädt…</p>
          : win
            ? <p className="vent-window good">
                🪟 Bestes Fenster: <strong>{fmtSlot(win.start, win.end)}</strong> –
                {' '}bringt das Raumklima näher an den Wohlfühlbereich (~20–24°C, 40–60%).
              </p>
            : comfyNow
              ? <p className="vent-window neutral">
                  Innenklima liegt bereits im Wohlfühlbereich (~20–24°C, 40–60%) – Lüften v.a. für frische Luft.
                </p>
              : <p className="vent-window neutral">
                  In den nächsten 24 h bringt die Aussenluft das Raumklima dem Wohlfühlbereich nicht näher (z.&nbsp;B. im Winter zu kalt).
                </p>}
      </div>

      {/* 3 — THE INPUTS. Indoor is the only thing the app can't know — always
          visible, no collapsible to hunt through. Outdoor is live data with a
          clearly-marked manual what-if mode. */}
      <div className="section-card vent-inputs">
        <div className="vent-inputs-head">
          <span className="section-name">Innen</span>
          <span className="summary-chips">
            <Chip cls="felt">≈ {fmt1(feltIn)} °C</Chip>
          </span>
        </div>
        <div className="vent-inputs-body">
          <Slider label="Temperatur"       value={inTemp} onChange={setInTemp} min={10} max={40}  step={0.5} unit="°C" />
          <Slider label="Luftfeuchtigkeit" value={inRH}   onChange={setInRH}   min={1}  max={100} step={1}   unit="%" />
        </div>
      </div>

      <details className={`section-card ${outManual ? 'card-manual' : ''}`}>
        <summary className="section-summary">
          <span className="section-name">Aussen</span>
          <span className="summary-chips">
            <Chip>{outTemp}{' '}°C</Chip>
            <Chip>{outRH}{' '}%</Chip>
            <Chip cls="felt">≈ {fmt1(feltOut)} °C</Chip>
          </span>
        </summary>
        <div className="section-body">
          {/* Both actions are always present and just enable/disable — like
              the graph's always-visible "Jetzt" button — so the panel height
              never jumps as they'd otherwise appear/disappear. */}
          <div className="vent-actions">
            <button type="button" className="graph-import" onClick={onResetOutdoor} disabled={!outManual}>
              ↺ Zurück zu Live-Daten
            </button>
            <button type="button" className="graph-import" onClick={importGraph} disabled={!canImport}>
              {canImport
                ? `⟳ Graphpunkt übernehmen (${graphPoint.label}: ${fmt1(graphPoint.temp)} °C · ${gpRH} %)`
                : '⟳ Graphpunkt übernehmen'}
            </button>
          </div>
          <Slider label="Temperatur"       value={outTemp} onChange={setOutTempManual} min={-30} max={50}  step={0.5} unit="°C" />
          <Slider label="Luftfeuchtigkeit" value={outRH}   onChange={setOutRHManual}   min={1}   max={100} step={1}   unit="%" />
        </div>
      </details>

      {/* 4 — NERD DATA. The full psychrometrics, opt-in. */}
      <details className="section-card">
        <summary className="section-summary">
          <span className="section-name muted">Details (Physik)</span>
        </summary>
        <div className="section-body">
          <VentTable Tin={inTemp} RHin={inRH} Tout={outTemp} RHout={outRH} elevM={elevation} />
          <p className="vent-note">
            Wind und Sonne fliessen hier bewusst nicht ein: Sie ändern nicht, <em>ob</em> die
            Aussenluft trockener oder kühler ist. Wind beschleunigt zwar den Luftaustausch
            (schnelleres Durchlüften), die Empfehlung selbst hängt aber nur von Temperatur und
            Feuchte beider Seiten ab.
          </p>
        </div>
      </details>
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
  // Last successful weather is cached in localStorage: a cold start (offline,
  // flaky network) hydrates from it and shows stale-but-labelled data — the
  // freshness chip says "vor X Std" — instead of an empty placeholder until
  // the first fetch succeeds. Dates are revived from their ISO strings.
  const wxCache = (() => {
    try { return JSON.parse(localStorage.getItem('wxCache')) } catch { return null }
  })()
  const [hours,       setHours]       = useState(() =>
    wxCache?.hours ? wxCache.hours.map(h => ({ ...h, time: new Date(h.time) })) : null)
  // Graph selection, lifted so both tabs share it. Anchored to the selected
  // hour's timestamp (not its array index!) — hours is a sliding window that
  // shifts forward with every refetch, so an index can silently point at a
  // different hour (or vanish) once the window moves. null → "now".
  const [selTs,       setSelTs]       = useState(null)
  const [wxMeta,      setWxMeta]      = useState(wxCache?.wxMeta ?? null) // { sources, spread }
  const [gridPlace,   setGridPlace]   = useState(null) // reverse-geocoded name of wxMeta.grid
  const [updatedAt,   setUpdatedAt]   = useState(wxCache?.updatedAt ?? null) // ms of last successful fetch
  const [nowTick,     setNowTick]     = useState(0)    // forces the freshness label to refresh

  // Keep the cache current (hours dominates the payload; meta rides along).
  useEffect(() => {
    if (!hours) return
    try { localStorage.setItem('wxCache', JSON.stringify({ hours, wxMeta, updatedAt })) } catch {}
  }, [hours, wxMeta, updatedAt])

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

  // `silent` = a background re-acquire (auto-refresh, or catching up on a
  // position change after mount): don't flip the status chip to "wird
  // ermittelt…" while data is showing, and if geolocation fails, keep
  // whatever is on screen instead of downgrading to "nicht verfügbar" —
  // a background failure shouldn't nuke a working display.
  async function loadWeather(silent = false) {
    if (!navigator.geolocation) { if (!silent) setGeoStatus('denied'); return }
    if (!silent) setGeoStatus('loading')
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        if (!silent) setGeoStatus('locating')
        try {
          const w = await fetchCurrentWeather(coords.latitude, coords.longitude)
          applyWeather(w)
          // A failed hourly fetch must not go silent: the location name would
          // update while the graph kept showing the previous place's forecast.
          fetchHourlyForecast(coords.latitude, coords.longitude).then(setHours).catch(() => setGeoStatus('error'))
          const name = await reverseGeocode(coords.latitude, coords.longitude).catch(() => null)
          setGeoLocation({ lat: coords.latitude, lon: coords.longitude, name })
          setLocSource('gps')
          setGeoStatus('ok')
        } catch { if (!silent) setGeoStatus('error') }
      },
      () => { if (!silent) setGeoStatus('denied') }
    )
  }

  // Refetch fresh weather for a known location (no geolocation prompt).
  async function refetchFor(la, lo, name) {
    setGeoStatus('locating')
    try {
      const w = await fetchCurrentWeather(la, lo)
      applyWeather(w)
      fetchHourlyForecast(la, lo).then(setHours).catch(() => setGeoStatus('error'))
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
      fetchHourlyForecast(loc.lat, loc.lon).then(setHours).catch(() => setGeoStatus('error'))
      setGeoLocation(loc)
      setLocSource('search')
      setGeoStatus('ok')
    } catch { setGeoStatus('error') }
  }

  // Refresh: re-acquire the device position when the location came from
  // location services (following the user as they move); for a searched
  // location just refetch its data — never switch back to the device
  // position uninvited. `silent` marks background refreshes (see loadWeather).
  function refresh(silent = false) {
    if (locSource === 'search' && geoLocation?.lat != null) {
      refetchFor(geoLocation.lat, geoLocation.lon, geoLocation.name)
    } else {
      loadWeather(silent)
    }
  }

  // On mount: if we have a saved location, refresh its weather immediately
  // (fast first paint, keeping persisted personal/indoor inputs); when that
  // location came from location services, ALSO silently re-acquire the real
  // device position — the saved coords may be from wherever the app was last
  // used, and GPS mode means "where I am", not "where I was".
  useEffect(() => {
    if (geoLocation && geoLocation.lat != null) {
      prefilledRef.current = true // don't overwrite restored indoor temp
      refetchFor(geoLocation.lat, geoLocation.lon, geoLocation.name)
      if (locSource !== 'search') loadWeather(true)
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
      // Background refresh: silent, so the status chip doesn't flicker to
      // "wird ermittelt…" every 5 minutes — in GPS mode this re-acquires the
      // device position each time, so the app follows the user as they move.
      if (document.visibilityState === 'visible') refresh(true)
    }, REFRESH_MS)
    function refreshIfStale() {
      if (document.visibilityState === 'visible' &&
          updatedAt && Date.now() - updatedAt > REFRESH_MS) {
        refresh(true)
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
          locSource={locSource}
          onRefresh={() => refresh(false)} /* explicit: the click event must not land in `silent` */
          onSearch={searchWeather}
          onLocate={() => loadWeather(false)} /* explicit: loud — user asked for their position */
        />
      </div>

      {/* Both tabs stay mounted (inactive one hidden) so the graph selection,
          toggles and scroll position survive switching back and forth. */}
      <main>
        <div style={{ display: tab === 'felt' ? undefined : 'none' }}>
          <FeltTab
            outTemp={outTemp}
            outRH={outRH}
            outManual={outManual}
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
            elevation={wxMeta?.grid?.elevation ?? 0}
          />
        </div>
      </main>
    </div>
  )
}
