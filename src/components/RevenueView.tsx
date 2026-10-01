import React, { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useStore } from '../store';
import { AbsenceType, Client } from '../types';
import { clientColorClasses } from '../colors';
import { ABSENCE_ORDER, ABSENCE_TYPES, absenceDays } from '../absences';
import {
  Absences, BarSeries, LegendItem, MONTH_NAMES, MONTH_SHORT, MonthBar, MonthlyChart, Range, RangePicker, Theme, TipRow, Tooltip, YM,
  chartTheme, fmtDays, fmtIso, fmtYm, laterIso, monthState, niceTicks, parseMins, rangeMonths, useWidth, workdays,
} from './charts';

function fmtChf(amount: number): string {
  return `CHF ${Math.round(amount).toLocaleString('de-CH')}`;
}

function fmtAxis(v: number): string {
  return v >= 1000 ? `${(v / 1000).toLocaleString('de-CH', { maximumFractionDigits: 1 })}k` : String(Math.round(v));
}

function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

// A client's revenue target for one month: only during the mandate (the
// Kontingent period, if set) and from the company start date on; partial
// months pro-rata by working days.
// With uptoDay only the share up to that day ("Soll bis heute"). Absences don't
// lower a full month's target, they only shift how it spreads over the month.
function clientTarget(c: Client, y: number, m: number, off: Absences, start: string, uptoDay?: number): number {
  const t = c.revenueTarget ?? 0;
  if (t <= 0) return 0;
  const total = workdays(y, m, off);
  return total > 0 ? (t * workdays(y, m, off, uptoDay, laterIso(c.quota?.from, start), c.quota?.to)) / total : 0;
}

// Maximum possible revenue from the Kontingent: the period's hours split evenly
// over its months (as in the Report's Monatskontingent) × hourly rate; the
// month of the company start only pro-rata, months before it not at all.
function clientMax(c: Client, y: number, m: number, off: Absences, start: string, uptoDay?: number): number {
  const q = c.quota;
  if (!q || !c.hourlyRate || q.hours <= 0) return 0;
  const [fy, fm] = q.from.split('-').map(Number);
  const [ty, tm] = q.to.split('-').map(Number);
  const k = y * 12 + m, s = fy * 12 + fm, e = ty * 12 + tm;
  if (k < s || k > e) return 0;
  const monthly = (q.hours / (e - s + 1)) * c.hourlyRate;
  if (uptoDay == null && !start) return monthly;
  const total = workdays(y, m, off, undefined, q.from, q.to);
  return total > 0 ? (monthly * workdays(y, m, off, uptoDay, laterIso(q.from, start), q.to)) / total : 0;
}

interface MonthInfo extends MonthBar {
  targetToDate: number; // running month: pro-rata by working days elapsed
  max: number;
  maxToDate: number;
}

