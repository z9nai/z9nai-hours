import React, { useLayoutEffect, useRef, useState } from 'react';
import { DayAbsences, absenceDays } from '../absences';
import { clientColorClasses } from '../colors';

// Shared building blocks for the Umsatz and Arbeitszeit views

export const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const MONTH_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export type YM = { y: number; m: number };
export type MonthState = 'past' | 'current' | 'future';
export type Absences = Record<string, DayAbsences>;

export function parseMins(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function fmtIso(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// The later of two optional ISO dates ('' = no bound)
export function laterIso(a = '', b = ''): string {
  return a > b ? a : b;
}

export function fmtYm({ y, m }: YM): string {
  return `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}`;
}

// ── Range selection ─────────────────────────────────────────────────────────
export type Range = '3' | '6' | '12' | 'year' | 'from';
const RANGES: { key: Range; label: string }[] = [
  { key: '3', label: '3 Monate' },
  { key: '6', label: '6 Monate' },
  { key: '12', label: '12 Monate' },
  { key: 'year', label: 'Jahr' },
  { key: 'from', label: 'Ab' },
];
const MAX_MONTHS = 36;

// "3 Monate" etc. end with the current month; "Jahr" is Jan–Dez of the current
// year; "Ab" runs from the chosen start month ("YYYY-MM") to the current month.
export function rangeMonths(range: Range, cy: number, cm: number, from: string): YM[] {
  if (range === 'year') return Array.from({ length: 12 }, (_, i) => ({ y: cy, m: i + 1 }));
  let n: number;
  if (range === 'from') {
    const [fy, fm] = from.split('-').map(Number);
    n = fy && fm ? (cy - fy) * 12 + (cm - fm) + 1 : 1;
    n = Math.max(1, Math.min(MAX_MONTHS, n));
  } else {
    n = Number(range);
  }
  const out: YM[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(cy, cm - 1 - i, 1);
    out.push({ y: d.getFullYear(), m: d.getMonth() + 1 });
  }
  return out;
}

export function monthState({ y, m }: YM, cy: number, cm: number): MonthState {
  return y < cy || (y === cy && m < cm) ? 'past' : y === cy && m === cm ? 'current' : 'future';
}

export function RangePicker({ range, setRange, from, setFrom, cy, isDark }: {
  range: Range; setRange: (r: Range) => void;
  from: string; setFrom: (v: string) => void;
  cy: number; isDark: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={`flex rounded border overflow-hidden ${isDark ? 'border-white/10' : 'border-black/10'}`}>
        {RANGES.map(r => (
          <button key={r.key} onClick={() => setRange(r.key)}
            className={`text-xs px-2.5 py-1.5 transition-colors ${
              range === r.key
                ? isDark ? 'bg-white/10 text-white' : 'bg-black/10 text-black'
                : isDark ? 'text-white/40 hover:text-white/70' : 'text-black/40 hover:text-black/70'
            }`}>
            {r.key === 'year' ? `Jahr ${cy}` : r.label}
          </button>
        ))}
      </div>
      {range === 'from' && (
        <input type="month" value={from} onChange={e => e.target.value && setFrom(e.target.value)}
          title={`Startmonat (max. ${MAX_MONTHS} Monate)`}
          className={`text-xs px-2 py-1 rounded border outline-none transition-colors ${
            isDark ? 'bg-white/5 border-white/10 text-white focus:border-white/30 [color-scheme:dark]'
                   : 'bg-black/5 border-black/10 text-black focus:border-black/30'
          }`} />
      )}
    </div>
  );
}

// ── Working days ────────────────────────────────────────────────────────────
// Mon–Fri in a month minus absences (half days count 0.5), optionally only up
// to (and including) a given day and only inside an ISO date window (from/to)
export function workdays(y: number, m: number, off: Absences, uptoDay?: number, from = '', to = ''): number {
  const last = new Date(y, m, 0).getDate();
  const end = Math.min(uptoDay ?? last, last);
  const ym = `${y}-${String(m).padStart(2, '0')}`;
  let n = 0;
  for (let d = 1; d <= end; d++) {
    const wd = new Date(y, m - 1, d).getDay();
    if (wd === 0 || wd === 6) continue;
    const iso = `${ym}-${String(d).padStart(2, '0')}`;
    if ((from && iso < from) || (to && iso > to)) continue;
    n += 1 - absenceDays(off[iso]);
  }
  return n;
}

export const fmtDays = (n: number) => n.toLocaleString('de-CH', { maximumFractionDigits: 1 });

// ── Chart primitives ────────────────────────────────────────────────────────
// 0 plus ~4 clean steps covering max
export function niceTicks(max: number): number[] {
  if (!(max > 0) || !isFinite(max)) return [0, 1];
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(f => f * pow).find(s => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(v);
  return ticks;
}

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// Path for a column with a 4px rounded top and a square base
export function columnPath(x: number, y: number, w: number, h: number, round: boolean): string {
  if (h <= 0) return '';
  const r = round ? Math.min(4, h, w / 2) : 0;
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

export interface Theme {
  isDark: boolean;
  grid: string;
  axisText: string;
  ink: string;
  surface: string;
  ghost: string;
}

export function chartTheme(isDark: boolean): Theme {
  return {
    isDark,
    grid: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    axisText: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.45)',
    ink: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.8)',
    surface: isDark ? '#0e0f11' : '#f5f4f0',
    ghost: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
  };
}

export function Tooltip({ x, width, children, isDark }: { x: number; width: number; children: React.ReactNode; isDark: boolean }) {
  const half = 105;
  const left = Math.max(half, Math.min(width - half, x));
  return (
    <div
      className={`absolute top-0 pointer-events-none z-10 w-[210px] rounded-lg border shadow-lg px-3 py-2 text-[11px] ${
        isDark ? 'bg-[#1a1b20] border-white/10 text-white/80' : 'bg-white border-black/10 text-black/80'
      }`}
      style={{ left, transform: 'translateX(-50%)' }}
    >
      {children}
    </div>
  );
}

export function TipRow({ label, value, dot, strong, muted }: { label: string; value: string; dot?: string; strong?: boolean; muted?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? 'font-semibold' : ''}`}>
      <span className={`flex items-center gap-1.5 truncate ${muted ?? ''}`}>
        {dot && <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />}
        {label}
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function LegendItem({ kind, color, label, className }: {
  kind: 'dot' | 'line' | 'dash' | 'box'; color: string; label: string; className?: string;
}) {
  return (
    <span className="flex items-center gap-1">
      {kind === 'dot' && <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />}
      {kind === 'line' && <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: color }} />}
      {kind === 'dash' && (
        <svg width={12} height={2} className="inline-block"><line x1={0} x2={12} y1={1} y2={1} stroke={color} strokeWidth={2} strokeDasharray="3 2" /></svg>
      )}
      {kind === 'box' && <span className="inline-block w-2 h-2 rounded-sm" style={{ background: color }} />}
      <span className={className}>{label}</span>
    </span>
  );
}

// ── Monthly columns ─────────────────────────────────────────────────────────
// Stacked per client, target as a tick across each column, optional forecast
// wash for the running month and an optional ceiling ("max") as a dashed step line.
export interface MonthBar {
  ym: YM;
  state: MonthState;
  actual: number;
  target: number;
  forecast: number | null;
  max?: number;
}
export interface BarSeries { id: string; name: string; color: string; values: number[] }

export function MonthlyChart({ months, series, theme, fmt, axisFmt, targetLabel, maxLabel, pctLabel }: {
  months: MonthBar[];
  series: BarSeries[];
  theme: Theme;
  fmt: (v: number) => string;
  axisFmt: (v: number) => string;
  targetLabel: string;
  maxLabel?: string;
  pctLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 220, mt = 12, mb = 24, ml = 44, mr = 8;
  const plotW = Math.max(0, width - ml - mr), plotH = H - mt - mb;
  const n = months.length;
  const band = n > 0 ? plotW / n : 0;
  const barW = Math.min(24, band * 0.5);
  const max = Math.max(1, ...months.map(m => Math.max(m.actual, m.forecast ?? 0, m.target, m.max ?? 0)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const yOf = (v: number) => mt + plotH - (v / top) * plotH;
  const muted = theme.isDark ? 'text-white/40' : 'text-black/40';

  // Ceiling as a step line over contiguous months that have one
  let maxPath = '';
  months.forEach((mi, i) => {
    const v = mi.max ?? 0;
    if (v <= 0) return;
    const x0 = ml + band * i + 3, x1 = ml + band * (i + 1) - 3, y = yOf(v);
    const prev = i > 0 ? months[i - 1].max ?? 0 : 0;
    maxPath += prev > 0 ? ` L${x0 - 6},${y} H${x1}` : ` M${x0},${y} H${x1}`;
  });

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={H} className="block">
          {ticks.map(t => (
            <g key={t}>
              <line x1={ml} x2={width - mr} y1={yOf(t)} y2={yOf(t)} stroke={theme.grid} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={ml - 8} y={yOf(t)} dy="0.32em" textAnchor="end" fontSize={10} fill={theme.axisText} className="tabular-nums">{axisFmt(t)}</text>
            </g>
          ))}
          {months.map((mi, i) => {
            const cx = ml + band * i + band / 2;
            const x = cx - barW / 2;
            // Stack segments bottom-up in fixed client order, 2px surface gap between them
            const segs: { y: number; h: number; color: string }[] = [];
            let acc = 0;
            series.forEach(s => {
              const v = s.values[i] ?? 0;
              if (v <= 0) return;
              const y0 = yOf(acc), y1 = yOf(acc + v);
              segs.push({ y: y1, h: y0 - y1, color: clientColorClasses(s.color).swatch });
              acc += v;
            });
            const dim = hover != null && hover !== i;
            return (
              <g key={`${mi.ym.y}-${mi.ym.m}`} opacity={dim ? 0.45 : 1}>
                {hover === i && <rect x={ml + band * i} y={mt} width={band} height={plotH} fill={theme.ghost} />}
                {/* Forecast for the running month: the remainder as a light wash */}
                {mi.forecast != null && mi.forecast > mi.actual && (
                  <path d={columnPath(x, yOf(mi.forecast), barW, yOf(mi.actual) - yOf(mi.forecast) - (mi.actual > 0 ? 2 : 0), true)}
                    fill={theme.ink} fillOpacity={0.12} />
                )}
                {segs.map((sg, j) => {
                  const h = j > 0 ? sg.h - 2 : sg.h; // gap below every segment except the base one
                  return <path key={j} d={columnPath(x, sg.y, barW, Math.max(0, h), j === segs.length - 1)} fill={sg.color} />;
                })}
                {mi.target > 0 && (
                  <line x1={cx - barW / 2 - 6} x2={cx + barW / 2 + 6} y1={yOf(mi.target)} y2={yOf(mi.target)}
                    stroke={theme.ink} strokeWidth={2} strokeLinecap="round" />
                )}
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={10}
                  fill={mi.state === 'current' ? theme.ink : theme.axisText}
                  fontWeight={mi.state === 'current' ? 600 : 400}>
                  {MONTH_SHORT[mi.ym.m - 1]}{(i === 0 || mi.ym.m === 1) && n <= 12 ? ` ${String(mi.ym.y).slice(2)}` : ''}
                </text>
              </g>
            );
          })}
          {maxPath && (
            <path d={maxPath} fill="none" stroke={theme.axisText} strokeWidth={2} strokeDasharray="4 3" strokeLinejoin="round" />
          )}
          {months.map((mi, i) => (
            <rect key={i} x={ml + band * i} y={0} width={band} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
      )}
      {hover != null && months[hover] && (() => {
        const mi = months[hover];
        const cx = ml + band * hover + band / 2;
        return (
          <Tooltip x={cx} width={width} isDark={theme.isDark}>
            <div className="font-semibold mb-1">{MONTH_NAMES[mi.ym.m - 1]} {mi.ym.y}{mi.state === 'current' ? ' (laufend)' : ''}</div>
            {mi.state !== 'future' && series.filter(s => (s.values[hover] ?? 0) > 0).map(s => (
              <TipRow key={s.id} label={s.name} value={fmt(s.values[hover])} dot={clientColorClasses(s.color).dot} />
            ))}
            {mi.state !== 'future' && <TipRow label="Ist" value={fmt(mi.actual)} strong />}
            {mi.forecast != null && <TipRow label="Hochrechnung" value={fmt(mi.forecast)} muted={muted} />}
            <TipRow label={targetLabel} value={mi.target > 0 ? fmt(mi.target) : '—'} muted={muted} />
            {maxLabel && (mi.max ?? 0) > 0 && <TipRow label={maxLabel} value={fmt(mi.max!)} muted={muted} />}
            {mi.state !== 'future' && mi.target > 0 && <TipRow label={pctLabel} value={`${Math.round((mi.actual / mi.target) * 100)}%`} muted={muted} />}
          </Tooltip>
        );
      })()}
    </div>
  );
}
