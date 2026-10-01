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

// Share of a working day that is off: 1 for a full day, 0.5 for a half day
export const absenceDays = (a: Absence | undefined) => (a ? (a.half ? 0.5 : 1) : 0);

// A full-day absence blocks new bookings on that day (half days don't)
export const blocksBooking = (a: Absence | undefined) => !!a && !a.half;
