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
  ferien:   { label: 'Ferien',   icon: TreePalm,    text: 'text-cyan-400',  textLight: 'text-cyan-700',  stripe: 'rgba(34,211,238,0.07)',  stripeLight: 'rgba(8,145,178,0.08)' },
  krank:    { label: 'Krank',    icon: Thermometer, text: 'text-rose-400',  textLight: 'text-rose-700',  stripe: 'rgba(251,113,133,0.07)', stripeLight: 'rgba(225,29,72,0.07)' },
  feiertag: { label: 'Feiertag', icon: Flag,        text: 'text-amber-400', textLight: 'text-amber-700', stripe: 'rgba(251,191,36,0.07)',  stripeLight: 'rgba(217,119,6,0.08)' },
};

export const ABSENCE_ORDER: AbsenceType[] = ['ferien', 'krank', 'feiertag'];

// Share of a working day that is off: 1 for a full day, 0.5 for a half day
export const absenceDays = (a: Absence | undefined) => (a ? (a.half ? 0.5 : 1) : 0);
