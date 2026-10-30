import { useEffect, useState } from 'react';
import {
  COMFORT,
  absoluteHumidity,
  bestVentWindow,
  dewPoint,
  indoorApparentTemp,
  ventilationAssessment,
  type VentWindow,
} from '../core/formulas';
import { fmt1, hh } from '../core/time';
import {
  ventDuration,
  ventEffects,
  ventReason,
  ventVerdict,
  type Effect,
  type Reason,
  type VerdictKey,
} from '../core/vent';
import type { Hour } from '../core/weather';
import { t } from '../i18n';
import { Chip, Info, Slider } from './controls';
import { fmtSlot, weekday } from './format';
import { Rich } from './Rich';

const HERO_ICON: Record<VerdictKey, string> = {
  condensation: '🚫',
  recommended: '🪟',
  sensible: '🪟',
  weigh: '🤔',
  noEffect: '😐',
  notRecommended: '🚫',
};

function reasonText(r: Reason): string {
  const R = t.vent.reason;
  switch (r.kind) {
    case 'condensation':
      return R.condensation(fmt1(r.dpOut), fmt1(r.Tin));
    case 'drierCooler':
      return R.drierCooler(fmt1(r.ahOut), fmt1(r.ahIn), fmt1(r.dH));
    case 'drierWarmer':
      return R.drierWarmer(fmt1(r.dH));
    case 'drierSimilar':
      return R.drierSimilar(fmt1(r.dH));
    case 'coolerWetter':
      return R.coolerWetter(fmt1(r.ahOut), fmt1(r.ahIn));
    case 'same':
      return R.same;
    case 'wetter':
      return R.wetter(fmt1(r.ahOut), fmt1(r.ahIn));
    case 'wetterWarmer':
      return R.wetterWarmer(fmt1(r.ahOut), fmt1(r.ahIn), fmt1(r.dH));
  }
}

function effectChip(e: Effect): { text: string; cls: string } {
  const E = t.vent.effect;
  switch (e.kind) {
    case 'condensation':
      return { text: E.condensation, cls: 'bad' };
    case 'moisture':
      return { text: E.moisture(e.up ? '↑' : '↓', fmt1(e.amount)), cls: e.up ? 'bad' : 'good' };
    case 'heat':
      return { text: E.heat(e.up ? '↑' : '↓', fmt1(e.amount)), cls: e.up ? 'bad' : 'good' };
    case 'freshAir':
      return { text: E.freshAir, cls: 'neutral' };
  }
}

interface DeltaRowProps {
  label: string;
  inVal: number;
  outVal: number;
  unit: string;
  info?: string;
}

function DeltaRow({ label, inVal, outVal, unit, info }: DeltaRowProps) {
  const delta = outVal - inVal;
  const sign = delta >= 0 ? '+' : '';
  const cls = Math.abs(delta) < 0.4 ? 'neutral' : delta < 0 ? 'good' : 'bad';
  return (
    <div className="d-row">
      <span className="d-label">
        {label}
        {info && <Info>{info}</Info>}
      </span>
      <span className="d-in">{fmt1(inVal)}</span>
      <span className="d-arrow">&#8594;</span>
      <span className="d-out">{fmt1(outVal)}</span>
      <span className={`d-delta ${cls}`}>
        {sign}
        {fmt1(delta)} {unit}
      </span>
    </div>
  );
}

interface Conditions {
  Tin: number;
  RHin: number;
  Tout: number;
  RHout: number;
  elevM: number;
}

// Pure numbers ("nerd data") — the explaining sentence lives in the hero.
function VentTable({ Tin, RHin, Tout, RHout, elevM }: Conditions) {
  const a = ventilationAssessment(Tin, RHin, Tout, RHout, elevM);
  const T = t.vent.table;
  return (
    <div className="vent-table">
      <div className="d-head">
        <span className="d-label"></span>
        <span className="d-in">{t.vent.indoor}</span>
        <span className="d-arrow"></span>
        <span className="d-out">{t.vent.outdoor}</span>
        <span className="d-delta">&#916;</span>
      </div>
      <DeltaRow label={T.temp} inVal={Tin} outVal={Tout} unit="°C" />
      <DeltaRow
        label={T.dewPoint}
        inVal={dewPoint(Tin, RHin)}
        outVal={dewPoint(Tout, RHout)}
        unit="°C"
        info={T.dewPointInfo}
      />
      <DeltaRow
        label={T.absHum}
        inVal={absoluteHumidity(Tin, RHin)}
        outVal={absoluteHumidity(Tout, RHout)}
        unit="g/m³"
        info={T.absHumInfo}
      />
      <DeltaRow
        label={T.enthalpy}
        inVal={a.hIn}
        outVal={a.hOut}
        unit="kJ/kg"
        info={T.enthalpyInfo}
      />
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="vent-timeline">
      <div className="vt-title section-name muted">{t.vent.timelineTitle}</div>
      <div className="vt-strip vt-strip-skeleton" />
      <div className="vt-labels" />
    </div>
  );
}

