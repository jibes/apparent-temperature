import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BASES,
  buildBandPath,
  buildLinePath,
  buildSeries,
  lineWidth,
  nightBands as computeNightBands,
  type Active,
  type Series,
} from '../core/series';
import { hh, interpPoint, nowFraction, nowHourIndex, type StatPoint } from '../core/time';
import type { Hour } from '../core/weather';
import { t } from '../i18n';
import { ChartReadout, fmtVal, type LegendGroup } from './ChartReadout';
import { dateLabel, dayLabel } from './format';

// Chart geometry. axisW is constant — widening it for a labelled side gutter
// made the plot itself resize (and everything scroll-jump) whenever toggling
// a metric changed the unit count. Axis labels render as overlays instead.
const H = 260;
const padT = 10;
const padB = 24;
const padR = 10;
const axisW = 6;
const innerH = H - padT - padB;
const BUBBLE_GAP = 15;
const DRAG_THRESHOLD = 4;

const pxPerHourFor = (w: number) => Math.max(6, (w - axisW) / 24);
const xFor = (pxPerHour: number) => (i: number) => 4 + i * pxPerHour;
const ymap = (s: Series) => (v: number) => padT + (1 - (v - s.yMin) / (s.yMax - s.yMin)) * innerH;

interface Bubble {
  key: string;
  color: string;
  y: number;
  text: string;
  bw: number;
  side: 'left' | 'right';
  bx: number;
  cy: number;
}

// Static explainer under the chart — the load skeleton renders the same text
// so the forecast box keeps its height before and after data arrives.
function ForecastNote() {
  return <p className="forecast-note">{t.chart.note}</p>;
}

interface Props {
  hours: Hour[] | null;
  lat: number;
  lon: number;
  elevation: number;
  active: Active;
  selTs: number | null;
  setSelTs: (ts: number | null) => void;
  visible: boolean;
}

