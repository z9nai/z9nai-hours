import React, { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useStore } from '../store';
import { AbsenceType } from '../types';
import { clientColorClasses } from '../colors';
import { withInternal } from '../internal';
import { ABSENCE_ORDER, ABSENCE_TYPES, absenceDays } from '../absences';
import {
  Absences, BarSeries, LegendItem, MONTH_NAMES, MONTH_SHORT, MonthBar, MonthlyChart, Range, RangePicker, Theme, TipRow, Tooltip, YM,
  chartTheme, fmtDays, fmtIso, fmtYm, monthState, niceTicks, parseMins, rangeMonths, useWidth, workdays,
} from './charts';

const fmtH = (h: number) => `${h.toLocaleString('de-CH', { maximumFractionDigits: 1 })} h`;
const fmtSigned = (h: number) => `${h > 0.05 ? '+' : h < -0.05 ? '−' : ''}${fmtH(Math.abs(h))}`;
const fmtAxisH = (v: number) => `${Math.round(v)}`;

// Absent working days (Mon–Fri) per type in a month
function absentByType(off: Absences, { y, m }: YM): Partial<Record<AbsenceType, number>> {
  const prefix = `${y}-${String(m).padStart(2, '0')}-`;
  const out: Partial<Record<AbsenceType, number>> = {};
  for (const [iso, list] of Object.entries(off)) {
    if (!iso.startsWith(prefix)) continue;
    const wd = new Date(iso + 'T00:00:00').getDay();
    if (wd === 0 || wd === 6) continue;
    for (const a of list) out[a.type] = (out[a.type] ?? 0) + absenceDays([a]);
  }
  return out;
}

interface MonthInfo extends MonthBar {
  workdays: number;     // without absences
  sollToDate: number;
  saldo: number | null; // Ist − Soll (bis heute); null for future months
  absent: Partial<Record<AbsenceType, number>>;
}

// ── Cumulative Saldo (Über-/Unterzeit) ──
function SaldoChart({ months, theme, accent }: { months: MonthInfo[]; theme: Theme; accent: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 180, mt = 12, mb = 24, ml = 44, mr = 64;
  const plotW = Math.max(0, width - ml - mr), plotH = H - mt - mb;
  const n = months.length;
  const band = n > 0 ? plotW / n : 0;

  const cum: (number | null)[] = [];
  let acc = 0;
  months.forEach(mi => {
    if (mi.saldo == null) { cum.push(null); return; }
    acc += mi.saldo; cum.push(acc);
  });
  const vals = cum.filter((v): v is number => v != null);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const st = niceTicks(Math.max(1, hi - lo));
  const step = st[1] - st[0];
  const tLo = Math.floor(lo / step) * step, tHi = Math.max(tLo + step, Math.ceil(hi / step) * step);
  const ticks: number[] = [];
  for (let v = tLo; v <= tHi + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  const yOf = (v: number) => mt + plotH - ((v - tLo) / (tHi - tLo)) * plotH;
  const xOf = (i: number) => ml + band * i + band / 2;

  const idx = cum.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0);
  const linePts = idx.map(i => `${xOf(i)},${yOf(cum[i]!)}`);
  const last = idx[idx.length - 1];
  const area = idx.length > 0 ? `M${xOf(idx[0])},${yOf(0)} L${linePts.join(' L')} L${xOf(last)},${yOf(0)} Z` : '';
  const muted = theme.isDark ? 'text-white/40' : 'text-black/40';

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={H} className="block"
          onMouseMove={e => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const i = Math.floor((e.clientX - r.left - ml) / band);
            setHover(i >= 0 && i < n && cum[i] != null ? i : null);
          }}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={ml} x2={ml + plotW} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? theme.axisText : theme.grid} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={ml - 8} y={yOf(t)} dy="0.32em" textAnchor="end" fontSize={10} fill={theme.axisText}>{t > 0 ? '+' : ''}{fmtAxisH(t)}</text>
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
          {area && <path d={area} fill={accent} fillOpacity={0.1} />}
          {linePts.length > 0 && (
            <polyline points={linePts.join(' ')} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {last != null && (
            <>
              <circle cx={xOf(last)} cy={yOf(cum[last]!)} r={4} fill={accent} stroke={theme.surface} strokeWidth={2} />
              <text x={xOf(last) + 8} y={yOf(cum[last]!)} dy="0.32em" fontSize={10} fill={theme.ink} fontWeight={600}>
                {fmtSigned(cum[last]!)}
              </text>
            </>
          )}
          {hover != null && hover !== last && (
            <circle cx={xOf(hover)} cy={yOf(cum[hover]!)} r={4} fill={accent} stroke={theme.surface} strokeWidth={2} />
          )}
        </svg>
      )}
      {hover != null && months[hover] && (() => {
        const mi = months[hover];
        return (
          <Tooltip x={xOf(hover)} width={width} isDark={theme.isDark}>
            <div className="font-semibold mb-1">{MONTH_NAMES[mi.ym.m - 1]} {mi.ym.y}{mi.state === 'current' ? ' (bis heute)' : ''}</div>
            <TipRow label="Ist" value={fmtH(mi.actual)} muted={muted} />
            <TipRow label="Soll" value={fmtH(mi.sollToDate)} muted={muted} />
            <TipRow label="Saldo Monat" value={fmtSigned(mi.saldo ?? 0)} />
            <TipRow label="Saldo kumuliert" value={fmtSigned(cum[hover]!)} strong />
          </Tooltip>
        );
      })()}
    </div>
  );
}