// ── Cumulative Ist vs. Ziel (and Max. Kontingent) over the range ──
function CumulativeChart({ months, theme, accent }: { months: MonthInfo[]; theme: Theme; accent: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 200, mt = 12, mb = 24, ml = 44, mr = 64;
  const plotW = Math.max(0, width - ml - mr), plotH = H - mt - mb;
  const n = months.length;
  const band = n > 0 ? plotW / n : 0;

  const cumTarget: number[] = [];
  const cumMax: number[] = [];
  const cumActual: (number | null)[] = [];
  let t = 0, mx = 0, a = 0;
  months.forEach(mi => {
    t += mi.targetToDate; cumTarget.push(t);
    mx += mi.maxToDate; cumMax.push(mx);
    if (mi.state === 'future') { cumActual.push(null); return; }
    a += mi.actual; cumActual.push(a);
  });
  const ticks = niceTicks(Math.max(1, t, a, mx));
  const top = ticks[ticks.length - 1];
  const yOf = (v: number) => mt + plotH - (v / top) * plotH;
  const xOf = (i: number) => ml + band * i + band / 2;

  const pts = (vals: number[]) => vals.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ');
  const actualIdx = cumActual.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0);
  const actualPts = actualIdx.map(i => `${xOf(i)},${yOf(cumActual[i]!)}`).join(' ');
  const lastA = actualIdx[actualIdx.length - 1];
  const areaPath = actualIdx.length > 0
    ? `M${xOf(actualIdx[0])},${yOf(0)} L${actualPts.split(' ').join(' L')} L${xOf(lastA)},${yOf(0)} Z`
    : '';
  const hasTarget = t > 0, hasMax = mx > 0;
  const muted = theme.isDark ? 'text-white/40' : 'text-black/40';

  // End labels, skipped when they would collide with one placed before them
  const labels: { y: number; text: string; color: string; bold?: boolean; x: number }[] = [];
  if (lastA != null) labels.push({ x: xOf(lastA) + 8, y: yOf(cumActual[lastA]!), text: `Ist ${fmtAxis(cumActual[lastA]!)}`, color: theme.ink, bold: true });
  if (hasTarget) labels.push({ x: xOf(n - 1) + 8, y: yOf(cumTarget[n - 1]), text: `Ziel ${fmtAxis(cumTarget[n - 1])}`, color: theme.axisText });
  if (hasMax) labels.push({ x: xOf(n - 1) + 8, y: yOf(cumMax[n - 1]), text: `Max ${fmtAxis(cumMax[n - 1])}`, color: theme.axisText });
  const placed = labels.filter((l, i) => labels.slice(0, i).every(o => Math.abs(o.x - l.x) > 50 || Math.abs(o.y - l.y) >= 12));

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
          {hasMax && (
            <polyline points={pts(cumMax)} fill="none" stroke={theme.axisText} strokeWidth={2} strokeDasharray="4 3" strokeLinejoin="round" />
          )}
          {hasTarget && (
            <polyline points={pts(cumTarget)} fill="none" stroke={theme.axisText} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {areaPath && <path d={areaPath} fill={accent} fillOpacity={0.1} />}
          {actualIdx.length > 0 && (
            <polyline points={actualPts} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {lastA != null && (
            <circle cx={xOf(lastA)} cy={yOf(cumActual[lastA]!)} r={4} fill={accent} stroke={theme.surface} strokeWidth={2} />
          )}
          {hover != null && cumActual[hover] != null && hover !== lastA && (
            <circle cx={xOf(hover)} cy={yOf(cumActual[hover]!)} r={4} fill={accent} stroke={theme.surface} strokeWidth={2} />
          )}
          {hover != null && hasTarget && (
            <circle cx={xOf(hover)} cy={yOf(cumTarget[hover])} r={4} fill={theme.axisText} stroke={theme.surface} strokeWidth={2} />
          )}
          {placed.map(l => (
            <text key={l.text} x={l.x} y={l.y} dy="0.32em" fontSize={10} fill={l.color} fontWeight={l.bold ? 600 : 400}>{l.text}</text>
          ))}
        </svg>
      )}
      {hover != null && months[hover] && (() => {
        const mi = months[hover];
        const act = cumActual[hover];
        const tgt = cumTarget[hover];
        return (
          <Tooltip x={xOf(hover)} width={width} isDark={theme.isDark}>
            <div className="font-semibold mb-1">bis {MONTH_NAMES[mi.ym.m - 1]} {mi.ym.y}</div>
            {act != null && <TipRow label="Ist kumuliert" value={fmtChf(act)} strong />}
            <TipRow label={mi.state === 'current' ? 'Soll bis heute' : 'Ziel kumuliert'} value={hasTarget ? fmtChf(tgt) : '—'} muted={muted} />
            {hasMax && <TipRow label="Max. Kontingent" value={fmtChf(cumMax[hover])} muted={muted} />}
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
  const { clients, company, isDark, entries, readMonthEntries, absences: off } = useStore();
  const start = company.startDate ?? '';
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth() + 1, today = now.getDate();
  const [range, setRange] = useState<Range>('6');
  const [from, setFrom] = useState(start ? start.slice(0, 7) : `${cy}-01`);
  const [clientId, setClientId] = useState<string>('all');

  const months = useMemo(() => rangeMonths(range, cy, cm, from), [range, cy, cm, from]);
  const stateOf = (ym: YM) => monthState(ym, cy, cm);

  // clientId → revenue per month (aligned to `months`); future months are not read.
  // Like the targets, revenue only counts during the client's mandate.
  // Tagged with the range it was computed for: right after a range switch the
  // old arrays don't match `months` and must not be used.
  const monthsKey = months.map(ym => `${ym.y}-${ym.m}`).join(',');
  const [loaded, setLoaded] = useState<{ key: string; data: Record<string, number[]> } | null>(null);
  const loading = loaded?.key !== monthsKey;
  const revenue = loading ? {} : loaded!.data;
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
          if (e.date < start) continue; // before the company start
          out[c.id][i] += ((parseMins(e.endTime) - parseMins(e.startTime)) / 60) * c.hourlyRate;
        }
      }
      if (!cancelled) setLoaded({ key: monthsKey, data: out });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, clients, entries, readMonthEntries, start]);

  const shown = clientId === 'all' ? clients : clients.filter(c => c.id === clientId);
  const series: BarSeries[] = shown
    .map(c => ({ id: c.id, name: c.name, color: c.color, values: revenue[c.id] ?? months.map(() => 0) }))
    .filter((s, i) => s.values.some(v => v > 0) || (shown[i].revenueTarget ?? 0) > 0);
  const hasTargets = shown.some(c => (c.revenueTarget ?? 0) > 0);
  const targetOf = ({ y, m }: YM, uptoDay?: number) => shown.reduce((s, c) => s + clientTarget(c, y, m, off, start, uptoDay), 0);
  const maxOf = ({ y, m }: YM, uptoDay?: number) => shown.reduce((s, c) => s + clientMax(c, y, m, off, start, uptoDay), 0);

  // Pace through the running month, by working days without absences
  const wdTotal = workdays(cy, cm, off, undefined, start);
  const wdElapsed = workdays(cy, cm, off, today, start);
  // Absent working days of the running month, per type (for the forecast tile)
  const absentByType: Partial<Record<AbsenceType, number>> = {};
  for (const [iso, list] of Object.entries(off)) {
    const d = new Date(iso + 'T00:00:00');
    if (d.getFullYear() !== cy || d.getMonth() + 1 !== cm || d.getDay() === 0 || d.getDay() === 6) continue;
    for (const a of list) absentByType[a.type] = (absentByType[a.type] ?? 0) + absenceDays([a]);
  }
  const absentLabel = ABSENCE_ORDER
    .filter(t => absentByType[t])
    .map(t => `${ABSENCE_TYPES[t].label} ${absentByType[t]!.toLocaleString('de-CH')}`)
    .join(', ');
  const pace = wdTotal > 0 ? wdElapsed / wdTotal : 1;

  const monthInfos: MonthInfo[] = months.map((ym, i) => {
    const state = stateOf(ym);
    const actual = state === 'future' ? 0 : series.reduce((s, x) => s + x.values[i], 0);
    return {
      ym, state, actual, target: targetOf(ym),
      targetToDate: state === 'current' ? targetOf(ym, today) : targetOf(ym),
      max: maxOf(ym),
      maxToDate: state === 'current' ? maxOf(ym, today) : maxOf(ym),
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
  const rangeLabel = elapsed.length > 0 ? `${fmtYm(elapsed[0].ym)} – ${fmtYm(elapsed[elapsed.length - 1].ym)}` : '';
  const hasMax = monthInfos.some(m => m.max > 0);

  const theme = chartTheme(isDark);
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
  const statusWarn = isDark ? 'text-red-400' : 'text-red-600'; // not amber: that's a client color
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
        <div className="flex items-center gap-2 flex-wrap">
          <RangePicker range={range} setRange={setRange} from={from} setFrom={setFrom} cy={cy} isDark={isDark} />
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
            {fmtDays(wdElapsed)}/{fmtDays(wdTotal)} Arbeitstage{absentLabel && ` (ohne ${absentLabel})`}
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
              <LegendItem key={s.id} kind="dot" color={clientColorClasses(s.color).swatch} label={s.name} className={soft} />
            ))}
            {hasTargets && <LegendItem kind="line" color={theme.ink} label="Ziel" className={soft} />}
            {hasMax && <LegendItem kind="dash" color={theme.axisText} label="Max. Kontingent" className={soft} />}
            {cur && <LegendItem kind="box" color={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'} label="Hochrechnung" className={soft} />}
          </span>
        </div>
        <div className="px-2 py-3">
          {loading ? <div className={`h-[220px] text-xs flex items-center justify-center ${muted}`}>Lade…</div>
            : <MonthlyChart months={monthInfos} series={series} theme={theme} fmt={fmtChf} axisFmt={fmtAxis}
                targetLabel="Ziel" maxLabel="Max. Kontingent" pctLabel="Erreicht" />}
        </div>
      </div>

      {/* ── Cumulative chart ── */}
      <div className={`rounded-xl border ${border} mb-6`}>
        <div className={`flex items-center justify-between rounded-t-xl ${headCls}`}>
          <span>Kumuliert: Ist vs. Ziel</span>
          <span className="flex items-center gap-3 normal-case tracking-normal">
            <LegendItem kind="line" color={accent} label="Ist" className={soft} />
            {hasTargets && <LegendItem kind="line" color={theme.axisText} label="Ziel" className={soft} />}
            {hasMax && <LegendItem kind="dash" color={theme.axisText} label="Max. Kontingent" className={soft} />}
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
              const tgt = clientTarget(c, cy, cm, off, start);
              const rSoll = elapsed.reduce((s, mi) =>
                s + clientTarget(c, mi.ym.y, mi.ym.m, off, start, mi.state === 'current' ? today : undefined), 0);
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
          {hasMax && ' Max. Kontingent = Kontingentstunden pro Monat × Stundensatz.'}
          {missingRate.length > 0 && ' Umsatz = Stunden × Stundensatz; Kunden ohne Stundensatz zählen nicht zum Umsatz.'}
        </div>
      </div>
    </div>
  );
}
