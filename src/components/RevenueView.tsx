import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useStore } from '../store';
import { Client } from '../types';
import { clientColorClasses } from '../colors';

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

type Range = '3' | '6' | '12' | 'year';
const RANGES: { key: Range; label: string }[] = [
  { key: '3', label: '3 Monate' },
  { key: '6', label: '6 Monate' },
  { key: '12', label: '12 Monate' },
  { key: 'year', label: 'Jahr' },
];

type YM = { y: number; m: number };

function parseMins(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function fmtChf(amount: number): string {
  return `CHF ${Math.round(amount).toLocaleString('de-CH')}`;
}

function fmtAxis(v: number): string {
  return v >= 1000 ? `${(v / 1000).toLocaleString('de-CH', { maximumFractionDigits: 1 })}k` : String(Math.round(v));
}

function fmtIso(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

// "3 Monate" etc. end with the current month; "Jahr" is Jan–Dez of the current year
function rangeMonths(range: Range, cy: number, cm: number): YM[] {
  if (range === 'year') return Array.from({ length: 12 }, (_, i) => ({ y: cy, m: i + 1 }));
  const n = Number(range);
  const out: YM[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(cy, cm - 1 - i, 1);
    out.push({ y: d.getFullYear(), m: d.getMonth() + 1 });
  }
  return out;
}

const NO_DAYS: ReadonlySet<string> = new Set();

// Mon–Fri in a month minus Ferien, optionally only up to (and including) a
// given day and only inside an ISO date window (from/to, each optional)
function workdays(y: number, m: number, off: ReadonlySet<string>, uptoDay?: number, from = '', to = ''): number {
  const last = new Date(y, m, 0).getDate();
  const end = Math.min(uptoDay ?? last, last);
  const ym = `${y}-${String(m).padStart(2, '0')}`;
  let n = 0;
  for (let d = 1; d <= end; d++) {
    const wd = new Date(y, m - 1, d).getDay();
    if (wd === 0 || wd === 6) continue;
    const iso = `${ym}-${String(d).padStart(2, '0')}`;
    if (off.has(iso) || (from && iso < from) || (to && iso > to)) continue;
    n++;
  }
  return n;
}

// A client's revenue target for one month: only during the mandate (the
// Kontingent period, if set); partial months pro-rata by working days.
// With uptoDay only the share up to that day ("Soll bis heute"). Ferien don't
// lower a full month's target, they only shift how it spreads over the month.
function clientTarget(c: Client, y: number, m: number, off: ReadonlySet<string>, uptoDay?: number): number {
  const t = c.revenueTarget ?? 0;
  if (t <= 0) return 0;
  const total = workdays(y, m, off);
  return total > 0 ? (t * workdays(y, m, off, uptoDay, c.quota?.from, c.quota?.to)) / total : 0;
}

// 0 plus ~4 clean steps covering max
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1000];
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(f => f * pow).find(s => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(v);
  return ticks;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
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
function columnPath(x: number, y: number, w: number, h: number, round: boolean): string {
  if (h <= 0) return '';
  const r = round ? Math.min(4, h, w / 2) : 0;
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

interface Theme {
  isDark: boolean;
  grid: string;
  axisText: string;
  ink: string;
  surface: string;
  ghost: string;
}

interface Series { client: Client; values: number[] }

interface MonthInfo {
  ym: YM;
  state: 'past' | 'current' | 'future';
  actual: number;
  target: number;
  targetToDate: number;    // running month: pro-rata by working days elapsed
  forecast: number | null; // only for the current month
}

function Tooltip({ x, width, children, isDark }: { x: number; width: number; children: React.ReactNode; isDark: boolean }) {
  const half = 100;
  const left = Math.max(half, Math.min(width - half, x));
  return (
    <div
      className={`absolute top-0 pointer-events-none z-10 w-[200px] rounded-lg border shadow-lg px-3 py-2 text-[11px] ${
        isDark ? 'bg-[#1a1b20] border-white/10 text-white/80' : 'bg-white border-black/10 text-black/80'
      }`}
      style={{ left, transform: 'translateX(-50%)' }}
    >
      {children}
    </div>
  );
}

function TipRow({ label, value, dot, strong, muted }: { label: string; value: string; dot?: string; strong?: boolean; muted?: string }) {
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

// ── Monthly columns: stacked per client, target as a tick across each column ──
function MonthlyChart({ months, series, theme }: { months: MonthInfo[]; series: Series[]; theme: Theme }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 220, mt = 12, mb = 24, ml = 44, mr = 8;
  const plotW = Math.max(0, width - ml - mr), plotH = H - mt - mb;
  const n = months.length;
  const band = n > 0 ? plotW / n : 0;
  const barW = Math.min(24, band * 0.5);
  const max = Math.max(1, ...months.map(m => Math.max(m.actual, m.forecast ?? 0, m.target)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const yOf = (v: number) => mt + plotH - (v / top) * plotH;
  const muted = theme.isDark ? 'text-white/40' : 'text-black/40';

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={H} className="block">
          {ticks.map(t => (
            <g key={t}>
              <line x1={ml} x2={width - mr} y1={yOf(t)} y2={yOf(t)} stroke={theme.grid} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={ml - 8} y={yOf(t)} dy="0.32em" textAnchor="end" fontSize={10} fill={theme.axisText} className="tabular-nums">{fmtAxis(t)}</text>
            </g>
          ))}
          {months.map((mi, i) => {
            const cx = ml + band * i + band / 2;
            const x = cx - barW / 2;
            // Stack segments bottom-up in fixed client order, 2px surface gap between them
            const segs: { y: number; h: number; color: string }[] = [];
            let acc = 0;
            series.forEach(s => {
              const v = s.values[i];
              if (v <= 0) return;
              const y0 = yOf(acc), y1 = yOf(acc + v);
              segs.push({ y: y1, h: y0 - y1, color: clientColorClasses(s.client.color).swatch });
              acc += v;
            });
            const isHover = hover === i;
            const dim = hover != null && !isHover;
            return (
              <g key={`${mi.ym.y}-${mi.ym.m}`} opacity={dim ? 0.45 : 1}>
                {isHover && <rect x={ml + band * i} y={mt} width={band} height={plotH} fill={theme.ghost} />}
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
                  {MONTH_SHORT[mi.ym.m - 1]}{i === 0 || mi.ym.m === 1 ? ` ${String(mi.ym.y).slice(2)}` : ''}
                </text>
                <rect x={ml + band * i} y={0} width={band} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
      )}
      {hover != null && (() => {
        const mi = months[hover];
        const cx = ml + band * hover + band / 2;
        return (
          <Tooltip x={cx} width={width} isDark={theme.isDark}>
            <div className="font-semibold mb-1">{MONTH_NAMES[mi.ym.m - 1]} {mi.ym.y}{mi.state === 'current' ? ' (laufend)' : ''}</div>
            {mi.state !== 'future' && series.filter(s => s.values[hover] > 0).map(s => (
              <TipRow key={s.client.id} label={s.client.name} value={fmtChf(s.values[hover])} dot={clientColorClasses(s.client.color).dot} />
            ))}
            {mi.state !== 'future' && <TipRow label="Ist" value={fmtChf(mi.actual)} strong />}
            {mi.forecast != null && <TipRow label="Hochrechnung" value={fmtChf(mi.forecast)} muted={muted} />}
            <TipRow label="Ziel" value={mi.target > 0 ? fmtChf(mi.target) : '—'} muted={muted} />
            {mi.state !== 'future' && mi.target > 0 && <TipRow label="Erreicht" value={fmtPct(mi.actual / mi.target)} muted={muted} />}
          </Tooltip>
        );
      })()}
    </div>
  );
}

// ── Cumulative Ist vs. Ziel over the range ──
function CumulativeChart({ months, theme, accent }: { months: MonthInfo[]; theme: Theme; accent: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 200, mt = 12, mb = 24, ml = 44, mr = 64;
  const plotW = Math.max(0, width - ml - mr), plotH = H - mt - mb;
  const n = months.length;
  const band = n > 0 ? plotW / n : 0;

  const cumTarget: number[] = [];
  const cumActual: (number | null)[] = [];
  let t = 0, a = 0;
  months.forEach(mi => {
    t += mi.targetToDate; cumTarget.push(t);
    if (mi.state === 'future') { cumActual.push(null); return; }
    a += mi.actual; cumActual.push(a);
  });
  const max = Math.max(1, t, a);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const yOf = (v: number) => mt + plotH - (v / top) * plotH;
  const xOf = (i: number) => ml + band * i + band / 2;

  const targetPts = cumTarget.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ');
  const actualIdx = cumActual.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0);
  const actualPts = actualIdx.map(i => `${xOf(i)},${yOf(cumActual[i]!)}`).join(' ');
  const lastA = actualIdx[actualIdx.length - 1];
  const areaPath = actualIdx.length > 0
    ? `M${xOf(actualIdx[0])},${yOf(0)} L${actualPts.split(' ').join(' L')} L${xOf(lastA)},${yOf(0)} Z`
    : '';
  const hasTarget = t > 0;
  const muted = theme.isDark ? 'text-white/40' : 'text-black/40';

  // End labels: Ist at its last point, Ziel at the end; skip Ziel when they would collide
  const ziellabelY = yOf(cumTarget[n - 1] ?? 0);
  const istLabelY = lastA != null ? yOf(cumActual[lastA]!) : 0;
  const collide = lastA === n - 1 && Math.abs(ziellabelY - istLabelY) < 12;

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={H} className="block"
          onMouseMove={e => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const i = Math.floor((e.clientX - r.left - ml) / band);
            setHover(i >= 0 && i < n ? i : null);
          }}>
          {ticks.map(tk => (
            <g key={tk}>
              <line x1={ml} x2={ml + plotW} y1={yOf(tk)} y2={yOf(tk)} stroke={theme.grid} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={ml - 8} y={yOf(tk)} dy="0.32em" textAnchor="end" fontSize={10} fill={theme.axisText}>{fmtAxis(tk)}</text>
            </g>
          ))}
          {months.map((mi, i) => (
            <text key={i} x={xOf(i)} y={H - 8} textAnchor="middle" fontSize={10}
              fill={mi.state === 'current' ? theme.ink : theme.axisText} fontWeight={mi.state === 'current' ? 600 : 400}>
              {MONTH_SHORT[mi.ym.m - 1]}
            </text>
          ))}
          {hover != null && (
            <line x1={xOf(hover)} x2={xOf(hover)} y1={mt} y2={mt + plotH} stroke={theme.axisText} strokeWidth={1} shapeRendering="crispEdges" />
          )}
          {hasTarget && (
            <polyline points={targetPts} fill="none" stroke={theme.axisText} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {areaPath && <path d={areaPath} fill={accent} fillOpacity={0.1} />}
          {actualIdx.length > 0 && (
            <polyline points={actualPts} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {lastA != null && (
            <circle cx={xOf(lastA)} cy={istLabelY} r={4} fill={accent} stroke={theme.surface} strokeWidth={2} />
          )}
          {hover != null && cumActual[hover] != null && hover !== lastA && (
            <circle cx={xOf(hover)} cy={yOf(cumActual[hover]!)} r={4} fill={accent} stroke={theme.surface} strokeWidth={2} />
          )}
          {hover != null && hasTarget && (
            <circle cx={xOf(hover)} cy={yOf(cumTarget[hover])} r={4} fill={theme.axisText} stroke={theme.surface} strokeWidth={2} />
          )}
          {lastA != null && (
            <text x={xOf(lastA) + 8} y={istLabelY} dy="0.32em" fontSize={10} fill={theme.ink} fontWeight={600}>
              Ist {fmtAxis(cumActual[lastA]!)}
            </text>
          )}
          {hasTarget && !collide && (
            <text x={xOf(n - 1) + 8} y={ziellabelY} dy="0.32em" fontSize={10} fill={theme.axisText}>
              Ziel {fmtAxis(cumTarget[n - 1])}
            </text>
          )}
        </svg>
      )}
      {hover != null && (() => {
        const mi = months[hover];
        const act = cumActual[hover];
        const tgt = cumTarget[hover];
        return (
          <Tooltip x={xOf(hover)} width={width} isDark={theme.isDark}>
            <div className="font-semibold mb-1">bis {MONTH_NAMES[mi.ym.m - 1]} {mi.ym.y}</div>
            {act != null && <TipRow label="Ist kumuliert" value={fmtChf(act)} strong />}
            <TipRow label={mi.state === 'current' ? 'Soll bis heute' : 'Ziel kumuliert'} value={hasTarget ? fmtChf(tgt) : '—'} muted={muted} />
            {act != null && hasTarget && (
              <TipRow label={act >= tgt ? 'Vorsprung' : 'Rückstand'} value={fmtChf(Math.abs(act - tgt))} muted={muted} />
            )}
          </Tooltip>
        );
      })()}
    </div>
  );
}

export default function RevenueView() {
  const { clients, isDark, entries, readMonthEntries, vacations } = useStore();
  const off = useMemo(() => new Set(vacations), [vacations]);
  const [range, setRange] = useState<Range>('6');
  const [clientId, setClientId] = useState<string>('all');

  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth() + 1, today = now.getDate();
  const months = useMemo(() => rangeMonths(range, cy, cm), [range, cy, cm]);
  const stateOf = ({ y, m }: YM): MonthInfo['state'] =>
    y < cy || (y === cy && m < cm) ? 'past' : y === cy && m === cm ? 'current' : 'future';

  // clientId → revenue per month (aligned to `months`); future months are not read.
  // Like the targets, revenue only counts during the client's mandate.
  const [revenue, setRevenue] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const byId = new Map(clients.map(c => [c.id, c]));
      const out: Record<string, number[]> = {};
      for (const c of clients) out[c.id] = months.map(() => 0);
      for (let i = 0; i < months.length; i++) {
        if (stateOf(months[i]) === 'future') continue;
        const es = await readMonthEntries(months[i].y, months[i].m);
        for (const e of es) {
          const c = byId.get(e.clientId);
          if (c?.hourlyRate == null) continue;
          if (c.quota && (e.date < c.quota.from || e.date > c.quota.to)) continue;
          out[c.id][i] += ((parseMins(e.endTime) - parseMins(e.startTime)) / 60) * c.hourlyRate;
        }
      }
      if (!cancelled) { setRevenue(out); setLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, clients, entries, readMonthEntries]);

  const shown = clientId === 'all' ? clients : clients.filter(c => c.id === clientId);
  const series: Series[] = shown
    .map(c => ({ client: c, values: revenue[c.id] ?? months.map(() => 0) }))
    .filter(s => s.values.some(v => v > 0) || (s.client.revenueTarget ?? 0) > 0);
  const hasTargets = shown.some(c => (c.revenueTarget ?? 0) > 0);
  const targetOf = ({ y, m }: YM, uptoDay?: number) => shown.reduce((s, c) => s + clientTarget(c, y, m, off, uptoDay), 0);

  // Pace through the running month, by working days without Ferien
  const wdTotal = workdays(cy, cm, off);
  const wdElapsed = workdays(cy, cm, off, today);
  const vacDays = workdays(cy, cm, NO_DAYS) - wdTotal;
  const pace = wdTotal > 0 ? wdElapsed / wdTotal : 1;

  const monthInfos: MonthInfo[] = months.map((ym, i) => {
    const state = stateOf(ym);
    const actual = state === 'future' ? 0 : series.reduce((s, x) => s + x.values[i], 0);
    return {
      ym, state, actual, target: targetOf(ym),
      targetToDate: state === 'current' ? targetOf(ym, today) : targetOf(ym),
      forecast: state === 'current' && wdElapsed > 0 ? actual / pace : null,
    };
  });

  const cur = monthInfos.find(m => m.state === 'current');
  const curActual = cur?.actual ?? 0;
  const curForecast = cur?.forecast ?? curActual;
  const monthlyTarget = cur?.target ?? 0; // running month, within mandates
  const sollToday = cur?.targetToDate ?? 0;
  const onPace = curActual >= sollToday;

  const elapsed = monthInfos.filter(m => m.state !== 'future');
  const rangeActual = elapsed.reduce((s, m) => s + m.actual, 0);
  const rangeSoll = elapsed.reduce((s, m) => s + m.targetToDate, 0);
  const rangeLabel = elapsed.length > 0
    ? `${MONTH_SHORT[elapsed[0].ym.m - 1]} ${String(elapsed[0].ym.y).slice(2)} – ${MONTH_SHORT[elapsed[elapsed.length - 1].ym.m - 1]} ${String(elapsed[elapsed.length - 1].ym.y).slice(2)}`
    : '';

  const theme: Theme = {
    isDark,
    grid: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    axisText: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.45)',
    ink: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.8)',
    surface: isDark ? '#0e0f11' : '#f5f4f0',
    ghost: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
  };
  const single = clientId !== 'all' ? clients.find(c => c.id === clientId) : undefined;
  const accent = single ? clientColorClasses(single.color).swatch : (isDark ? '#60a5fa' : '#2563eb');

  const border = isDark ? 'border-white/8' : 'border-black/8';
  const muted = isDark ? 'text-white/35' : 'text-black/35';
  const strong = isDark ? 'text-white' : 'text-black';
  const soft = isDark ? 'text-white/60' : 'text-black/60';
  const selectCls = isDark
    ? 'bg-white/5 border-white/10 text-white focus:border-white/30'
    : 'bg-black/5 border-black/10 text-black focus:border-black/30';
  const headCls = `px-4 py-2 text-[10px] uppercase tracking-widest ${muted} ${isDark ? 'bg-white/2' : 'bg-black/2'}`;
  const statusGood = isDark ? 'text-emerald-400' : 'text-emerald-600';
  const statusWarn = isDark ? 'text-amber-400' : 'text-amber-600';
  const missingRate = clients.filter(c => c.hourlyRate == null);

  const Meter = ({ value, marker }: { value: number; marker?: number }) => (
    <div className={`relative h-1.5 rounded-full mt-3 ${isDark ? 'bg-white/8' : 'bg-black/8'}`}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(value, 1) * 100}%`, background: accent }} />
      {marker != null && (
        <div className={`absolute -top-1 w-0.5 h-3.5 rounded-full ${isDark ? 'bg-white/70' : 'bg-black/70'}`}
          style={{ left: `calc(${Math.min(marker, 1) * 100}% - 1px)` }} title="Soll bis heute" />
      )}
    </div>
  );

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header + filters */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className={`text-sm font-semibold uppercase tracking-widest ${isDark ? 'text-white/50' : 'text-black/50'}`}>
          Umsatz
        </h2>
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
          <select value={clientId} onChange={e => setClientId(e.target.value)}
            className={`text-xs px-2 py-1.5 rounded border outline-none transition-colors ${selectCls}`}>
            <option value="all">Alle Kunden</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {!hasTargets && (
        <div className={`rounded-xl border px-4 py-3 mb-6 text-xs ${isDark ? 'border-blue-500/20 bg-blue-950/30 text-blue-300/80' : 'border-blue-200 bg-blue-50 text-blue-700/80'}`}>
          {clientId === 'all'
            ? 'Noch keine Umsatzziele erfasst — im Kunden-Tab pro Kunde ein monatliches Ziel eingeben.'
            : 'Für diesen Kunden ist kein Umsatzziel erfasst — im Kunden-Tab eingeben.'}
        </div>
      )}

      {/* ── Stat tiles ── */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className={`rounded-xl border ${border} px-4 py-3`}>
          <div className={`text-[10px] uppercase tracking-widest ${muted}`}>{MONTH_NAMES[cm - 1]} bisher</div>
          <div className={`text-xl font-semibold mt-1 ${strong}`}>{fmtChf(curActual)}</div>
          <div className={`text-[11px] mt-0.5 ${muted}`}>
            {monthlyTarget > 0 ? <>von {fmtChf(monthlyTarget)} · {fmtPct(curActual / monthlyTarget)}</> : 'kein Ziel'}
          </div>
          {monthlyTarget > 0 && <Meter value={curActual / monthlyTarget} marker={sollToday / monthlyTarget} />}
          {monthlyTarget > 0 && (
            <div className="flex items-center flex-wrap gap-x-1 text-[11px] mt-2">
              <span className={`flex items-center gap-1 whitespace-nowrap ${onPace ? statusGood : statusWarn}`}>
                {onPace ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {onPace ? 'Im Plan' : 'Hinter Plan'}
              </span>
              <span className={`whitespace-nowrap ${muted}`}>· Soll heute {fmtChf(sollToday)}</span>
            </div>
          )}
        </div>
        <div className={`rounded-xl border ${border} px-4 py-3`}>
          <div className={`text-[10px] uppercase tracking-widest ${muted}`}>Hochrechnung {MONTH_NAMES[cm - 1]}</div>
          <div className={`text-xl font-semibold mt-1 ${strong}`}>{fmtChf(curForecast)}</div>
          <div className={`text-[11px] mt-0.5 ${muted}`}>
            {monthlyTarget > 0 ? <>{fmtPct(curForecast / monthlyTarget)} vom Ziel · </> : null}
            {wdElapsed}/{wdTotal} Arbeitstage{vacDays > 0 && ` (ohne ${vacDays} Ferientag${vacDays > 1 ? 'e' : ''})`}
          </div>
          {monthlyTarget > 0 && <Meter value={curForecast / monthlyTarget} />}
          {monthlyTarget > 0 && (
            <div className={`text-[11px] mt-2 ${muted}`}>
              {curForecast >= monthlyTarget
                ? `+${fmtChf(curForecast - monthlyTarget)} über Ziel`
                : `${fmtChf(monthlyTarget - curForecast)} unter Ziel`}
            </div>
          )}
        </div>
        <div className={`rounded-xl border ${border} px-4 py-3`}>
          <div className={`text-[10px] uppercase tracking-widest ${muted}`}>Zeitraum {rangeLabel}</div>
          <div className={`text-xl font-semibold mt-1 ${strong}`}>{fmtChf(rangeActual)}</div>
          <div className={`text-[11px] mt-0.5 ${muted}`}>
            {rangeSoll > 0 ? <>Soll bis heute {fmtChf(rangeSoll)} · {fmtPct(rangeActual / rangeSoll)}</> : 'kein Ziel'}
          </div>
          {rangeSoll > 0 && <Meter value={rangeActual / rangeSoll} />}
          {rangeSoll > 0 && (
            <div className={`flex items-center gap-1 text-[11px] mt-2 ${rangeActual >= rangeSoll ? statusGood : statusWarn}`}>
              {rangeActual >= rangeSoll ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {rangeActual >= rangeSoll
                ? `${fmtChf(rangeActual - rangeSoll)} Vorsprung`
                : `${fmtChf(rangeSoll - rangeActual)} Rückstand`}
            </div>
          )}
        </div>
      </div>

      {/* ── Monthly chart ── */}
      <div className={`rounded-xl border ${border} mb-6`}>
        <div className={`flex items-center justify-between rounded-t-xl ${headCls}`}>
          <span>Umsatz pro Monat</span>
          <span className="flex items-center gap-3 normal-case tracking-normal flex-wrap justify-end">
            {series.length > 1 && series.map(s => (
              <span key={s.client.id} className="flex items-center gap-1">
                <span className={`inline-block w-2 h-2 rounded-full ${clientColorClasses(s.client.color).dot}`} />
                <span className={soft}>{s.client.name}</span>
              </span>
            ))}
            {hasTargets && (
              <span className="flex items-center gap-1">
                <span className={`inline-block w-3 h-0.5 rounded-full ${isDark ? 'bg-white/85' : 'bg-black/80'}`} />
                <span className={soft}>Ziel</span>
              </span>
            )}
            {cur && (
              <span className="flex items-center gap-1">
                <span className={`inline-block w-2 h-2 rounded-sm ${isDark ? 'bg-white/15' : 'bg-black/15'}`} />
                <span className={soft}>Hochrechnung</span>
              </span>
            )}
          </span>
        </div>
        <div className="px-2 py-3">
          {loading ? <div className={`h-[220px] text-xs flex items-center justify-center ${muted}`}>Lade…</div>
            : <MonthlyChart months={monthInfos} series={series} theme={theme} />}
        </div>
      </div>

      {/* ── Cumulative chart ── */}
      <div className={`rounded-xl border ${border} mb-6`}>
        <div className={`flex items-center justify-between rounded-t-xl ${headCls}`}>
          <span>Kumuliert: Ist vs. Ziel</span>
          <span className="flex items-center gap-3 normal-case tracking-normal">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: accent }} />
              <span className={soft}>Ist</span>
            </span>
            {hasTargets && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: theme.axisText }} />
                <span className={soft}>Ziel</span>
              </span>
            )}
          </span>
        </div>
        <div className="px-2 py-3">
          {loading ? <div className={`h-[200px] text-xs flex items-center justify-center ${muted}`}>Lade…</div>
            : <CumulativeChart months={monthInfos} theme={theme} accent={accent} />}
        </div>
      </div>

      {/* ── Per-client achievement ── */}
      <div className={`rounded-xl border ${border} overflow-hidden`}>
        <div className={headCls}>Zielerreichung pro Kunde</div>
        <table className="w-full">
          <thead>
            <tr className={`text-[10px] uppercase tracking-wider ${muted}`}>
              <th className="px-4 py-2 text-left font-normal">Kunde</th>
              <th className="px-2 py-2 text-right font-normal">Ziel {MONTH_SHORT[cm - 1]}</th>
              <th className="px-2 py-2 text-right font-normal">{MONTH_SHORT[cm - 1]} Ist</th>
              <th className="px-2 py-2 text-right font-normal">%</th>
              <th className="px-2 py-2 text-right font-normal">Zeitraum Ist</th>
              <th className="px-4 py-2 text-right font-normal">% Soll</th>
            </tr>
          </thead>
          <tbody>
            {clients.map(c => {
              const vals = revenue[c.id] ?? months.map(() => 0);
              const curIdx = months.findIndex(ym => stateOf(ym) === 'current');
              const cAct = curIdx >= 0 ? vals[curIdx] : 0;
              const rAct = vals.reduce((s, v, i) => s + (stateOf(months[i]) === 'future' ? 0 : v), 0);
              const tgt = clientTarget(c, cy, cm, off);
              const rSoll = elapsed.reduce((s, mi) =>
                s + clientTarget(c, mi.ym.y, mi.ym.m, off, mi.state === 'current' ? today : undefined), 0);
              const pctCls = (ratio: number) => ratio >= 1 ? statusGood : soft;
              return (
                <tr key={c.id} className={`border-t ${border} ${clientId !== 'all' && clientId !== c.id ? 'opacity-40' : ''}`}>
                  <td className={`px-4 py-2 text-xs ${isDark ? 'text-white/70' : 'text-black/70'}`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${clientColorClasses(c.color).dot}`} />
                      {c.name}
                      {c.hourlyRate == null && <span className={`text-[10px] ${muted}`}>kein Stundensatz</span>}
                      {c.quota && <span className={`text-[10px] ${muted}`}>Mandat {fmtIso(c.quota.from)}–{fmtIso(c.quota.to)}</span>}
                    </div>
                  </td>
                  <td className={`px-2 py-2 text-xs text-right tabular-nums ${soft}`}>{tgt > 0 ? fmtChf(tgt) : '—'}</td>
                  <td className={`px-2 py-2 text-xs text-right tabular-nums ${soft}`}>{fmtChf(cAct)}</td>
                  <td className={`px-2 py-2 text-xs text-right tabular-nums ${tgt > 0 ? pctCls(cAct / tgt) : muted}`}>
                    {tgt > 0 ? fmtPct(cAct / tgt) : '—'}
                  </td>
                  <td className={`px-2 py-2 text-xs text-right tabular-nums ${soft}`}>{fmtChf(rAct)}</td>
                  <td className={`px-4 py-2 text-xs text-right tabular-nums ${rSoll > 0 ? pctCls(rAct / rSoll) : muted}`}>
                    {rSoll > 0 ? fmtPct(rAct / rSoll) : '—'}
                  </td>
                </tr>
              );
            })}
            {clients.length === 0 && (
              <tr><td colSpan={6} className={`px-4 py-3 text-xs ${muted}`}>Noch keine Kunden erfasst.</td></tr>
            )}
          </tbody>
        </table>
        <div className={`px-4 py-2 border-t ${border} text-[10px] ${muted}`}>
          Ziele werden im Kunden-Tab erfasst. Umsatz und Ziel zählen nur während des Mandats (Kontingent-Zeitraum des Kunden).
          {missingRate.length > 0 && ' Umsatz = Stunden × Stundensatz; Kunden ohne Stundensatz zählen nicht zum Umsatz.'}
        </div>
      </div>
    </div>
  );
}
