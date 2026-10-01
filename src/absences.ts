import { Flag, Thermometer, TreePalm } from 'lucide-react';
import { Absence, AbsenceType } from './types';

export const ABSENCE_TYPES: Record<AbsenceType, {
  label: string;
  icon: typeof TreePalm;
  text: string;      // dark mode text/icon color
  textLight: string; // light mode text/icon color
  stripe: string;    // dark mode column stripe
  stripeLight: string;
}> = {
  ferien:   { label: 'Ferien',   icon: TreePalm,    text: 'text-green-600', textLight: 'text-green-800', stripe: 'rgba(22,163,74,0.10)',   stripeLight: 'rgba(21,128,61,0.08)' },
  krank:    { label: 'Krank',    icon: Thermometer, text: 'text-rose-400',  textLight: 'text-rose-700',  stripe: 'rgba(251,113,133,0.07)', stripeLight: 'rgba(225,29,72,0.07)' },
  feiertag: { label: 'Feiertag', icon: Flag,        text: 'text-sky-300',   textLight: 'text-sky-600',   stripe: 'rgba(125,211,252,0.07)', stripeLight: 'rgba(2,132,199,0.07)' },
};

export const ABSENCE_ORDER: AbsenceType[] = ['ferien', 'krank', 'feiertag'];

// A day holds one full-day absence or up to two half-day absences
// (e.g. ½ Ferien + ½ Feiertag)
export type DayAbsences = Absence[];

// Older absences.json files stored a single object per day
export const toDayAbsences = (v: unknown): DayAbsences =>
  Array.isArray(v) ? v : v && typeof v === 'object' ? [v as Absence] : [];

// Share of a working day that is off: a full day 1, each half 0.5 (max 1)
export const absenceDays = (list: DayAbsences | undefined) =>
  Math.min(1, (list ?? []).reduce((s, a) => s + (a.half ? 0.5 : 1), 0));

export const absenceLabel = (list: DayAbsences) =>
  list.map(a => `${ABSENCE_TYPES[a.type].label}${a.half ? ' ½' : ''}`).join(' + ');

// A full day off (one full-day absence or two halves) blocks new bookings
export const blocksBooking = (list: DayAbsences | undefined) => absenceDays(list) >= 1;
