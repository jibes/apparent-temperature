// Display formatting shared by the UI — translated, so it lives outside core/.
import { ageOf, hh } from '../core/time';
import { t } from '../i18n';

export type TempClass = 'very-hot' | 'hot' | 'warm' | 'comfortable' | 'cool' | 'cold' | 'very-cold';

export function colorClass(temp: number): TempClass {
  if (temp >= 40) return 'very-hot';
  if (temp >= 32) return 'hot';
  if (temp >= 26) return 'warm';
  if (temp >= 16) return 'comfortable';
  if (temp >= 8) return 'cool';
  if (temp >= -5) return 'cold';
  return 'very-cold';
}

// Text-only temperature colour (no card background) for the headline value.
export const TEMP_COLOR: Record<TempClass, string> = {
  'very-hot': '#fca5a5',
  hot: '#fdba74',
  warm: '#86efac',
  comfortable: '#93c5fd',
  cool: '#a5b4fc',
  cold: '#7dd3fc',
  'very-cold': '#bae6fd',
};

export const weekday = (d: Date): string => t.weekdays[d.getDay()];

/** "Mo 3.11." / "Mon 11/3" of a wall-clock date. */
export const dateLabel = (d: Date): string => t.date(weekday(d), d.getDate(), d.getMonth() + 1);

/** "Mo 3." / "Mon 3" — chart axis and day tiles. */
export const dayLabel = (d: Date): string => t.dayNum(weekday(d), d.getDate());

/** Relative "updated X ago" label. */
export function agoLabel(ms: number): string {
  const a = ageOf(ms);
  return a.unit === 'now' ? t.age.now : t.age[a.unit](a.n);
}

export function fmtSlot(start: Date, end: Date): string {
  const today = new Date().toDateString() === start.toDateString();
  const day = today ? t.vent.today : weekday(start);
  const eh = String((end.getHours() + 1) % 24).padStart(2, '0');
  return t.vent.slot(day, hh(start), eh);
}