export default function WorktimeView() {
  const { clients, company, isDark, entries, readMonthEntries, absences: off } = useStore();
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth() + 1, today = now.getDate();
  const [range, setRange] = useState<Range>('6');
  const start = company.startDate ?? ''; // nothing before the company start counts
  const [from, setFrom] = useState(start ? start.slice(0, 7) : `${cy}-01`);

  const months = useMemo(() => rangeMonths(range, cy, cm, from), [range, cy, cm, from]);
  const stateOf = (ym: YM) => monthState(ym, cy, cm);
  const hpd = company.hoursPerDay ?? 0;

  // clientId → hours per month (aligned to `months`), tagged with the range
  // it was computed for so a range switch never mixes old and new arrays
  const monthsKey = months.map(ym => `${ym.y}-${ym.m}`).join(',');
  const [loaded, setLoaded] = useState<{ key: string; data: Record<string, number[]> } | null>(null);
  const loading = loaded?.key !== monthsKey;
  const hours = loading ? {} : loaded!.data;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, number[]> = {};
      for (let i = 0; i < months.length; i++) {
        if (stateOf(months[i]) === 'future') continue;
        const es = await readMonthEntries(months[i].y, months[i].m);
        for (const e of es) {
          if (e.date < start) continue;
          const arr = out[e.clientId] ??= months.map(() => 0);
          arr[i] += (parseMins(e.endTime) - parseMins(e.startTime)) / 60;
        }
      }
      if (!cancelled) setLoaded({ key: monthsKey, data: out });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, entries, readMonthEntries, start]);

  // Fixed client order, non-billable "Intern" after the clients; bookings
  // without a known client are grouped last
  const allClients = withInternal(clients);
  const unknownIds = Object.keys(hours).filter(id => !allClients.some(c => c.id === id));
  const series: BarSeries[] = [
    ...allClients.map(c => ({ id: c.id, name: c.name, color: c.color, values: hours[c.id] ?? [] })),
    ...(unknownIds.length > 0 ? [{
      id: '__none', name: 'Ohne Kunde', color: '',
      values: months.map((_, i) => unknownIds.reduce((sum, id) => sum + hours[id][i], 0)),
    }] : []),
  ].filter(s => s.values.some(v => v > 0));

  const wdTotal = workdays(cy, cm, off, undefined, start);
  const wdElapsed = workdays(cy, cm, off, today, start);
  const pace = wdTotal > 0 ? wdElapsed / wdTotal : 1;

  const monthInfos: MonthInfo[] = months.map((ym, i) => {
    const state = stateOf(ym);
    const actual = state === 'future' ? 0 : series.reduce((s, x) => s + (x.values[i] ?? 0), 0);
    const wd = workdays(ym.y, ym.m, off, undefined, start);
    const soll = hpd * wd;
    const sollToDate = state === 'current' ? hpd * wdElapsed : soll;
    const beforeStart = !!start && `${ym.y}-${String(ym.m).padStart(2, '0')}-31` < start;
    return {
      ym, state, actual, target: soll, workdays: wd, sollToDate,
      saldo: state === 'future' || hpd <= 0 || beforeStart ? null : actual - sollToDate,
      forecast: state === 'current' && wdElapsed > 0 ? actual / pace : null,
      absent: absentByType(off, ym),
    };
  });

  const cur = monthInfos.find(m => m.state === 'current');
  const elapsed = monthInfos.filter(m => m.state !== 'future');
  const rangeIst = elapsed.reduce((s, m) => s + m.actual, 0);
  const rangeSoll = elapsed.reduce((s, m) => s + m.sollToDate, 0);
  const rangeSaldo = rangeIst - rangeSoll;
  const rangeLabel = elapsed.length > 0 ? `${fmtYm(elapsed[0].ym)} – ${fmtYm(elapsed[elapsed.length - 1].ym)}` : '';
  const absentRange: Partial<Record<AbsenceType, number>> = {};
  for (const mi of monthInfos) for (const t of ABSENCE_ORDER) {
    if (mi.absent[t]) absentRange[t] = (absentRange[t] ?? 0) + mi.absent[t]!;
  }

  const theme = chartTheme(isDark);
  const accent = isDark ? '#60a5fa' : '#2563eb';
  const border = isDark ? 'border-white/8' : 'border-black/8';
  const muted = isDark ? 'text-white/35' : 'text-black/35';
  const strong = isDark ? 'text-white' : 'text-black';
  const soft = isDark ? 'text-white/60' : 'text-black/60';
  const headCls = `px-4 py-2 text-[10px] uppercase tracking-widest ${muted} ${isDark ? 'bg-white/2' : 'bg-black/2'}`;
  const statusGood = isDark ? 'text-emerald-400' : 'text-emerald-600';
  const statusWarn = isDark ? 'text-red-400' : 'text-red-600'; // not amber: that's a client color
  const saldoCls = (v: number) => (v >= -0.05 ? statusGood : statusWarn);

  const curIst = cur?.actual ?? 0;
  const curSoll = cur?.target ?? 0;
  const curSollToDate = cur?.sollToDate ?? 0;
  const curSaldo = curIst - curSollToDate;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header + filters */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className={`text-sm font-semibold uppercase tracking-widest ${isDark ? 'text-white/50' : 'text-black/50'}`}>
          Arbeitszeit
        </h2>
        <RangePicker range={range} setRange={setRange} from={from} setFrom={setFrom} cy={cy} isDark={isDark} />
      </div>

      {hpd <= 0 && (
        <div className={`rounded-xl border px-4 py-3 mb-6 text-xs ${isDark ? 'border-blue-500/20 bg-blue-950/30 text-blue-300/80' : 'border-blue-200 bg-blue-50 text-blue-700/80'}`}>
          Noch keine Soll-Arbeitszeit erfasst — im Tab «Firma» die Stunden pro Arbeitstag eingeben.
        </div>
      )}

      {/* ── Stat tiles ── */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className={`rounded-xl border ${border} px-4 py-3`}>
          <div className={`text-[10px] uppercase tracking-widest ${muted}`}>{MONTH_NAMES[cm - 1]} bisher</div>
          <div className={`text-xl font-semibold mt-1 ${strong}`}>{fmtH(curIst)}</div>
          <div className={`text-[11px] mt-0.5 ${muted}`}>
            {hpd > 0 ? <>Soll Monat {fmtH(curSoll)} · {fmtDays(wdTotal)} Arbeitstage</> : 'kein Soll'}
          </div>
          {hpd > 0 && curSoll > 0 && (
            <div className={`relative h-1.5 rounded-full mt-3 ${isDark ? 'bg-white/8' : 'bg-black/8'}`}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(curIst / curSoll, 1) * 100}%`, background: accent }} />
              <div className={`absolute -top-1 w-0.5 h-3.5 rounded-full ${isDark ? 'bg-white/70' : 'bg-black/70'}`}
                style={{ left: `calc(${Math.min(curSollToDate / curSoll, 1) * 100}% - 1px)` }} title="Soll bis heute" />
            </div>
          )}
          {hpd > 0 && (
            <div className="flex items-center flex-wrap gap-x-1 text-[11px] mt-2">
              <span className={`flex items-center gap-1 whitespace-nowrap ${saldoCls(curSaldo)}`}>
                {curSaldo >= -0.05 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {fmtSigned(curSaldo)}
              </span>
              <span className={`whitespace-nowrap ${muted}`}>· Soll heute {fmtH(curSollToDate)}</span>
            </div>
          )}
        </div>
        <div className={`rounded-xl border ${border} px-4 py-3`}>
          <div className={`text-[10px] uppercase tracking-widest ${muted}`}>Saldo {rangeLabel}</div>
          <div className={`text-xl font-semibold mt-1 ${hpd > 0 ? saldoCls(rangeSaldo) : strong}`}>
            {hpd > 0 ? fmtSigned(rangeSaldo) : '—'}
          </div>
          <div className={`text-[11px] mt-0.5 ${muted}`}>Ist {fmtH(rangeIst)} · Soll {fmtH(rangeSoll)}</div>
          <div className={`text-[11px] mt-2 ${muted}`}>
            {hpd > 0 ? (rangeSaldo >= -0.05 ? 'Überzeit (bis heute)' : 'Unterzeit (bis heute)') : ''}
          </div>
        </div>
        <div className={`rounded-xl border ${border} px-4 py-3`}>
          <div className={`text-[10px] uppercase tracking-widest ${muted}`}>Abwesenheiten Zeitraum</div>
          <div className="mt-1.5 space-y-1">
            {ABSENCE_ORDER.map(t => {
              const cfg = ABSENCE_TYPES[t];
              const Icon = cfg.icon;
              return (
                <div key={t} className="flex items-center gap-2 text-xs">
                  <Icon size={12} className={isDark ? cfg.text : cfg.textLight} />
                  <span className={`flex-1 ${soft}`}>{cfg.label}</span>
                  <span className={`tabular-nums ${strong}`}>{fmtDays(absentRange[t] ?? 0)} T.</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Monthly hours ── */}
      <div className={`rounded-xl border ${border} mb-6`}>
        <div className={`flex items-center justify-between rounded-t-xl ${headCls}`}>
          <span>Stunden pro Monat</span>
          <span className="flex items-center gap-3 normal-case tracking-normal flex-wrap justify-end">
            {series.length > 1 && series.map(s => (
              <LegendItem key={s.id} kind="dot" color={clientColorClasses(s.color).swatch} label={s.name} className={soft} />
            ))}
            {hpd > 0 && <LegendItem kind="line" color={theme.ink} label="Soll" className={soft} />}
            {cur && <LegendItem kind="box" color={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'} label="Hochrechnung" className={soft} />}
          </span>
        </div>
        <div className="px-2 py-3">
          {loading ? <div className={`h-[220px] text-xs flex items-center justify-center ${muted}`}>Lade…</div>
            : <MonthlyChart months={monthInfos} series={series} theme={theme} fmt={fmtH} axisFmt={fmtAxisH}
                targetLabel="Soll" pctLabel="Erfüllt" />}
        </div>
      </div>

      {/* ── Cumulative saldo ── */}
      {hpd > 0 && (
        <div className={`rounded-xl border ${border} mb-6`}>
          <div className={`flex items-center justify-between rounded-t-xl ${headCls}`}>
            <span>Saldo kumuliert (Über-/Unterzeit)</span>
          </div>
          <div className="px-2 py-3">
            {loading ? <div className={`h-[180px] text-xs flex items-center justify-center ${muted}`}>Lade…</div>
              : <SaldoChart months={monthInfos} theme={theme} accent={accent} />}
          </div>
        </div>
      )}

      {/* ── Per-month table ── */}
      <div className={`rounded-xl border ${border} overflow-hidden`}>
        <div className={headCls}>Monatsübersicht</div>
        <table className="w-full">
          <thead>
            <tr className={`text-[10px] uppercase tracking-wider ${muted}`}>
              <th className="px-4 py-2 text-left font-normal">Monat</th>
              <th className="px-2 py-2 text-right font-normal">Arbeitstage</th>
              <th className="px-2 py-2 text-left font-normal">Abwesend</th>
              <th className="px-2 py-2 text-right font-normal">Soll</th>
              <th className="px-2 py-2 text-right font-normal">Ist</th>
              <th className="px-2 py-2 text-right font-normal">Saldo</th>
              <th className="px-4 py-2 text-right font-normal">Kumuliert</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              let acc = 0;
              return monthInfos.map(mi => {
                if (mi.saldo != null) acc += mi.saldo;
                const absent = ABSENCE_ORDER.filter(t => mi.absent[t]);
                return (
                  <tr key={`${mi.ym.y}-${mi.ym.m}`} className={`border-t ${border} ${mi.state === 'future' ? 'opacity-40' : ''}`}>
                    <td className={`px-4 py-2 text-xs ${mi.state === 'current' ? `font-semibold ${strong}` : soft}`}>
                      {MONTH_NAMES[mi.ym.m - 1]} {mi.ym.y}
                    </td>
                    <td className={`px-2 py-2 text-xs text-right tabular-nums ${soft}`}>
                      {mi.state === 'current' ? `${fmtDays(wdElapsed)}/${fmtDays(mi.workdays)}` : fmtDays(mi.workdays)}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      <span className="flex items-center gap-2">
                        {absent.length === 0 && <span className={muted}>—</span>}
                        {absent.map(t => {
                          const cfg = ABSENCE_TYPES[t];
                          const Icon = cfg.icon;
                          return (
                            <span key={t} className={`flex items-center gap-0.5 tabular-nums ${soft}`} title={cfg.label}>
                              <Icon size={11} className={isDark ? cfg.text : cfg.textLight} />{fmtDays(mi.absent[t]!)}
                            </span>
                          );
                        })}
                      </span>
                    </td>
                    <td className={`px-2 py-2 text-xs text-right tabular-nums ${soft}`}>{hpd > 0 ? fmtH(mi.sollToDate) : '—'}</td>
                    <td className={`px-2 py-2 text-xs text-right tabular-nums ${soft}`}>{mi.state === 'future' ? '—' : fmtH(mi.actual)}</td>
                    <td className={`px-2 py-2 text-xs text-right tabular-nums ${mi.saldo != null ? saldoCls(mi.saldo) : muted}`}>
                      {mi.saldo != null ? fmtSigned(mi.saldo) : '—'}
                    </td>
                    <td className={`px-4 py-2 text-xs text-right tabular-nums font-medium ${mi.saldo != null ? saldoCls(acc) : muted}`}>
                      {mi.saldo != null ? fmtSigned(acc) : '—'}
                    </td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
        <div className={`px-4 py-2 border-t ${border} text-[10px] ${muted}`}>
          Soll = Stunden pro Arbeitstag × Arbeitstage (Mo–Fr) ohne Ferien, Krank und Feiertage; im laufenden Monat bis heute.
          {start && ` Gezählt ab Firmenstart ${fmtIso(start)}.`}
        </div>
      </div>
    </div>
  );
}
