import { useMemo } from 'react';
import { dewPoint, utciCategory } from '../core/formulas';
import {
  ALL_ON,
  BASES,
  FELT_DEF,
  ensembleInfo,
  feltPoints,
  type Active,
  type BaseKey,
} from '../core/series';
import {
  distKm,
  fmt1,
  hh,
  interpPoint,
  nowFraction,
  nowHourIndex,
  nowReading,
  type StatPoint,
} from '../core/time';
import type { Hour } from '../core/weather';
import { t } from '../i18n';
import type { WxMeta } from '../storage';
import { ForecastChart } from './ForecastChart';
import { TEMP_COLOR, colorClass, dateLabel } from './format';
import { Rich } from './Rich';
import { usePersistentState } from './usePersistentState';

// Shared metric selector: BASE inputs to fold into "Gefühlt", also driving
// the graph below. Borderless row of toggle chips.
function MetricToggles({ active, onToggle }: { active: Active; onToggle: (k: BaseKey) => void }) {
  return (
    <div className="fc-metrics">
      {BASES.map((b) => (
        <button
          key={b.key}
          type="button"
          className={`fc-metric ${active[b.key] ? 'active' : ''}`}
          onClick={() => onToggle(b.key)}
          style={{ '--metric-color': b.color } as React.CSSProperties}
          aria-pressed={active[b.key]}
          title={t.metrics[b.key]}
        >
          <span className="fc-metric-circle">{b.icon}</span>
          <span className="fc-metric-label">{t.metricShort[b.key]}</span>
        </button>
      ))}
    </div>
  );
}

interface FeltNowProps {
  point: StatPoint | null;
  airTemp: number | null;
  dp: number | null;
  when: string;
  live: boolean;
  onStep?: (dir: number) => void;
  onJumpLive: () => void;
}

// The one headline number: UTCI folded from whichever factors are active,
// AT the time selected in the graph (live "now" by default) — always in sync
// with the graph's Gefühlt bubble/legend value. ‹/› step the selection hour
// by hour; tapping the number while a selection is active jumps back to
// live. A soft radial glow carries the stress-category colour.
function FeltNow({ point, airTemp, dp, when, live, onStep, onJumpLive }: FeltNowProps) {
  const muggy =
    dp != null && dp >= 18
      ? t.felt.muggy.strong
      : dp != null && dp >= 16
        ? t.felt.muggy.noticeable
        : null;
  const seek = !live;
  // No green "live" indicator while there is no data behind it.
  const isLive = live && airTemp != null;
  const whenEl = (
    <div className={`felt-when ${isLive ? 'live' : ''}`}>
      {isLive && <i className="fc-now-dot" />}
      {when}
      {seek ? t.tapForNow : ''}
    </div>
  );
  const valRow = (inner: React.ReactNode) => (
    <div className="felt-val-row">
      {onStep && (
        <button
          type="button"
          className="felt-step"
          aria-label={t.felt.stepBack}
          onClick={(e) => {
            e.stopPropagation();
            onStep(-1);
          }}
        >
          ‹
        </button>
      )}
      {inner}
      {onStep && (
        <button
          type="button"
          className="felt-step"
          aria-label={t.felt.stepForward}
          onClick={(e) => {
            e.stopPropagation();
            onStep(1);
          }}
        >
          ›
        </button>
      )}
    </div>
  );
  const rootProps = {
    className: `felt-now ${seek ? 'seekable' : ''}`,
    onClick: seek ? onJumpLive : undefined,
    title: seek ? t.backToNow : undefined,
  };

  // The fallback branches keep the category line as an empty spacer so the
  // number sits at the same y in every state.
  if (airTemp == null) {
    return (
      <div {...rootProps}>
        {whenEl}
        {valRow(<div className="ap-val">– °C</div>)}
        <div className="ap-cat">&nbsp;</div>
        <p className="felt-hint">{t.felt.waiting}</p>
      </div>
    );
  }
  if (!point) {
    return (
      <div {...rootProps}>
        {whenEl}
        {valRow(<div className="ap-val">{fmt1(airTemp)} °C</div>)}
        <div className="ap-cat">&nbsp;</div>
        <p className="felt-hint">{t.felt.airOnly}</p>
      </div>
    );
  }
  const cat = utciCategory(point.med);
  const color = TEMP_COLOR[colorClass(point.med)];
  const diff = point.med - airTemp;
  return (
    <div
      {...rootProps}
      style={{ '--felt-color': color, '--felt-glow': color } as React.CSSProperties}
    >
      {whenEl}
      {valRow(<div className="ap-val">{fmt1(point.med)} °C</div>)}
      <div className="ap-cat">{t.utci[cat.key]}</div>
      <p className="felt-hint">
        {/* Model range only when the models actually disagree. */}
        {fmt1(point.lo) !== fmt1(point.hi) && t.felt.perModel(fmt1(point.lo), fmt1(point.hi))}
        {t.felt.vsAir(`${diff >= 0 ? '+' : ''}${fmt1(diff)}`)}
        {muggy && dp != null && (
          <>
            {' '}
            <span className="schwuele-chip">{t.felt.muggyChip(muggy, fmt1(dp))}</span>
          </>
        )}
      </p>
    </div>
  );
}