// Multi-day forecast chart. BASE inputs are toggled from the shared selector
// above (same `active` state that drives the current-value readout); DERIVED
// outputs appear when their inputs are active. Same units share one scale.
export function ForecastChart({
  hours,
  lat,
  lon,
  elevation,
  active,
  selTs,
  setSelTs,
  visible,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPos = useRef(0);
  const scrollRaf = useRef<number | null>(null);
  const drag = useRef({
    active: false,
    moved: false,
    startX: 0,
    startScrollLeft: 0,
    pointerType: 'mouse',
  });
  const [dragging, setDragging] = useState(false);
  // Forces a re-render: scroll (bubbles) and the 5s live tick share it.
  const [, setRenderTick] = useState(0);
  // Visible scroll window, read by the bubble layout. Kept in state (not read
  // from the DOM during render) and refreshed on scroll / resize / show.
  const [view, setView] = useState({ left: 0, width: 0 });
  const [w, setW] = useState(360);
  const [showSpread, setShowSpread] = useState(false);
  const [isolated, setIsolated] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    },
    [],
  );

  // Native touch/trackpad scrolling never touches React state, so the bubble
  // layout wouldn't follow it. rAF-throttled so a fast swipe doesn't spam
  // re-renders; series, paths and night bands are memoized on data/width.
  function onChartScroll(e: React.UIEvent<HTMLDivElement>) {
    scrollPos.current = e.currentTarget.scrollLeft;
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = null;
      const el = scrollRef.current;
      if (el) setView({ left: el.scrollLeft, width: el.clientWidth });
    });
  }
  useEffect(() => {
    if (!wrapRef.current) return;
    // Ignore the 0-width report when the tab is hidden (display:none) so the
    // last good width is kept and the chart doesn't collapse.
    const ro = new ResizeObserver((es) => {
      const width = es[0].contentRect.width;
      if (width > 0) setW(width);
      const el = scrollRef.current;
      if (el && el.clientWidth > 0) setView({ left: el.scrollLeft, width: el.clientWidth });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  // Restore horizontal scroll when this tab is shown again — display:none can
  // reset scrollLeft in some browsers. useLayoutEffect runs after the commit
  // made the tab visible but before paint, so the bubble viewport is measured
  // with the real width before the user ever sees a wrong frame.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (visible && el) {
      el.scrollLeft = scrollPos.current;
      setView({ left: el.scrollLeft, width: el.clientWidth });
    }
  }, [visible]);

  // The "Jetzt" line is time-based, so it should creep forward between data
  // refreshes. Ticking only while live and on screen; 5s looks alive without
  // real work (series/paths are memoized). A selected hour that aged out of
  // the window also counts as live.
  const liveMode = selTs == null || !(hours ?? []).some((h) => h.ts === selTs);
  useEffect(() => {
    if (!visible || !liveMode) return;
    const id = setInterval(() => setRenderTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, [visible, liveMode]);

  // Keep the selection visible when it changes from OUTSIDE the chart (the
  // headline's ‹/› steppers): scroll only when it's outside the viewport.
  useEffect(() => {
    if (selTs == null || !hours || !scrollRef.current) return;
    const idx = hours.findIndex((h) => h.ts === selTs);
    if (idx === -1) return;
    const sx = xFor(pxPerHourFor(w))(idx);
    const el = scrollRef.current;
    const pad = 30;
    if (sx < el.scrollLeft + pad || sx > el.scrollLeft + el.clientWidth - pad) {
      el.scrollLeft = Math.max(0, sx - el.clientWidth / 2);
      scrollPos.current = el.scrollLeft;
    }
  }, [selTs, hours, w]);

  const series = useMemo(() => {
    if (!hours || !hours.length) return null;
    return buildSeries(hours, { lat, lon, elevation }, active);
  }, [hours, active, lat, lon, elevation]);

  // SVG path strings (every series × ~390 points) memoized on data + width.
  const paths = useMemo(() => {
    if (!series) return null;
    const x = xFor(pxPerHourFor(w));
    return new Map(
      series.map((s) => [
        s.key,
        { line: buildLinePath(s.points, x, ymap(s)), band: buildBandPath(s.points, x, ymap(s)) },
      ]),
    );
  }, [series, w]);

  // Night shading gives free temporal context (that peak is midday, this dip
  // is 3am) without another line or number.
  const nightBands = useMemo(
    () => (hours && hours.length ? computeNightBands(hours, lat, lon) : []),
    [hours, lat, lon],
  );

  // If the isolated metric's series disappears (toggle off, dependency
  // dropped), clear the isolation instead of keeping a stale key that would
  // come back pre-isolated later.
  const isolatedShown = isolated != null && !!series?.some((s) => s.key === isolated);
  const effIsolated = isolatedShown ? isolated : null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drop a stale isolation key
    if (isolated != null && series && !isolatedShown) setIsolated(null);
  }, [series, isolated, isolatedShown]);

  // Before data arrives, hold the box at its loaded height.
  if (!series || !paths || !hours) {
    return (
      <div className="forecast" ref={wrapRef}>
        <div className="forecast-head">
          <span className="section-name muted">{t.chart.preview}</span>
        </div>
        <div className="fc-days fc-days-skeleton" />
        <div className="fc-plot-skeleton">
          <span className="fc-loading">{t.chart.loading}</span>
        </div>
        <div className="fc-readout-skeleton" />
        <ForecastNote />
      </div>
    );
  }

  // Groups each derived value under its base (rh→ah, effsun→csun, felt→temp)
  // for the legend and the tap-to-isolate highlight.
  const bases = series.filter((s) => !s.derived);
  const deriveds = series.filter((s) => s.derived);
  const legendGroups: LegendGroup[] = bases.map((b) => ({
    base: b,
    children: deriveds.filter((d) => d.primary === b.key),
  }));
  const orphans = deriveds.filter((d) => !bases.some((b) => b.key === d.primary));
  if (orphans.length) legendGroups.push({ base: null, children: orphans });

  // Clicking a legend row isolates its whole group (base + derived siblings).
  const isolatedGroup =
    effIsolated != null
      ? legendGroups.find(
          (g) => g.base?.key === effIsolated || g.children.some((c) => c.key === effIsolated),
        )
      : undefined;
  const highlightKeys = isolatedGroup
    ? new Set<string>(
        [isolatedGroup.base?.key, ...isolatedGroup.children.map((c) => c.key)].filter(
          (k): k is Series['key'] => k != null,
        ),
      )
    : null;
  const dimmed = (s: Series) => highlightKeys != null && !highlightKeys.has(s.key);

  const units = [...new Set(series.map((s) => s.unit))];
  const single = units.length === 1;
  const n = hours.length;

  const pxPerHour = pxPerHourFor(w);
  const chartW = Math.round((n - 1) * pxPerHour + padR + 4);
  const x = xFor(pxPerHour);

  const axisTicks = (s: Series) => {
    const yf = ymap(s);
    const out: { y: number; label: string | null }[] = [];
    for (let v = s.yMin; v <= s.yMax + 1e-9; v += s.step) {
      out.push({ y: yf(v), label: s.step < 1 ? v.toFixed(1) : String(Math.round(v)) });
    }
    return out;
  };

  // With exactly two active BASE toggles, show both scales — the one whose
  // button comes first on the left edge, the other on the right. Based on
  // active toggles, not all visible units: temp+ah also brings in rel.
  // humidity (%), which would otherwise mask the pair's own dual axis.
  const activeBaseUnits = [...new Set(BASES.filter((b) => active[b.key]).map((b) => b.unit))];
  const dualUnits = activeBaseUnits.length === 2;
  const activeBaseIndex = (unit: string) =>
    BASES.findIndex((b) => active[b.key] && b.unit === unit);
  const [leftUnit, rightUnit] = dualUnits
    ? [...activeBaseUnits].sort((a, b) => activeBaseIndex(a) - activeBaseIndex(b))
    : [null, null];
  const leftSeries = dualUnits ? series.find((s) => s.unit === leftUnit) : undefined;
  const rightSeries = dualUnits ? series.find((s) => s.unit === rightUnit) : undefined;

  // Horizontal gridlines: labelled ticks off the single shared scale, or off
  // the left-hand scale when there are two, else evenly spaced references.
  const grid = single
    ? axisTicks(series[0])
    : leftSeries
      ? axisTicks(leftSeries).map((g) => ({ y: g.y, label: null }))
      : Array.from({ length: 5 }, (_, f) => ({ y: padT + (f / 4) * innerH, label: null }));

  // Gridline density adapts to how wide an hour is on screen.
  const minorStep = pxPerHour >= 11 ? 1 : pxPerHour >= 6 ? 3 : 6;
  const labelStep = pxPerHour >= 8 ? 3 : 6;
  const days: { i: number; date: Date }[] = [];
  const mids: number[] = [];
  const minor: number[] = [];
  const labels: number[] = [];
  hours.forEach((h, i) => {
    const hr = h.time.getHours();
    if (i === 0 || hr === 0) days.push({ i, date: h.time });
    else if (hr % 6 === 0) mids.push(i);
    else if (hr % minorStep === 0) minor.push(i);
    if (hr !== 0 && hr % labelStep === 0) labels.push(i);
  });

  // Per-day overview strip: min/max of the "hero" series per calendar day.
  // Tapping a day scrolls the graph there.
  const heroSeries =
    series.find((s) => s.key === 'felt') ?? series.find((s) => s.key === 'temp') ?? series[0];
  const dayTiles = days.map((d, k) => {
    const end = k + 1 < days.length ? days[k + 1].i : n;
    let lo = Infinity;
    let hi = -Infinity;
    if (heroSeries) {
      for (let i = d.i; i < end; i++) {
        const p = heroSeries.points[i];
        if (!p) continue;
        lo = Math.min(lo, p.med);
        hi = Math.max(hi, p.med);
      }
    }
    return { i: d.i, date: d.date, lo, hi, ok: Number.isFinite(lo) };
  });

  const nowIdx = nowHourIndex(hours);
  const nowFrac = nowFraction(hours, nowIdx);
  const xNow = x(nowIdx) + nowFrac * pxPerHour;
  // ceil, not round: rounding made the heading wobble between 15 and 16 days.
  const spanDays = Math.ceil((n - nowIdx) / 24);

  // No selection means "now" — interpolated between two hourly samples.
  // Tapping selects a whole hour, anchored to its timestamp (the window
  // slides with every refetch); an aged-out selection falls back to now.
  const selHourIdx = selTs != null ? hours.findIndex((h) => h.ts === selTs) : -1;
  const selectingNow = selHourIdx === -1;
  const si = selectingNow ? nowIdx : selHourIdx;
  const selX = selectingNow ? xNow : x(si);
  // Place-local wall clock, not the phone's: interpolate from hours[].time
  // (location local time, digit-for-digit) by the same nowFrac.
  const selDate = selectingNow
    ? new Date(hours[nowIdx].time.getTime() + nowFrac * 3600000)
    : hours[si].time;
  const hhmm = selectingNow
    ? `${hh(selDate)}:${String(selDate.getMinutes()).padStart(2, '0')}`
    : `${hh(selDate)}:00`;

  const pointAt = (s: Series): StatPoint | null =>
    selectingNow
      ? interpPoint(s.points[nowIdx], s.points[nowIdx + 1], nowFrac)
      : (s.points[si] ?? null);

  // Value bubbles at the selected point, split across both sides of the line
  // and decluttered within each side. As the line nears the edge of the
  // visible viewport, a bubble that would clip flips to the inner side.
  function layoutBubbles(series: Series[]) {
    const viewLeft = view.left;
    const viewRight = viewLeft + (view.width || chartW);
    // While a group is isolated, other bubbles are dropped, not dimmed.
    const items = series
      .flatMap((s) => {
        if (dimmed(s)) return [];
        const p = pointAt(s);
        if (!p) return [];
        const text = `${fmtVal(s, p.med)} ${s.unit}`;
        return [
          { key: s.key, color: s.color, y: ymap(s)(p.med), text, bw: text.length * 5.4 + 10 },
        ];
      })
      .sort((a, b) => a.y - b.y)
      .map((it, i): Bubble => {
        const pref = i % 2 === 0 ? 'right' : 'left';
        const prefBx = pref === 'left' ? selX - 8 - it.bw : selX + 8;
        const noRoom = pref === 'left' ? prefBx < viewLeft : prefBx + it.bw > viewRight;
        const side = noRoom ? (pref === 'left' ? 'right' : 'left') : pref;
        return { ...it, side, bx: side === 'left' ? selX - 8 - it.bw : selX + 8, cy: it.y };
      });
    const left = items.filter((it) => it.side === 'left');
    const right = items.filter((it) => it.side === 'right');
    for (const side of [left, right]) {
      if (!side.length) continue;
      let prev = -Infinity;
      for (const it of side) {
        it.cy = Math.max(it.y, prev + BUBBLE_GAP);
        prev = it.cy;
      }
      // Shift the stack up if it ran past the bottom, then back down if the
      // top one ended above the plot — clamped inside either way.
      const bottomOverflow = side[side.length - 1].cy - (padT + innerH);
      if (bottomOverflow > 0) side.forEach((it) => (it.cy -= bottomOverflow));
      const topOverflow = padT - side[0].cy;
      if (topOverflow > 0) side.forEach((it) => (it.cy += topOverflow));
    }
    return [...left, ...right];
  }

  // Snap to whichever is closer: the nearest whole hour, or "now" — so
  // returning to live mode is just tapping near the Jetzt line.
  function pick(e: React.PointerEvent) {
    if (!svgRef.current || !hours) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const idx = Math.max(0, Math.min(n - 1, Math.round((px - 4) / pxPerHour)));
    const hourDist = Math.abs(px - x(idx));
    const nowDist = Math.abs(px - xNow);
    setSelTs(nowDist < hourDist ? null : hours[idx].ts);
  }

  // Click selects; drag only scrolls — disambiguated by movement, not input
  // type. Touch scrolls natively (pan-x), so manual scrollLeft is mouse-only.
  function onDown(e: React.PointerEvent<SVGSVGElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startScrollLeft: scrollRef.current ? scrollRef.current.scrollLeft : 0,
      pointerType: e.pointerType,
    };
    if (e.pointerType === 'mouse') setDragging(true);
  }
  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > DRAG_THRESHOLD) d.moved = true;
    if (d.moved && d.pointerType === 'mouse' && scrollRef.current) {
      scrollRef.current.scrollLeft = d.startScrollLeft - dx;
    }
  }
  function onUp(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (d.active && !d.moved) pick(e);
    drag.current.active = false;
    if (dragging) setDragging(false);
  }
  // pointercancel = the browser took the gesture over (native pan) — never a
  // deliberate tap, so end the drag WITHOUT picking.
  function onCancel() {
    drag.current.active = false;
    if (dragging) setDragging(false);
  }

  // Back to live, scrolled fully left so the now-bubbles aren't cut off.
  function jumpToNow() {
    setSelTs(null);
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
      scrollPos.current = 0;
    }
  }

  const todayStr = hours[nowIdx].time.toDateString();

  return (
    <div className="forecast" ref={wrapRef}>
      <div className="forecast-head">
        <span className="section-name muted">{t.chart.title(spanDays)}</span>
        <div className="forecast-head-actions">
          <button
            type="button"
            className={`fc-spread-btn ${showSpread ? 'active' : ''}`}
            onClick={() => setShowSpread((v) => !v)}
            title={showSpread ? t.chart.spreadHide : t.chart.spreadShow}
            aria-pressed={showSpread}
          >
            {t.chart.spread}
          </button>
          <button
            type="button"
            className={`fc-now-btn ${selectingNow ? 'live' : ''}`}
            onClick={jumpToNow}
            title={selectingNow ? t.chart.liveTitle : t.chart.jumpNow}
            aria-label={t.chart.jumpNow}
          >
            <i className="fc-now-dot" /> {t.now}
          </button>
        </div>
      </div>

      <div className="fc-days">
        {dayTiles.map((d) => (
          <button
            key={d.i}
            type="button"
            className={`fc-day ${d.date.toDateString() === todayStr ? 'today' : ''}`}
            onClick={() => {
              if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, x(d.i) - 4);
            }}
            title={
              heroSeries && d.ok
                ? t.chart.dayRange(
                    t.metrics[heroSeries.key],
                    Math.round(d.lo),
                    Math.round(d.hi),
                    heroSeries.unit,
                  )
                : t.chart.dayScroll(dateLabel(d.date))
            }
          >
            <span className="fc-day-name">{dayLabel(d.date)}</span>
            <span className="fc-day-range">
              {d.ok ? (
                <>
                  {Math.round(d.lo)}°<em>/{Math.round(d.hi)}°</em>
                </>
              ) : (
                '–'
              )}
            </span>
          </button>
        ))}
      </div>

      <div className="fc-plot">
        <svg
          className="fc-axis"
          width={axisW}
          height={H}
          viewBox={`0 0 ${axisW} ${H}`}
          aria-hidden="true"
        />
        <div className="fc-scroll" ref={scrollRef} onScroll={onChartScroll}>
          <svg
            ref={svgRef}
            width={chartW}
            height={H}
            viewBox={`0 0 ${chartW} ${H}`}
            role="img"
            aria-label={t.chart.title(spanDays)}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onCancel}
            className={dragging ? 'dragging' : ''}
            style={{ touchAction: 'pan-x' }}
          >
            {nightBands.map(([s, e], k) => (
              <rect
                key={`night${k}`}
                x={x(s)}
                y={padT}
                width={x(e) - x(s)}
                height={innerH}
                className="fc-night"
              />
            ))}
            {xNow > 0 && <rect x={0} y={padT} width={xNow} height={innerH} className="fc-past" />}
            {grid.map((g, k) => (
              <line key={k} x1={0} x2={chartW} y1={g.y} y2={g.y} className="fc-grid" />
            ))}
            {minor.map((i) => (
              <line
                key={`mn${i}`}
                x1={x(i)}
                x2={x(i)}
                y1={padT}
                y2={padT + innerH}
                className="fc-gridminor"
              />
            ))}
            {mids.map((i) => (
              <line
                key={`m${i}`}
                x1={x(i)}
                x2={x(i)}
                y1={padT}
                y2={padT + innerH}
                className="fc-grid6"
              />
            ))}
            {days.map(
              ({ i }) =>
                i > 0 && (
                  <line
                    key={i}
                    x1={x(i)}
                    x2={x(i)}
                    y1={padT}
                    y2={padT + innerH}
                    className="fc-daygrid"
                  />
                ),
            )}

            {showSpread &&
              series.map((s) => (
                <path
                  key={`b${s.key}`}
                  d={paths.get(s.key)?.band}
                  fill={s.color}
                  opacity={dimmed(s) ? 0.04 : 0.13}
                  stroke="none"
                />
              ))}
            {series.map((s) => (
              <path
                key={`l${s.key}`}
                d={paths.get(s.key)?.line}
                fill="none"
                stroke={s.color}
                strokeWidth={lineWidth(s.inputs)}
                strokeDasharray={s.derived ? '' : '4 2.5'}
                opacity={dimmed(s) ? 0.15 : 1}
                style={{ transition: 'opacity 0.15s' }}
              />
            ))}

            <line
              x1={xNow}
              x2={xNow}
              y1={padT}
              y2={padT + innerH}
              className={`fc-now ${selectingNow ? 'live' : ''}`}
            />
            <text x={xNow + 3} y={padT + 9} className={`fc-nowlab ${selectingNow ? 'live' : ''}`}>
              {t.now}
            </text>

            {!selectingNow && (
              <line x1={selX} x2={selX} y1={padT} y2={padT + innerH} className="fc-cursor" />
            )}
            {series.map((s) => {
              const p = pointAt(s);
              if (!p) return null;
              return (
                <circle
                  key={`d${s.key}`}
                  cx={selX}
                  cy={ymap(s)(p.med)}
                  r="3.5"
                  fill={s.color}
                  stroke="var(--bg)"
                  strokeWidth="1.5"
                />
              );
            })}

            {layoutBubbles(series).map((b) => (
              <g key={`${b.side}-${b.key}`}>
                <rect
                  x={b.bx}
                  y={b.cy - 8}
                  width={b.bw}
                  height={16}
                  rx={8}
                  fill="var(--surface)"
                  stroke={b.color}
                  strokeWidth="1"
                />
                <text
                  x={b.bx + b.bw / 2}
                  y={b.cy}
                  dominantBaseline="middle"
                  textAnchor="middle"
                  style={{ fill: b.color, fontSize: '9px', fontWeight: 700 }}
                >
                  {b.text}
                </text>
              </g>
            ))}

            {labels.map((i) => (
              <text key={`h${i}`} x={x(i)} y={H - 7} className="fc-hourlab" textAnchor="middle">
                {hh(hours[i].time)}
              </text>
            ))}
            {days.map(({ i, date }) => (
              <text key={`l${i}`} x={x(i) + 3} y={H - 7} className="fc-xlab">
                {dayLabel(date)}
              </text>
            ))}

            {series.length === 0 && (
              <text x={xNow + 40} y={padT + innerH / 2} className="fc-empty">
                {t.chart.empty}
              </text>
            )}
          </svg>
        </div>
        {/* Anchored to the plot's own edges, overlaying the scrollable content. */}
        {single && (
          <svg
            className="fc-ylabs fc-ylabs-left"
            width="34"
            height={H}
            viewBox={`0 0 34 ${H}`}
            aria-hidden="true"
          >
            {grid.map(
              (g, k) =>
                g.label != null && (
                  <text
                    key={`yl${k}`}
                    x={4}
                    y={g.y}
                    dominantBaseline="middle"
                    className="fc-ylab-inside"
                  >
                    {g.label}
                  </text>
                ),
            )}
          </svg>
        )}
        {leftSeries && rightSeries && (
          <>
            <svg
              className="fc-ylabs fc-ylabs-left"
              width="34"
              height={H}
              viewBox={`0 0 34 ${H}`}
              aria-hidden="true"
            >
              {axisTicks(leftSeries).map((g, k) => (
                <text
                  key={`yll${k}`}
                  x={4}
                  y={g.y}
                  dominantBaseline="middle"
                  className="fc-ylab-inside"
                  style={{ fill: leftSeries.color }}
                >
                  {g.label}
                </text>
              ))}
            </svg>
            <svg
              className="fc-ylabs fc-ylabs-right"
              width="34"
              height={H}
              viewBox={`0 0 34 ${H}`}
              aria-hidden="true"
            >
              {axisTicks(rightSeries).map((g, k) => (
                <text
                  key={`ylr${k}`}
                  x={30}
                  y={g.y}
                  dominantBaseline="middle"
                  textAnchor="end"
                  className="fc-ylab-inside"
                  style={{ fill: rightSeries.color }}
                >
                  {g.label}
                </text>
              ))}
            </svg>
          </>
        )}
      </div>

      {/* Legend alongside the in-graph bubbles; a row tap isolates its group. */}
      <ChartReadout
        time={`${dateLabel(selDate)} ${hhmm}`}
        groups={legendGroups}
        pointAt={pointAt}
        dimmed={dimmed}
        isolated={effIsolated}
        onIsolate={(key) => setIsolated((v) => (v === key ? null : key))}
        showSpread={showSpread}
      />

      <ForecastNote />
    </div>
  );
}
