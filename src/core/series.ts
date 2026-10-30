// Forecast series: which metrics exist, how they derive from each other, and
// their per-hour ensemble statistics. Pure, no DOM. Labels are translated in
// the UI (i18n `metrics.<key>`), so definitions here carry only keys.
import { absoluteHumidity, clearSkyGHI, meanRadiantTemp, solarElevation, utci } from './formulas';
import { nowHourIndex, type StatPoint } from './time';
import { MODEL_INFO, type Hour, type ModelKey, type Sample } from './weather';

export type BaseKey = 'temp' | 'ah' | 'wind' | 'csun' | 'clouds';
export type DerivedKey = 'rh' | 'effsun' | 'felt';
export type SeriesKey = BaseKey | DerivedKey;
export type Active = Record<BaseKey, boolean>;

export interface PlaceCtx {
  lat: number;
  lon: number;
  elevation?: number | null;
}

// median / min / max of an array (for the confidence band)
export function stats(arr: readonly (number | null | undefined)[]): StatPoint | null {
  const a = arr.filter((x): x is number => x != null && !Number.isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return {
    med: a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2,
    lo: a[0],
    hi: a[a.length - 1],
  };
}

// Clear-sky irradiance [W/m²] at the instant `h.ts` — matches the instantaneous
// shortwave_radiation_instant used for "real" sun, so both (and the instant
// temp/RH/wind) describe the same moment T. No interval/instant mismatch.
// Altitude-corrected: the elevation comes from the model grid cell (the same
// one the temperature describes), folded in unconditionally — a property of
// the place, like lat/lon, not a user-toggleable factor.
export function clearSkyAt(h: Hour, ctx: PlaceCtx): number {
  return clearSkyGHI(solarElevation(ctx.lat, ctx.lon, new Date(h.ts)), ctx.elevation ?? 0);
}

interface MetricDef {
  key: SeriesKey;
  unit: string;
  color: string;
  /** Decimals in the readout. */
  dp: number;
  /** Reads a model sample (ensemble statistics). */
  val?: (s: Sample) => number | null;
  /** Deterministic per-hour value (no ensemble spread). */
  hourVal?: (h: Hour, ctx: PlaceCtx) => number;
}
export interface BaseDef extends MetricDef {
  key: BaseKey;
  icon: string;
}
export interface DerivedDef extends MetricDef {
  key: DerivedKey;
  /** Base keys that must all be active for the line to appear. */
  deps?: BaseKey[];
  show?: (a: Active) => boolean;
  felt?: boolean;
  /** Which BASE it is grouped under in the legend. */
  primary: BaseKey;
}

// A derivation graph, not a flat list. The user toggles BASE inputs; DERIVED
// outputs appear automatically once their input bases are active. No mediator
// lines, no hardcoded shade/sun pair — "Gefühlt" is one line that composes
// whatever bases are on.
export const BASES: readonly BaseDef[] = [
  { key: 'temp', icon: '🌡️', unit: '°C', color: '#fb923c', dp: 0, val: (s) => s.t },
  {
    key: 'ah',
    icon: '💧',
    unit: 'g/m³',
    color: '#22d3ee',
    dp: 1,
    val: (s) => absoluteHumidity(s.t, s.rh),
  },
  { key: 'wind', icon: '💨', unit: 'km/h', color: '#94a3b8', dp: 0, val: (s) => s.w },
  { key: 'csun', icon: '☀️', unit: 'W/m²', color: '#fbbf24', dp: 0, hourVal: clearSkyAt },
  { key: 'clouds', icon: '☁️', unit: '%', color: '#cbd5e1', dp: 0, val: (s) => s.c },
];

// Gefühlt needs only temp: humidity is intrinsic to the air (always folded into
// UTCI from the forecast), while Wind and Sonne are optional exposure factors
// that refine it when active. Derived colors are tints of their base metric so
// related lines read as one family instead of adding new hues. `primary`: e.g.
// rel. humidity depends on both temp and ah but reads most naturally as
// "humidity, expressed relatively".
export const DERIVED: readonly DerivedDef[] = [
  {
    key: 'rh',
    unit: '%',
    color: '#67e8f9',
    dp: 0,
    deps: ['temp', 'ah'],
    val: (s) => s.rh,
    primary: 'ah',
  },
  {
    key: 'effsun',
    unit: 'W/m²',
    color: '#f59e0b',
    dp: 0,
    deps: ['csun', 'clouds'],
    val: (s) => s.s,
    primary: 'csun',
  },
  {
    key: 'felt',
    unit: '°C',
    color: '#f472b6',
    dp: 0,
    felt: true,
    primary: 'temp',
    show: (a) => a.temp && (a.ah || a.wind || a.csun),
  },
];

export const FELT_DEF = DERIVED.find((d) => d.felt) as DerivedDef;

export const ALL_ON: Active = { temp: true, ah: true, wind: true, csun: true, clouds: true };

export interface Scale {
  yMin: number;
  yMax: number;
  step: number;
}

export interface Series extends Scale {
  key: SeriesKey;
  unit: string;
  color: string;
  dp: number;
  derived: boolean;
  primary?: BaseKey;
  /** Number of base inputs combined (drives line width). */
  inputs: number;
  points: (StatPoint | null)[];
}

// A "nice" gridline step giving ~5 divisions over the range (1/2/5 × 10ⁿ).
export function niceStep(range: number): number {
  if (!(range > 0)) return 1;
  const raw = range / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * pow;
}

// Shared y-scale for one unit's points. Non-negative quantities anchor the
// baseline at 0 and % is fixed 0–100, so adding a same-unit series (e.g.
// effective sun alongside clear sun) doesn't re-range the others — only °C
// floats freely (can be negative, no natural 0).
export function pointsScale(points: readonly (StatPoint | null)[], unit: string): Scale {
  if (unit === '%') return { yMin: 0, yMax: 100, step: 20 };
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of points) {
    if (!p) continue;
    yMin = Math.min(yMin, p.lo);
    yMax = Math.max(yMax, p.hi);
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = 0; // no data → avoid Inf/NaN
    yMax = 1;
  }
  if (unit !== '°C') yMin = Math.min(0, yMin); // irradiance/humidity/wind start at 0
  const step = niceStep(yMax - yMin);
  yMin = Math.floor(yMin / step) * step;
  yMax = Math.ceil(yMax / step) * step;
  if (yMax <= yMin) yMax = yMin + step;
  return { yMin, yMax, step };
}