function Methodology({
  hours,
  wxMeta,
  gridPlace,
  lat,
  lon,
}: {
  hours: Hour[] | null;
  wxMeta: WxMeta | null;
  gridPlace: string | null;
  lat: number;
  lon: number;
}) {
  // Walks all ~390 hours × models, but feeds only this (usually collapsed)
  // section — no reason to redo it on every scrub.
  const ens = useMemo(() => ensembleInfo(hours), [hours]);
  const grid = wxMeta?.grid;
  const m = t.method;
  return (
    <details className="section-card formula-card">
      <summary className="section-summary">
        <span className="section-name muted">{m.title}</span>
      </summary>
      <div className="section-body formula-body">
        {[m.utci, m.shadeSun, m.elevation, m.mrt, m.magnus].map((p) => (
          <p key={p}>
            <Rich text={p} />
          </p>
        ))}
        {ens && (
          <>
            {ens.finest && (
              <p>
                <Rich text={m.finest(ens.finest.name, ens.finest.resKm, gridPlace)} />
              </p>
            )}
            <p>
              <Rich text={m.data(ens.now.base, ens.now.rad, ens.now.cloud)} />
            </p>
            <ul className="model-list">
              {ens.members.map((mb) => (
                <li key={mb.key}>
                  <Rich text={m.member(mb.name, t.models[mb.key], mb.res, mb.horizonDays)} />
                  {!mb.rad && m.noRad}
                  {!mb.cloud && m.noCloud}
                </li>
              ))}
            </ul>
          </>
        )}
        {grid && grid.lat != null && grid.lon != null && (
          <p>
            <Rich
              text={m.grid(
                grid.lat.toFixed(2),
                grid.lon.toFixed(2),
                grid.elevation != null ? Math.round(grid.elevation) : null,
                fmt1(distKm(lat, lon, grid.lat, grid.lon)),
              )}
            />
          </p>
        )}
        <p className="muted">{m.disclaimer}</p>
      </div>
    </details>
  );
}

interface Props {
  hours: Hour[] | null;
  wxMeta: WxMeta | null;
  gridPlace: string | null;
  lat: number;
  lon: number;
  selTs: number | null;
  setSelTs: (ts: number | null) => void;
  visible: boolean;
}

export function FeltTab({ hours, wxMeta, gridPlace, lat, lon, selTs, setSelTs, visible }: Props) {
  // Persisted like the tab and location — a reload shouldn't reset it.
  const [active, setActive] = usePersistentState<Active>('metrics', ALL_ON);
  const toggle = (key: BaseKey) => setActive((a) => ({ ...a, [key]: !a[key] }));

  // Site elevation from the model grid cell — the same terrain the
  // temperature describes — folded into the clear-sky sun model always.
  const elevation = wxMeta?.grid?.elevation ?? 0;
  const ctx = { lat, lon, elevation };
  const hasData = !!hours && hours.length > 0;
  const nowIdx = hasData ? nowHourIndex(hours) : null;

  // The headline follows the graph selection: a tapped hour shows THAT
  // hour's felt temp; live mode shows the interpolated current moment.
  // Air baseline, muggy dew point and the graph readout all read the same
  // instant, so nothing on this tab ever disagrees.
  const selHourIdx = selTs != null && hours ? hours.findIndex((h) => h.ts === selTs) : -1;
  const selHour = selHourIdx === -1 || !hours ? null : hours[selHourIdx];

  const nv = nowReading(hours);
  const airTemp = selHour ? selHour.temp : nv ? nv.temp : null;
  const airRH = selHour ? selHour.humidity : nv ? nv.humidity : null;
  const dp = airTemp != null && airRH != null ? dewPoint(airTemp, airRH) : null;

  let selPoint: StatPoint | null = null;
  if (hours && nowIdx != null && FELT_DEF.show?.(active)) {
    selPoint = selHour
      ? feltPoints([selHour], ctx, active)[0]
      : interpPoint(
          feltPoints([hours[nowIdx]], ctx, active)[0],
          hours[nowIdx + 1] ? feltPoints([hours[nowIdx + 1]], ctx, active)[0] : null,
          nowFraction(hours, nowIdx),
        );
  }
  // Small time label: the tapped hour's wall-clock date/time, or plain "now"
  // while live (no minutes — this tab re-renders only with data refreshes).
  const when = selHour ? `${dateLabel(selHour.time)} ${hh(selHour.time)}:00` : t.now;

  // ‹/› scrub one hour at a time from the selection (or the hour containing
  // now), clamped to the data window.
  const stepHour = (dir: number) => {
    if (!hours || nowIdx == null) return;
    const base = selHour ? selHourIdx : nowIdx;
    const idx = Math.max(0, Math.min(hours.length - 1, base + dir));
    setSelTs(hours[idx].ts);
  };

  return (
    <>
      <div className="felt-top">
        <FeltNow
          point={selPoint}
          airTemp={airTemp}
          dp={dp}
          when={when}
          live={!selHour}
          onStep={hasData ? stepHour : undefined}
          onJumpLive={() => setSelTs(null)}
        />
      </div>

      <MetricToggles active={active} onToggle={toggle} />

      <ForecastChart
        hours={hours}
        lat={lat}
        lon={lon}
        elevation={elevation}
        active={active}
        selTs={selTs}
        setSelTs={setSelTs}
        visible={visible}
      />

      <Methodology hours={hours} wxMeta={wxMeta} gridPlace={gridPlace} lat={lat} lon={lon} />
    </>
  );
}
