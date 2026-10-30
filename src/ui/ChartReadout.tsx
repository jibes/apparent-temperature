import type { Series } from '../core/series';
import type { StatPoint } from '../core/time';
import { t } from '../i18n';

export interface LegendGroup {
  base: Series | null;
  children: Series[];
}

export const fmtVal = (s: Series, v: number) => (s.dp ? v.toFixed(s.dp) : String(Math.round(v)));

interface Props {
  time: string;
  groups: LegendGroup[];
  pointAt: (s: Series) => StatPoint | null;
  dimmed: (s: Series) => boolean;
  isolated: string | null;
  onIsolate: (key: string) => void;
  showSpread: boolean;
}

// Selected-time legend under the chart: one row per metric, a base and its
// derived values grouped together. Tapping a row isolates its group.
export function ChartReadout({
  time,
  groups,
  pointAt,
  dimmed,
  isolated,
  onIsolate,
  showSpread,
}: Props) {
  const row = (s: Series) => {
    const p = pointAt(s);
    if (!p) return null;
    return (
      <div
        key={s.key}
        className={`fc-rrow ${dimmed(s) ? 'fc-rrow-dim' : ''}`}
        role="button"
        tabIndex={0}
        aria-pressed={isolated === s.key}
        onClick={() => onIsolate(s.key)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onIsolate(s.key);
          }
        }}
      >
        <i className="mdot" style={{ background: s.color }} />
        <span className="fc-rrow-label">{t.metrics[s.key]}</span>
        {/* Range hidden when the models agree after rounding. */}
        {showSpread && fmtVal(s, p.lo) !== fmtVal(s, p.hi) && (
          <span className="fc-rrow-range">
            {fmtVal(s, p.lo)}–{fmtVal(s, p.hi)}
          </span>
        )}
        <span className="fc-rrow-value">
          {fmtVal(s, p.med)} {s.unit}
        </span>
      </div>
    );
  };

  // Deterministic two-column balance (greedy: each group to the shorter
  // column) — CSS multicolumn balanced unpredictably at narrow widths, so the
  // box height wasn't stable.
  const cols: LegendGroup[][] = [[], []];
  const load = [0, 0];
  for (const g of groups) {
    const c = load[0] <= load[1] ? 0 : 1;
    cols[c].push(g);
    load[c] += 1 + g.children.length;
  }

  return (
    <div className="fc-readout">
      <div className="fc-rtime">{time}</div>
      <div className="fc-rlist">
        {cols.map((col, ci) => (
          <div key={ci} className="fc-rcol">
            {col.map((g, gi) => (
              <div key={g.base ? g.base.key : `orphans${gi}`} className="fc-rgroup">
                {g.base && row(g.base)}
                {g.children.length > 0 && (
                  <div className="fc-rgroup-children">{g.children.map(row)}</div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
