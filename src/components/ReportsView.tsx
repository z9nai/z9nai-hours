import React, { useMemo, useState } from 'react';
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

export default function ReportsView() {
  const { clients, entries, isDark, currentMonth } = useStore();

  const now = new Date();
  const [year, setYear] = useState(currentMonth.year);
  const [month, setMonth] = useState(currentMonth.month);
  const [clientId, setClientId] = useState<string>('all');

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  // Filter entries by month + client (entries already loaded for currentMonth in store,
  // but entries are per-month JSON — we filter by date string to be safe)
  const filtered = useMemo<TimeEntry[]>(() => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return entries.filter(e =>
      e.date.startsWith(prefix) &&
      (clientId === 'all' || e.clientId === clientId)
    );
  }, [entries, year, month, clientId]);

  // Project totals
  const projectTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filtered) {
      const mins = parseMins(e.endTime) - parseMins(e.startTime);
      const key = e.project || '(kein Projekt)';
      map.set(key, (map.get(key) ?? 0) + mins);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const grandTotal = useMemo(() => projectTotals.reduce((s, [, m]) => s + m, 0), [projectTotals]);

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
          <select value={clientId} onChange={e => setClientId(e.target.value)}
            className={`text-xs px-2 py-1.5 rounded border outline-none transition-colors ${selectCls}`}>
            <option value="all">Alle Kunden</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

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
                {projectTotals.map(([project, mins]) => (
                  <tr key={project} className={`border-t ${border}`}>
                    <td className={`px-4 py-2 text-xs ${isDark ? 'text-white/70' : 'text-black/70'}`}>{project}</td>
                    <td className={`px-4 py-2 text-xs text-right tabular-nums ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                      {fmtDuration(mins)}
                    </td>
                  </tr>
                ))}
                <tr className={`border-t-2 ${isDark ? 'border-white/15' : 'border-black/15'}`}>
                  <td className={`px-4 py-2.5 text-xs font-semibold ${isDark ? 'text-white' : 'text-black'}`}>Total</td>
                  <td className={`px-4 py-2.5 text-xs font-semibold text-right tabular-nums ${isDark ? 'text-white' : 'text-black'}`}>
                    {fmtDuration(grandTotal)}
                  </td>
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
                          <div className={`text-xs font-medium truncate ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                            {e.project || '—'}
                            {clientId === 'all' && client && (
                              <span className="inline-flex items-center gap-1 ml-2">
                                <span className={`inline-block w-2 h-2 rounded-full ${clientColorClasses(client.color).dot}`} />
                                <span className={`font-normal ${muted}`}>{client.name}</span>
                              </span>
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
