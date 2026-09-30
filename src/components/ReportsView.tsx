import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { TimeEntry } from '../types';
import { clientColorClasses } from '../colors';

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function parseMins(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('de-CH', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtChf(amount: number): string {
  return `CHF ${amount.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtIso(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// All (year, month) pairs between two ISO dates, capped at 36 months
function monthsBetween(fromISO: string, toISO: string): { y: number; m: number }[] {
  const [fy, fm] = fromISO.split('-').map(Number);
  const [ty, tm] = toISO.split('-').map(Number);
  const out: { y: number; m: number }[] = [];
  let y = fy, m = fm;
  while ((y < ty || (y === ty && m <= tm)) && out.length < 36) {
    out.push({ y, m });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export default function ReportsView() {
  const { clients, isDark, currentMonth, readMonthEntries } = useStore();

  const now = new Date();
  const [year, setYear] = useState(currentMonth.year);
  const [month, setMonth] = useState(currentMonth.month);
  const [clientId, setClientId] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [projectSearch, setProjectSearch] = useState('');
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const [monthEntries, setMonthEntries] = useState<TimeEntry[]>([]);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  useEffect(() => {
    readMonthEntries(year, month).then(setMonthEntries);
  }, [year, month, readMonthEntries]);

  // ── Kontingent usage: per client with quota, minutes used per month in the period ──
  const [quotaUsage, setQuotaUsage] = useState<Record<string, { y: number; m: number; mins: number }[]>>({});

  useEffect(() => {
    const withQuota = clients.filter(c => c.quota && c.quota.hours > 0 && c.quota.from && c.quota.to);
    if (withQuota.length === 0) { setQuotaUsage({}); return; }
    let cancelled = false;
    (async () => {
      const result: Record<string, { y: number; m: number; mins: number }[]> = {};
      for (const c of withQuota) {
        const q = c.quota!;
        const rows: { y: number; m: number; mins: number }[] = [];
        for (const { y, m } of monthsBetween(q.from, q.to)) {
          const es = await readMonthEntries(y, m);
          const mins = es
            .filter(e => e.clientId === c.id && e.date >= q.from && e.date <= q.to)
            .reduce((s, e) => s + parseMins(e.endTime) - parseMins(e.startTime), 0);
          rows.push({ y, m, mins });
        }
        result[c.id] = rows;
      }
      if (!cancelled) setQuotaUsage(result);
    })();
    return () => { cancelled = true; };
  }, [clients, readMonthEntries, monthEntries]);

  // All unique projects from month entries (respecting client filter)
  const allProjects = useMemo(() => {
    const set = new Set<string>();
    for (const e of monthEntries) {
      if (clientId !== 'all' && e.clientId !== clientId) continue;
      if (e.project) set.add(e.project);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
  }, [monthEntries, clientId]);

  // Close project dropdown on outside click
  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(ev.target as Node)) {
        setProjectDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredProjects = useMemo(() => {
    const q = projectSearch.toLowerCase().trim();
    if (!q) return allProjects;
    return allProjects.filter(p => p.toLowerCase().includes(q));
  }, [allProjects, projectSearch]);

  const filtered = useMemo<TimeEntry[]>(() => {
    return monthEntries.filter(e =>
      (clientId === 'all' || e.clientId === clientId) &&
      (projectFilter === 'all' || (e.project || '') === projectFilter)
    );
  }, [monthEntries, clientId, projectFilter]);

  // Project totals grouped by (clientId, project)
  const projectTotals = useMemo(() => {
    const map = new Map<string, { clientId: string; project: string; mins: number }>();
    for (const e of filtered) {
      const mins = parseMins(e.endTime) - parseMins(e.startTime);
      const key = `${e.clientId}::${e.project || '(kein Projekt)'}`;
      const existing = map.get(key);
      if (existing) { existing.mins += mins; }
      else { map.set(key, { clientId: e.clientId, project: e.project || '(kein Projekt)', mins }); }
    }
    return Array.from(map.values()).sort((a, b) => b.mins - a.mins);
  }, [filtered]);

  const grandTotal = useMemo(() => projectTotals.reduce((s, r) => s + r.mins, 0), [projectTotals]);

  // CHF amount per row (null when the client has no hourly rate)
  const rowAmount = (row: { clientId: string; mins: number }): number | null => {
    const rate = clients.find(c => c.id === row.clientId)?.hourlyRate;
    return rate != null ? (row.mins / 60) * rate : null;
  };
  const amounts = projectTotals.map(rowAmount);
  const hasAnyRate = amounts.some(a => a != null);
  const grandAmount = amounts.reduce<number>((s, a) => s + (a ?? 0), 0);

  // Group by date
  const byDay = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    for (const e of [...filtered].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))) {
      const arr = map.get(e.date) ?? [];
      arr.push(e);
      map.set(e.date, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const border = isDark ? 'border-white/8' : 'border-black/8';
  const muted = isDark ? 'text-white/35' : 'text-black/35';
  const selectCls = isDark
    ? 'bg-white/5 border-white/10 text-white focus:border-white/30'
    : 'bg-black/5 border-black/10 text-black focus:border-black/30';

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header + filters */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className={`text-sm font-semibold uppercase tracking-widest ${isDark ? 'text-white/50' : 'text-black/50'}`}>
          Report
        </h2>
        <div className="flex items-center gap-2">
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className={`text-xs px-2 py-1.5 rounded border outline-none transition-colors ${selectCls}`}>
            {MONTH_NAMES.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className={`text-xs px-2 py-1.5 rounded border outline-none transition-colors ${selectCls}`}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={clientId} onChange={e => { setClientId(e.target.value); setProjectFilter('all'); }}
            className={`text-xs px-2 py-1.5 rounded border outline-none transition-colors ${selectCls}`}>
            <option value="all">Alle Kunden</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {/* Project filter with search */}
          <div className="relative" ref={projectDropdownRef}>
            <button
              onClick={() => { setProjectDropdownOpen(o => !o); setProjectSearch(''); }}
              className={`text-xs px-2 py-1.5 rounded border outline-none transition-colors text-left min-w-[120px] truncate ${selectCls}`}
            >
              {projectFilter === 'all' ? 'Alle Projekte' : projectFilter}
            </button>
            {projectDropdownOpen && (
              <div className={`absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border shadow-lg overflow-hidden ${
                isDark ? 'bg-[#1a1b20] border-white/10' : 'bg-white border-black/10'
              }`}>
                <div className="p-1.5">
                  <input
                    autoFocus
                    value={projectSearch}
                    onChange={e => setProjectSearch(e.target.value)}
                    placeholder="Suchen…"
                    className={`w-full text-xs px-2 py-1.5 rounded border outline-none transition-colors ${selectCls}`}
                  />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <button
                    onClick={() => { setProjectFilter('all'); setProjectDropdownOpen(false); }}
                    className={`w-full text-left text-xs px-3 py-1.5 transition-colors ${
                      projectFilter === 'all'
                        ? (isDark ? 'bg-white/10 text-white' : 'bg-black/10 text-black')
                        : (isDark ? 'text-white/70 hover:bg-white/5' : 'text-black/70 hover:bg-black/5')
                    }`}
                  >
                    Alle Projekte
                  </button>
                  {filteredProjects.map(p => (
                    <button
                      key={p}
                      onClick={() => { setProjectFilter(p); setProjectDropdownOpen(false); }}
                      className={`w-full text-left text-xs px-3 py-1.5 truncate transition-colors ${
                        projectFilter === p
                          ? (isDark ? 'bg-white/10 text-white' : 'bg-black/10 text-black')
                          : (isDark ? 'text-white/70 hover:bg-white/5' : 'text-black/70 hover:bg-black/5')
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  {filteredProjects.length === 0 && (
                    <div className={`text-xs px-3 py-2 ${muted}`}>Keine Projekte gefunden</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Kontingent / Kostendach ── */}
      {clients
        .filter(c => c.quota && quotaUsage[c.id] && (clientId === 'all' || c.id === clientId))
        .map(c => {
          const q = c.quota!;
          const rows = quotaUsage[c.id];
          const quotaMins = Math.round(q.hours * 60);
          const colorCls = clientColorClasses(c.color);
          const rate = c.hourlyRate;
          const chf = (mins: number) => fmtChf((mins / 60) * rate!);
          // Monthly budget = total quota split evenly across the period's months
          const monthlyQuotaMins = rows.length > 0 ? quotaMins / rows.length : 0;
          const nowD = new Date();
          const curY = nowD.getFullYear(), curM = nowD.getMonth() + 1;
          // Listed: past + current month. Consolidated: only fully completed months.
          const listedRows = rows.filter(r => r.y < curY || (r.y === curY && r.m <= curM));
          const completedRows = listedRows.filter(r => r.y < curY || (r.y === curY && r.m < curM));
          const usedMins = completedRows.reduce((s, r) => s + r.mins, 0);
          // Elapsed portion of the quota (period start up to previous month)
          const elapsedQuotaMins = monthlyQuotaMins * completedRows.length;
          const elapsedPct = elapsedQuotaMins > 0 ? (usedMins / elapsedQuotaMins) * 100 : 0;
          const elapsedOver = completedRows.length > 0 && usedMins > elapsedQuotaMins;
          const yy = (y: number) => String(y).slice(2);
          const firstRow = completedRows[0];
          const lastRow = completedRows[completedRows.length - 1];
          const elapsedLabel = firstRow && lastRow
            ? `${MONTH_NAMES[firstRow.m - 1]} ${yy(firstRow.y)} bis ${MONTH_NAMES[lastRow.m - 1]} ${yy(lastRow.y)}`
            : null;
          return (
            <div key={c.id} className={`rounded-xl border ${border} overflow-hidden mb-6`}>
              <div className={`flex items-center justify-between px-4 py-2 ${isDark ? 'bg-white/2' : 'bg-black/2'}`}>
                <span className={`flex items-center gap-1.5 text-[10px] uppercase tracking-widest ${muted}`}>
                  <span className={`inline-block w-2 h-2 rounded-full ${colorCls.dot}`} />
                  Kontingent {c.name}
                </span>
                <span className={`text-[10px] tabular-nums ${muted}`}>
                  {fmtIso(q.from)} – {fmtIso(q.to)}
                </span>
              </div>
              <div className="px-4 py-3">
                {/* Progress bar: usage vs elapsed quota (months so far × monthly quota) */}
                <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-white/8' : 'bg-black/8'}`}>
                  <div
                    className={`h-full rounded-full ${elapsedOver ? 'bg-red-500' : colorCls.dot}`}
                    style={{ width: `${Math.min(elapsedPct, 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className={`text-xs ${isDark ? 'text-white/70' : 'text-black/70'}`}>
                    {fmtDuration(usedMins)}{rate != null && ` (${chf(usedMins)})`} von {fmtDuration(Math.round(elapsedQuotaMins))}{rate != null && ` (${chf(elapsedQuotaMins)})`} – {elapsedPct.toFixed(1)}%
                  </span>
                  <span className={`text-xs tabular-nums font-medium ${elapsedOver ? 'text-red-400' : isDark ? 'text-white/50' : 'text-black/50'}`}>
                    {elapsedOver
                      ? `${fmtDuration(Math.round(usedMins - elapsedQuotaMins))}${rate != null ? ` (${chf(usedMins - elapsedQuotaMins)})` : ''} überzogen`
                      : elapsedLabel ?? ''}
                  </span>
                </div>
              </div>
              {/* Per-month breakdown: bar = usage vs monthly share of the quota */}
              <div className={`px-4 pb-1 text-[10px] ${muted}`}>
                Kontingent Total: {fmtDuration(quotaMins)}{rate != null && ` (${chf(quotaMins)})`} | Monatskontingent: {fmtDuration(Math.round(monthlyQuotaMins))}{rate != null && ` (${chf(monthlyQuotaMins)})`}
              </div>
              {listedRows.map(r => {
                const mPct = monthlyQuotaMins > 0 ? (r.mins / monthlyQuotaMins) * 100 : 0;
                const mOver = r.mins > monthlyQuotaMins;
                const isCurrent = r.y === curY && r.m === curM;
                return (
                  <div key={`${r.y}-${r.m}`} className={`flex items-center gap-3 px-4 py-1.5 border-t ${border}`}>
                    <span className={`w-32 flex-shrink-0 text-xs ${isCurrent ? (isDark ? 'text-white font-semibold' : 'text-black font-semibold') : (isDark ? 'text-white/60' : 'text-black/60')}`}>
                      {MONTH_NAMES[r.m - 1]} {r.y}
                    </span>
                    <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-white/8' : 'bg-black/8'}`}>
                      <div
                        className={`h-full rounded-full ${mOver ? 'bg-red-500' : colorCls.dot}`}
                        style={{ width: `${Math.min(mPct, 100)}%` }}
                      />
                    </div>
                    <span className={`w-20 flex-shrink-0 text-right text-xs tabular-nums ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                      {fmtDuration(r.mins)}
                    </span>
                    {rate != null && (
                      <span className={`w-28 flex-shrink-0 text-right text-xs tabular-nums ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                        {chf(r.mins)}
                      </span>
                    )}
                    <span className={`w-12 flex-shrink-0 text-right text-[10px] tabular-nums ${mOver ? 'text-red-400' : muted}`}>
                      {mPct.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
              {/* Total: all listed months incl. current, bar vs total quota */}
              {(() => {
                const totalMins = listedRows.reduce((s, r) => s + r.mins, 0);
                const totalPct = quotaMins > 0 ? (totalMins / quotaMins) * 100 : 0;
                const totalOver = totalMins > quotaMins;
                return (
                  <div className={`flex items-center gap-3 px-4 py-2 border-t-2 ${isDark ? 'border-white/15' : 'border-black/15'}`}>
                    <span className={`w-32 flex-shrink-0 text-xs font-semibold ${isDark ? 'text-white' : 'text-black'}`}>Total</span>
                    <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-white/8' : 'bg-black/8'}`}>
                      <div
                        className={`h-full rounded-full ${totalOver ? 'bg-red-500' : colorCls.dot}`}
                        style={{ width: `${Math.min(totalPct, 100)}%` }}
                      />
                    </div>
                    <span className={`w-20 flex-shrink-0 text-right text-xs font-semibold tabular-nums ${isDark ? 'text-white' : 'text-black'}`}>
                      {fmtDuration(totalMins)}
                    </span>
                    {rate != null && (
                      <span className={`w-28 flex-shrink-0 text-right text-xs font-semibold tabular-nums ${isDark ? 'text-white' : 'text-black'}`}>
                        {chf(totalMins)}
                      </span>
                    )}
                    <span className={`w-12 flex-shrink-0 text-right text-[10px] tabular-nums font-semibold ${totalOver ? 'text-red-400' : isDark ? 'text-white/70' : 'text-black/70'}`}>
                      {totalPct.toFixed(0)}%
                    </span>
                  </div>
                );
              })()}
            </div>
          );
        })}

      {filtered.length === 0 ? (
        <p className={`text-sm ${muted}`}>Keine Einträge für diesen Zeitraum.</p>
      ) : (
        <>
          {/* ── Zusammenfassung ── */}
          <div className={`rounded-xl border ${border} overflow-hidden mb-6`}>
            <div className={`px-4 py-2 text-[10px] uppercase tracking-widest ${muted} ${isDark ? 'bg-white/2' : 'bg-black/2'}`}>
              Zusammenfassung
            </div>
            <table className="w-full">
              <tbody>
                {projectTotals.map((row, i) => {
                  const rowClient = clients.find(c => c.id === row.clientId);
                  return (
                    <tr key={i} className={`border-t ${border}`}>
                      <td className={`px-4 py-2 text-xs ${isDark ? 'text-white/70' : 'text-black/70'}`}>
                        <div className="flex items-center gap-1.5">
                          {rowClient && <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${clientColorClasses(rowClient.color).dot}`} />}
                          {row.project}
                          {clientId === 'all' && rowClient && (
                            <span className={`font-normal ${muted}`}>{rowClient.name}</span>
                          )}
                        </div>
                      </td>
                      <td className={`px-4 py-2 text-xs text-right tabular-nums ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                        {fmtDuration(row.mins)}
                      </td>
                      {hasAnyRate && (
                        <td className={`px-4 py-2 text-xs text-right tabular-nums ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                          {amounts[i] != null ? fmtChf(amounts[i]!) : '—'}
                        </td>
                      )}
                    </tr>
                  );
                })}
                <tr className={`border-t-2 ${isDark ? 'border-white/15' : 'border-black/15'}`}>
                  <td className={`px-4 py-2.5 text-xs font-semibold ${isDark ? 'text-white' : 'text-black'}`}>Total</td>
                  <td className={`px-4 py-2.5 text-xs font-semibold text-right tabular-nums ${isDark ? 'text-white' : 'text-black'}`}>
                    {fmtDuration(grandTotal)}
                  </td>
                  {hasAnyRate && (
                    <td className={`px-4 py-2.5 text-xs font-semibold text-right tabular-nums ${isDark ? 'text-white' : 'text-black'}`}>
                      {fmtChf(grandAmount)}
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Detailansicht ── */}
          <div className={`rounded-xl border ${border} overflow-hidden`}>
            <div className={`px-4 py-2 text-[10px] uppercase tracking-widest ${muted} ${isDark ? 'bg-white/2' : 'bg-black/2'}`}>
              Buchungen
            </div>
            {byDay.map(([date, dayEntries], di) => {
              const dayTotal = dayEntries.reduce((s, e) => s + parseMins(e.endTime) - parseMins(e.startTime), 0);
              return (
                <div key={date} className={di > 0 ? `border-t ${border}` : ''}>
                  {/* Day header */}
                  <div className={`flex items-center justify-between px-4 py-2 ${isDark ? 'bg-white/2' : 'bg-black/2'}`}>
                    <span className={`text-[11px] font-semibold ${isDark ? 'text-white/60' : 'text-black/60'}`}>
                      {fmtDate(date)}
                    </span>
                    <span className={`text-[11px] tabular-nums ${muted}`}>{fmtDuration(dayTotal)}</span>
                  </div>
                  {/* Day entries */}
                  {dayEntries.map((e, ei) => {
                    const client = clients.find(c => c.id === e.clientId);
                    const mins = parseMins(e.endTime) - parseMins(e.startTime);
                    return (
                      <div key={e.id}
                        className={`flex items-start gap-3 px-4 py-2.5 ${ei > 0 || true ? `border-t ${isDark ? 'border-white/5' : 'border-black/5'}` : ''}`}>
                        <span className={`text-[11px] tabular-nums flex-shrink-0 w-24 ${muted}`}>
                          {e.startTime}–{e.endTime}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className={`flex items-center gap-1.5 text-xs font-medium truncate ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                            {client && <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${clientColorClasses(client.color).dot}`} />}
                            {e.project || '—'}
                            {clientId === 'all' && client && (
                              <span className={`font-normal ${muted}`}>{client.name}</span>
                            )}
                          </div>
                          {e.description && (
                            <div className={`text-[11px] mt-0.5 truncate ${muted}`}>{e.description}</div>
                          )}
                        </div>
                        <span className={`text-[11px] tabular-nums flex-shrink-0 ${muted}`}>{fmtDuration(mins)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