// "Gefühlt" per hour = UTCI composed from the ACTIVE factors; inactive ones use
// neutral defaults so felt reflects only what you toggle on: real humidity if
// Feuchte is on else a neutral 50% (as wind chill is defined without humidity);
// real wind if Wind is on else calm; effective sun (Sonne+Bewölkung) or clear
// sun (Sonne only) else shade. It appears only once a factor is active, so it is
// never just a relabelled air temperature.
export function feltPoints(
  hours: readonly Hour[],
  ctx: PlaceCtx,
  active: Active,
): (StatPoint | null)[] {
  return hours.map((h) => {
    const clearSky = clearSkyAt(h, ctx);
    return stats(
      h.samples.map((s) => {
        const rhUsed = active.ah ? s.rh : 50;
        const windUsed = active.wind ? s.w : 0;
        const Tr =
          active.csun && active.clouds
            ? meanRadiantTemp(s.t, s.s ?? clearSky)
            : active.csun
              ? meanRadiantTemp(s.t, clearSky)
              : s.t;
        return utci(s.t, rhUsed, windUsed, Tr);
      }),
    );
  });
}

// Build the flat list of scaled series to draw from the active base set.
export function buildSeries(hours: readonly Hour[], ctx: PlaceCtx, active: Active): Series[] {
  const pointsFor = (def: MetricDef) =>
    def.hourVal
      ? hours.map((h) => stats([def.hourVal?.(h, ctx)]))
      : hours.map((h) => stats(h.samples.map((s) => def.val?.(s))));

  // Number of base inputs that combine into "Gefühlt" for the current toggles.
  const feltInputs =
    1 /* temp */ +
    (active.ah ? 1 : 0) +
    (active.wind ? 1 : 0) +
    (active.csun ? 1 : 0) +
    (active.csun && active.clouds ? 1 : 0);

  const scale0: Scale = { yMin: 0, yMax: 1, step: 1 };
  const out: Series[] = [];
  for (const b of BASES) {
    if (!active[b.key]) continue;
    out.push({
      ...scale0,
      key: b.key,
      unit: b.unit,
      color: b.color,
      dp: b.dp,
      derived: false,
      inputs: 1,
      points: pointsFor(b),
    });
  }
  for (const d of DERIVED) {
    const visible = d.show ? d.show(active) : (d.deps ?? []).every((k) => active[k]);
    if (!visible) continue;
    const points = d.felt ? feltPoints(hours, ctx, active) : pointsFor(d);
    const inputs = d.felt ? feltInputs : (d.deps ?? []).length;
    out.push({
      ...scale0,
      key: d.key,
      unit: d.unit,
      color: d.color,
      dp: d.dp,
      derived: true,
      primary: d.primary,
      inputs,
      points,
    });
  }
  // Shared y-scale per unit, fixed as if every metric of that unit were shown —
  // so toggling a metric on/off never re-ranges (and thus visually shifts) any
  // other line sharing its unit.
  for (const unit of new Set(out.map((s) => s.unit))) {
    const defs: (BaseDef | DerivedDef)[] = [
      ...BASES.filter((b) => b.unit === unit),
      ...DERIVED.filter((d) => d.unit === unit),
    ];
    const allPoints = defs.flatMap((def) =>
      'felt' in def && def.felt ? feltPoints(hours, ctx, ALL_ON) : pointsFor(def),
    );
    const scale = pointsScale(allPoints, unit);
    for (const s of out) if (s.unit === unit) Object.assign(s, scale);
  }
  return out;
}

// Line width scales with how many base inputs combine into the value, capped so
// the busiest "Gefühlt" stays legible rather than a slab.
export function lineWidth(inputs: number): number {
  return Math.min(3, 1.4 + 0.45 * (inputs - 1));
}

