// Ventilation verdict, reason and outcome — pure, returns keys + numbers;
// the UI turns them into translated text.
import { absoluteHumidity, dewPoint, ventilationAssessment } from './formulas';

export type VerdictKey =
  'condensation' | 'recommended' | 'sensible' | 'weigh' | 'noEffect' | 'notRecommended';
export type Tone = 'good' | 'bad' | 'warn' | 'neutral';

export function ventVerdict(
  Tin: number,
  RHin: number,
  Tout: number,
  RHout: number,
  elevM = 0,
): { key: VerdictKey; cls: Tone } {
  const a = ventilationAssessment(Tin, RHin, Tout, RHout, elevM);
  const dry = a.deltaAH < -0.3;
  const wet = a.deltaAH > 0.3;
  const cool = a.deltaH < -0.5;
  const warm = a.deltaH > 0.5;
  if (a.condensationRisk) return { key: 'condensation', cls: 'bad' };
  if (dry && cool) return { key: 'recommended', cls: 'good' };
  if (dry && !warm) return { key: 'sensible', cls: 'good' };
  if (dry || cool) return { key: 'weigh', cls: 'warn' };
  if (!wet && !warm) return { key: 'noEffect', cls: 'neutral' };
  return { key: 'notRecommended', cls: 'bad' };
}

/** Why the verdict is what it is: a case plus the numbers its sentence needs. */
export type Reason =
  | { kind: 'condensation'; dpOut: number; Tin: number }
  | { kind: 'drierCooler'; ahOut: number; ahIn: number; dH: number }
  | { kind: 'drierWarmer' | 'drierSimilar'; dH: number }
  | { kind: 'coolerWetter'; ahOut: number; ahIn: number }
  | { kind: 'same' }
  | { kind: 'wetter' | 'wetterWarmer'; ahOut: number; ahIn: number; dH: number };

export function ventReason(
  Tin: number,
  RHin: number,
  Tout: number,
  RHout: number,
  elevM = 0,
): Reason {
  const a = ventilationAssessment(Tin, RHin, Tout, RHout, elevM);
  const ahIn = absoluteHumidity(Tin, RHin);
  const ahOut = absoluteHumidity(Tout, RHout);
  if (a.condensationRisk) return { kind: 'condensation', dpOut: dewPoint(Tout, RHout), Tin };
  if (a.deltaAH < -0.3 && a.deltaH < -0.5)
    return { kind: 'drierCooler', ahOut, ahIn, dH: a.deltaH };
  if (a.deltaAH < -0.3)
    return { kind: a.deltaH > 0.5 ? 'drierWarmer' : 'drierSimilar', dH: a.deltaH };
  if (a.deltaH < -0.5) return { kind: 'coolerWetter', ahOut, ahIn };
  if (Math.abs(a.deltaAH) < 0.3 && Math.abs(a.deltaH) < 0.5) return { kind: 'same' };
  // "warmer" only above the same threshold the verdict chip uses — otherwise
  // chip and sentence could disagree in the 0–0.5 kJ/kg band.
  return { kind: a.deltaH > 0.5 ? 'wetterWarmer' : 'wetter', ahOut, ahIn, dH: a.deltaH };
}

/** What opening the windows would actually DO. */
export type Effect =
  | { kind: 'condensation' }
  | { kind: 'moisture'; up: boolean; amount: number }
  | { kind: 'heat'; up: boolean; amount: number }
  | { kind: 'freshAir' };

// Capped at two (moisture + heat) so the chip area stays within its reserved
// height; condensation dominates everything else.
export function ventEffects(
  Tin: number,
  RHin: number,
  Tout: number,
  RHout: number,
  elevM = 0,
): Effect[] {
  const a = ventilationAssessment(Tin, RHin, Tout, RHout, elevM);
  if (a.condensationRisk) return [{ kind: 'condensation' }];
  const out: Effect[] = [];
  if (Math.abs(a.deltaAH) >= 0.3)
    out.push({ kind: 'moisture', up: a.deltaAH > 0, amount: Math.abs(a.deltaAH) });
  if (Math.abs(a.deltaH) >= 0.5)
    out.push({ kind: 'heat', up: a.deltaH > 0, amount: Math.abs(a.deltaH) });
  if (!out.length) out.push({ kind: 'freshAir' });
  return out;
}

/** How long to air, from the in/out gradient and wind (exchange speed). */
export function ventDuration(dT: number, wind: number): 'short' | 'medium' | 'long' {
  const grad = Math.abs(dT) + wind / 5;
  return grad >= 8 ? 'short' : grad >= 4 ? 'medium' : 'long';
}
