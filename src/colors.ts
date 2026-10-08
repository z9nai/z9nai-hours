export const CLIENT_COLORS: Record<string, { label: string; bg: string; border: string; dot: string; swatch: string }> = {
  blue:    { label: 'Blau',     bg: 'bg-blue-500/70',    border: 'border-blue-400',    dot: 'bg-blue-400',    swatch: '#60a5fa' },
  emerald: { label: 'Grün',     bg: 'bg-emerald-500/70', border: 'border-emerald-400', dot: 'bg-emerald-400', swatch: '#34d399' },
  violet:  { label: 'Violett',  bg: 'bg-violet-500/70',  border: 'border-violet-400',  dot: 'bg-violet-400',  swatch: '#a78bfa' },
  amber:   { label: 'Orange',   bg: 'bg-amber-500/70',   border: 'border-amber-400',   dot: 'bg-amber-400',   swatch: '#fbbf24' },
  rose:    { label: 'Rot',      bg: 'bg-rose-500/70',    border: 'border-rose-400',    dot: 'bg-rose-400',    swatch: '#fb7185' },
  cyan:    { label: 'Cyan',     bg: 'bg-cyan-500/70',    border: 'border-cyan-400',    dot: 'bg-cyan-400',    swatch: '#22d3ee' },
  pink:    { label: 'Pink',     bg: 'bg-pink-500/70',    border: 'border-pink-400',    dot: 'bg-pink-400',    swatch: '#f472b6' },
  lime:    { label: 'Lime',     bg: 'bg-lime-500/70',    border: 'border-lime-400',    dot: 'bg-lime-400',    swatch: '#a3e635' },
};

export const DEFAULT_COLOR = 'blue';

// Non-billable internal hours (see internal.ts) — not selectable for clients
const INTERNAL_COLOR = { label: 'Grau', bg: 'bg-slate-500/70', border: 'border-slate-400', dot: 'bg-slate-400', swatch: '#94a3b8' };

export function clientColorClasses(colorKey: string) {
  if (colorKey === 'internal') return INTERNAL_COLOR;
  return CLIENT_COLORS[colorKey] ?? CLIENT_COLORS[DEFAULT_COLOR];
}