export interface EnsembleMember {
  key: ModelKey;
  name: string;
  res: string;
  resKm: number;
  rad: boolean;
  cloud: boolean;
  horizonDays: number;
}

export interface EnsembleInfo {
  members: EnsembleMember[];
  finest: EnsembleMember | null;
  now: { base: number; rad: number; cloud: number };
}

// Ensemble attribution from the per-model samples: which member provides which
// variables right now, and how far into the future each one reaches.
export function ensembleInfo(
  hours: readonly Hour[] | null | undefined,
  now = Date.now(),
): EnsembleInfo | null {
  if (!hours || !hours.length) return null;
  const nowSamples = hours[nowHourIndex(hours, now)].samples;

  const members: EnsembleMember[] = [];
  for (const key of Object.keys(MODEL_INFO) as ModelKey[]) {
    let lastTs: number | null = null;
    let rad = false;
    let cloud = false;
    for (const h of hours) {
      const s = h.samples.find((x) => x.m === key);
      if (!s) continue;
      lastTs = h.ts;
      if (s.s != null) rad = true;
      if (s.c != null) cloud = true;
    }
    if (lastTs == null) continue;
    members.push({
      key,
      ...MODEL_INFO[key],
      rad,
      cloud,
      horizonDays: Math.max(0, Math.round((lastTs - now) / 86400000)),
    });
  }

  const count = (f: (s: Sample) => boolean) => nowSamples.filter(f).length;

  // Whichever active member currently gives the sharpest local detail (the
  // smallest grid cell) — e.g. MeteoSwiss ICON-CH1 (1 km) near the Alps
  // while it's within its 33 h horizon, falling back to a coarser member
  // once it drops out.
  const nowKeys = new Set(nowSamples.map((s) => s.m));
  const finest = members
    .filter((m) => nowKeys.has(m.key))
    .reduce<EnsembleMember | null>((best, m) => (!best || m.resKm < best.resKm ? m : best), null);

  return {
    members,
    finest,
    now: {
      base: nowSamples.length,
      rad: count((s) => s.s != null),
      cloud: count((s) => s.c != null),
    },
  };
}

// Paths tolerate gaps (null points, e.g. a metric a model doesn't provide) —
// each contiguous run of real points becomes its own subpath. Within a run,
// slight smoothing: a quadratic bezier curving toward the midpoint of each
// consecutive pair rounds off hourly corners without overshooting past the
// data (unlike a full Catmull-Rom spline, which can bulge beyond the points).
export function buildLinePath(
  points: readonly (StatPoint | null)[],
  x: (i: number) => number,
  yf: (v: number) => number,
): string {
  let d = '';
  let run: number[] = [];
  const f = (n: number) => n.toFixed(1);
  const flushRun = () => {
    if (!run.length) return;
    const pts = run.map((i) => [x(i), yf((points[i] as StatPoint).med)]);
    d += `M${f(pts[0][0])} ${f(pts[0][1])} `;
    for (let i = 1; i < pts.length - 1; i++) {
      const [cx, cy] = pts[i];
      const [nx, ny] = pts[i + 1];
      d += `Q${f(cx)} ${f(cy)} ${f((cx + nx) / 2)} ${f((cy + ny) / 2)} `;
    }
    if (pts.length > 1) {
      const [lx, ly] = pts[pts.length - 1];
      d += `L${f(lx)} ${f(ly)} `;
    }
  };
  for (let i = 0; i < points.length; i++) {
    if (points[i]) run.push(i);
    else {
      flushRun();
      run = [];
    }
  }
  flushRun();
  return d;
}

export function buildBandPath(
  points: readonly (StatPoint | null)[],
  x: (i: number) => number,
  yf: (v: number) => number,
): string {
  const idx = points.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return '';
  const f = (n: number) => n.toFixed(1);
  let up = '';
  idx.forEach((i, k) => {
    up += `${k ? 'L' : 'M'}${f(x(i))} ${f(yf((points[i] as StatPoint).hi))} `;
  });
  let dn = '';
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    dn += `L${f(x(i))} ${f(yf((points[i] as StatPoint).lo))} `;
  }
  return `${up}${dn}Z`;
}

// Night shading: sun-below-horizon per hour, collapsed into contiguous runs
// of hour indices [start, end). Evaluated at the half-hour MIDPOINT: each band
// rect spans hour-start to hour-start, so the midpoint decides day/night for
// the slot as a whole — hour-start sampling put the visual edge up to 30 min
// off.
export function nightBands(hours: readonly Hour[], lat: number, lon: number): [number, number][] {
  const bands: [number, number][] = [];
  let start: number | null = null;
  for (let i = 0; i <= hours.length; i++) {
    const isNight =
      i < hours.length && solarElevation(lat, lon, new Date(hours[i].ts + 1800000)) <= 0;
    if (isNight && start === null) start = i;
    if (!isNight && start !== null) {
      bands.push([start, i]);
      start = null;
    }
  }
  return bands;
}