interface TimelineProps {
  hours: Hour[];
  Tin: number;
  RHin: number;
  win: VentWindow | null;
  elevM: number;
  selTs: number | null;
  onPick: (ts: number | null) => void;
}

// Hour-by-hour verdict strip for the next 24 h — answers "if not now, when?"
// at a glance. Each cell uses the hero's ventVerdict with the forecast
// outdoor conditions; the best window is emphasized. Tapping an hour moves
// the hero verdict to it (tap again, or the hero, to return to now).
function VentTimeline({ hours, Tin, RHin, win, elevM, selTs, onPick }: TimelineProps) {
  // eslint-disable-next-line react-hooks/purity -- "next 24 h" is relative to the wall clock
  const now = Date.now();
  const fut = hours.filter((h) => h.ts + 3600000 > now).slice(0, 24);
  // Fully stale data: keep the card's exact shape with an empty strip.
  if (!fut.length) return <TimelineSkeleton />;
  const inWin = (h: Hour) => !!win && h.time >= win.start && h.time <= win.end;
  return (
    <div className="vent-timeline">
      <div className="vt-title section-name muted">{t.vent.timelineTitle}</div>
      <div className="vt-strip">
        {fut.map((h) => {
          const v = ventVerdict(Tin, RHin, h.temp, h.humidity, elevM);
          const label = t.vent.hourLabel(
            hh(h.time),
            t.vent.verdict[v.key],
            fmt1(h.temp),
            Math.round(h.humidity),
          );
          return (
            <button
              key={h.ts}
              type="button"
              className={`vt-cell ${v.cls} ${inWin(h) ? 'best' : ''} ${selTs === h.ts ? 'sel' : ''}`}
              onClick={() => onPick(selTs === h.ts ? null : h.ts)}
              title={label}
              aria-label={label}
              aria-pressed={selTs === h.ts}
            />
          );
        })}
      </div>
      <div className="vt-labels">
        {fut.map((h, i) => (
          <span key={h.ts} className="vt-lab">
            {i % 6 === 0 ? hh(h.time) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function WindowText({ win, inTemp }: { win: VentWindow | null; inTemp: number }) {
  if (!win) return <p className="vent-window neutral">{t.vent.noWindow}</p>;
  // What the window achieves + how long to air: a strong in/out gradient
  // (and wind) exchanges the room's air much faster.
  const dries = win.dAH > 0.3;
  const cools = win.dT > 2 && inTemp > COMFORT.tHi;
  const D = t.vent.does;
  const does = dries && cools ? D.driesCools : dries ? D.dries : cools ? D.cools : D.freshens;
  const dur = t.vent.duration[ventDuration(win.dT, win.wind ?? 0)];
  // A run spanning (nearly) the whole day means "anytime", not a slot.
  const allDay = win.end.getTime() - win.start.getTime() >= 20 * 3600000;
  const slot = allDay ? t.vent.allDay : fmtSlot(win.start, win.end);
  return (
    <p className="vent-window good">
      <Rich text={t.vent.bestWindow(slot, does, Math.round(Math.abs(win.dT)), dur)} />
    </p>
  );
}

interface Props {
  inTemp: number;
  setInTemp: (v: number) => void;
  inRH: number;
  setInRH: (v: number) => void;
  outTemp: number;
  outRH: number;
  hours: Hour[] | null;
  elevation: number;
}

const stillValid = (h: Hour) => h.ts + 3600000 > Date.now();

// Ventilation tab. Outdoor conditions come from data — live now, or the
// tapped hour of the 24h strip. A manual override sits in the outdoor
// collapsible: moving a slider there switches to manual mode (announced in
// the hero's time label); a timeline or hero tap leaves it again.
export function LueftenTab({
  inTemp,
  setInTemp,
  inRH,
  setInRH,
  outTemp,
  outRH,
  hours,
  elevation,
}: Props) {
  // Selected timeline hour, anchored to its timestamp; null = live now.
  const [selTs, setSelTs] = useState<number | null>(null);
  // Manual what-if override. Session-only by design; highest precedence.
  const [man, setMan] = useState<{ temp: number; rh: number } | null>(null);
  // A selected hour must still be current-or-future: `hours` keeps ~6 past
  // hours, so without expiry a selection could keep driving the hero after
  // it slid out of the strip.
  const selHour =
    selTs != null && hours ? (hours.find((h) => h.ts === selTs && stillValid(h)) ?? null) : null;
  useEffect(() => {
    if (selTs != null && (!hours || !hours.some((h) => h.ts === selTs && stillValid(h)))) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- expire a selection that aged out
      setSelTs(null);
    }
  }, [hours, selTs]);
  const oTemp = man ? man.temp : selHour ? selHour.temp : outTemp;
  const oRH = man ? man.rh : selHour ? selHour.humidity : outRH;
  const backToNow = () => {
    setMan(null);
    setSelTs(null);
  };

  const verdict = ventVerdict(inTemp, inRH, oTemp, oRH, elevation);
  const feltIn = indoorApparentTemp(inTemp, inRH).value;
  const feltOut = indoorApparentTemp(oTemp, oRH).value;
  const win = bestVentWindow(hours, inTemp, inRH, elevation);
  const effects = ventEffects(inTemp, inRH, oTemp, oRH, elevation).map(effectChip);

  // What the verdict describes: live now, the tapped hour, or manual.
  const live = !man && !selHour;
  const when = man
    ? t.vent.manual
    : selHour
      ? t.vent.hourWhen(weekday(selHour.time), hh(selHour.time))
      : t.now;

  return (
    <>
      {/* 1 — THE ANSWER. */}
      <div
        className={`vent-hero ${verdict.cls} ${live ? '' : 'seekable'}`}
        onClick={live ? undefined : backToNow}
        title={live ? undefined : t.backToNow}
      >
        <div className={`vh-when ${live ? 'live' : ''} ${man ? 'manual' : ''}`}>
          {live && <i className="fc-now-dot" />}
          {when}
        </div>
        <div className="vh-verdict">
          {HERO_ICON[verdict.key]} {t.vent.hero[verdict.key]}
        </div>
        <p className="vh-reason">{reasonText(ventReason(inTemp, inRH, oTemp, oRH, elevation))}</p>
        <div className="vh-chips">
          {effects.map((e) => (
            <span key={e.text} className={`verdict-chip ${e.cls}`}>
              {e.text}
            </span>
          ))}
        </div>
      </div>

      {/* 2 — IF NOT NOW, WHEN? */}
      <div className="section-card vent-when">
        {hours ? (
          <VentTimeline
            hours={hours}
            Tin={inTemp}
            RHin={inRH}
            win={win}
            elevM={elevation}
            selTs={selTs}
            onPick={(ts) => {
              setMan(null);
              setSelTs(ts);
            }}
          />
        ) : (
          <TimelineSkeleton />
        )}
        {hours ? (
          <WindowText win={win} inTemp={inTemp} />
        ) : (
          <p className="vent-window neutral">{t.vent.loading}</p>
        )}
      </div>

      {/* 3 — THE INPUTS. Indoor is the only thing the app can't know. */}
      <div className="section-card vent-inputs">
        <div className="vent-inputs-head">
          <span className="section-name">{t.vent.indoor}</span>
          <span className="summary-chips">
            <Chip cls="felt">≈ {fmt1(feltIn)} °C</Chip>
          </span>
        </div>
        <div className="vent-inputs-body">
          <Slider
            label={t.vent.temperature}
            value={inTemp}
            onChange={setInTemp}
            min={10}
            max={40}
            step={0.5}
            unit="°C"
          />
          <Slider
            label={t.vent.humidity}
            value={inRH}
            onChange={setInRH}
            min={1}
            max={100}
            step={1}
            unit="%"
          />
        </div>
      </div>

      {/* Outdoor: data by default; the collapsible hides the manual override. */}
      <details className="section-card">
        <summary className="section-summary">
          <span className="section-name">{t.vent.outdoor}</span>
          <span className="summary-chips">
            <Chip>{fmt1(oTemp)} °C</Chip>
            <Chip>{Math.round(oRH)} %</Chip>
            <Chip cls="felt">≈ {fmt1(feltOut)} °C</Chip>
          </span>
        </summary>
        <div className="section-body">
          <Slider
            label={t.vent.temperature}
            value={Math.round(oTemp * 2) / 2}
            onChange={(v) => setMan({ temp: v, rh: oRH })}
            min={-30}
            max={50}
            step={0.5}
            unit="°C"
          />
          <Slider
            label={t.vent.humidity}
            value={Math.round(oRH)}
            onChange={(v) => setMan({ temp: oTemp, rh: v })}
            min={1}
            max={100}
            step={1}
            unit="%"
          />
        </div>
      </details>

      {/* 4 — NERD DATA, opt-in. Same name as the Gefühlt tab's section. */}
      <details className="section-card">
        <summary className="section-summary">
          <span className="section-name muted">{t.method.title}</span>
        </summary>
        <div className="section-body">
          <VentTable Tin={inTemp} RHin={inRH} Tout={oTemp} RHout={oRH} elevM={elevation} />
          <p className="vent-note">
            <Rich text={t.vent.note} />
          </p>
        </div>
      </details>
    </>
  );
}
