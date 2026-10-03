import React, { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, MousePointerClick, Trash2, X } from 'lucide-react';
import { TimeEntry } from '../types';
import { useStore } from '../store';
import { absenceLabel, blocksBooking } from '../absences';

type PanelEntry = Partial<TimeEntry> & { date: string; startTime: string; endTime: string };

interface Props {
  entry: TimeEntry | null;
  onClose: () => void;
  onNew: (entry: PanelEntry) => void;
}

const TIMES: string[] = [];
for (let h = 0; h < 24; h++)
  for (let m = 0; m < 60; m += 15)
    TIMES.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

function ProjectInput({ value, onChange, onCommit, suggestions, isDark, inputCls, placeholder = 'Projektbezeichnung' }: {
  value: string; onChange: (v: string) => void; onCommit: (v: string) => void;
  suggestions: string[]; isDark: boolean; inputCls: string; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const filtered = suggestions.filter(s => s !== value &&
    (value === '' || s.toLowerCase().includes(value.toLowerCase())));
  const dropCls = isDark
    ? 'bg-[#1c1d22] border-white/10 shadow-[0_4px_16px_rgba(0,0,0,0.5)]'
    : 'bg-white border-black/10 shadow-[0_4px_16px_rgba(0,0,0,0.12)]';
  const itemCls = isDark
    ? 'text-white/70 hover:bg-white/8 hover:text-white'
    : 'text-black/70 hover:bg-black/5 hover:text-black';
  const topCls = isDark ? 'bg-white/8 text-white' : 'bg-black/5 text-black';
  const pick = (s: string) => { onChange(s); onCommit(s); setOpen(false); };
  return (
    <div className="relative">
      <input type="text" placeholder={placeholder} value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setTimeout(() => setOpen(false), 150); onCommit(value); }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (open && filtered.length > 0) pick(filtered[0]);
            else { onCommit(value); setOpen(false); }
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors ${inputCls}`} />
      {open && filtered.length > 0 && (
        <div className={`absolute left-0 right-0 top-full mt-1 rounded border z-30 overflow-hidden ${dropCls}`}>
          {filtered.map((s, i) => (
            <button key={s} type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick(s)}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${i === 0 ? topCls : itemCls}`}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EntryPanel({ entry, onClose, onNew }: Props) {
  const { isDark, absences } = useStore();

  if (!entry) {
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayAbsence = blocksBooking(absences[iso]) ? absences[iso] : undefined;
    const newForToday = () => {
      const h = Math.min(Math.max(now.getHours(), 5), 22);
      const start = `${String(h).padStart(2, '0')}:00`;
      const end = `${String(h + 1).padStart(2, '0')}:00`;
      onNew({ date: iso, startTime: start, endTime: end });
    };
    const bg = isDark ? 'bg-[#14151a] border-white/8' : 'bg-[#ededea] border-black/8';
    const muted = isDark ? 'text-white/30' : 'text-black/30';
    return (
      <div className={`flex flex-col h-full border-l ${bg}`}>
        <div className={`flex items-center px-4 py-3 border-b ${isDark ? 'border-white/8' : 'border-black/8'}`}>
          <span className={`text-xs font-semibold uppercase tracking-widest ${isDark ? 'text-white/50' : 'text-black/50'}`}>
            Eintrag
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <MousePointerClick size={20} className={muted} />
          <p className={`text-[11px] leading-relaxed ${muted}`}>
            Ziehe im Kalender über einen Zeitraum,<br />
            um einen neuen Eintrag zu erstellen.<br />
            Klicke auf einen Eintrag, um ihn zu bearbeiten.
          </p>
          <button onClick={newForToday} disabled={!!todayAbsence}
            title={todayAbsence ? `Heute: ${absenceLabel(todayAbsence)} – keine Buchung möglich` : undefined}
            className={`mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
              isDark ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white' : 'border-black/15 text-black/50 hover:border-black/30 hover:text-black'
            }`}>
            <CalendarPlus size={12} /> Neuer Eintrag
          </button>
        </div>
      </div>
    );
  }

  return <EntryForm entry={entry} onClose={onClose} />;
}

function EntryForm({ entry, onClose }: { entry: TimeEntry; onClose: () => void }) {
  const { clients, entries, projects, extras, updateEntry, deleteEntry, touchProject, touchExtra, isDark, absences } = useStore();
  const [dateBlocked, setDateBlocked] = useState<string | null>(null); // label of the absence that blocked a date change

  const [form, setForm] = useState({
    clientId: entry.clientId,
    date: entry.date,
    startTime: entry.startTime,
    endTime: entry.endTime,
    project: entry.project,
    description: entry.description,
    extra: entry.extra ?? '',
  });

  // Reset the form when a different entry is opened
  useEffect(() => {
    setForm({
      clientId: entry.clientId,
      date: entry.date,
      startTime: entry.startTime,
      endTime: entry.endTime,
      project: entry.project,
      description: entry.description,
      extra: entry.extra ?? '',
    });
    setDateBlocked(null);
  }, [entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow calendar drag/resize: sync date & times from the live store entry.
  // Text fields (project, description, …) are left alone so typing is never clobbered.
  const live = entries.find(e => e.id === entry.id);
  useEffect(() => {
    if (!live) return;
    setForm(f =>
      f.date === live.date && f.startTime === live.startTime && f.endTime === live.endTime
        ? f
        : { ...f, date: live.date, startTime: live.startTime, endTime: live.endTime }
    );
  }, [live?.date, live?.startTime, live?.endTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persisted MRU list (most recently used first), plus current-month projects
  // not yet in the list; capped at 30
  const knownProjects = useMemo(() => {
    const stored = projects[form.clientId] ?? [];
    const fromEntries = new Set<string>();
    entries.forEach(e => { if (e.project && e.clientId === form.clientId) fromEntries.add(e.project); });
    const merged = [...stored, ...[...fromEntries].filter(p => !stored.includes(p)).sort()];
    return merged.slice(0, 30);
  }, [projects, entries, form.clientId]);

  const knownExtras = useMemo(() => {
    const stored = extras[form.clientId] ?? [];
    const fromEntries = new Set<string>();
    entries.forEach(e => { if (e.extra && e.clientId === form.clientId) fromEntries.add(e.extra); });
    const merged = [...stored, ...[...fromEntries].filter(p => !stored.includes(p)).sort()];
    return merged.slice(0, 30);
  }, [extras, entries, form.clientId]);

  // Auto-save: every change updates the entry immediately (disk write is debounced in the store)
  const set = (k: string, v: string) => {
    const next = { ...form, [k]: v };
    setForm(next);
    updateEntry({ id: entry.id, ...next });
  };

  const remove = () => {
    deleteEntry(entry.id);
    onClose();
  };

  const bg = isDark ? 'bg-[#14151a] border-white/8' : 'bg-[#ededea] border-black/8';
  const inputCls = isDark
    ? 'bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-white/30'
    : 'bg-black/5 border-black/10 text-black placeholder-black/20 focus:border-black/30';
  const labelCls = isDark ? 'text-white/40' : 'text-black/40';
  const descRequired = !!clients.find(c => c.id === form.clientId)?.descriptionRequired;
  const descMissing  = descRequired && !form.description.trim();

  return (
    <div className={`flex flex-col h-full border-l ${bg}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-white/8' : 'border-black/8'}`}>
        <span className={`text-xs font-semibold uppercase tracking-widest ${isDark ? 'text-white/50' : 'text-black/50'}`}>
          Eintrag
        </span>
        <button onClick={onClose} className={`p-1 rounded transition-colors ${isDark ? 'text-white/30 hover:text-white/70' : 'text-black/30 hover:text-black/70'}`}>
          <X size={14} />
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Date */}
        <div>
          <label className={`block text-[10px] uppercase tracking-wider mb-1 ${labelCls}`}>Datum</label>
          <input type="date" value={form.date}
            onChange={e => {
              const a = absences[e.target.value];
              // Moving onto a full-day absence is not allowed
              if (e.target.value !== form.date && blocksBooking(a)) { setDateBlocked(absenceLabel(a)); return; }
              setDateBlocked(null);
              set('date', e.target.value);
            }}
            className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors ${inputCls}`} />
          {dateBlocked && (
            <p className="text-[10px] mt-1 text-red-400">An diesem Tag ist {dateBlocked} (ganzer Tag) eingetragen – keine Buchung möglich.</p>
          )}
        </div>

        {/* Time range */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={`block text-[10px] uppercase tracking-wider mb-1 ${labelCls}`}>Von</label>
            <select value={form.startTime} onChange={e => set('startTime', e.target.value)}
              className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors ${inputCls}`}>
              {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={`block text-[10px] uppercase tracking-wider mb-1 ${labelCls}`}>Bis</label>
            <select value={form.endTime} onChange={e => set('endTime', e.target.value)}
              className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors ${inputCls}`}>
              {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Duration display */}
        {form.startTime && form.endTime && (() => {
          const [sh, sm] = form.startTime.split(':').map(Number);
          const [eh, em] = form.endTime.split(':').map(Number);
          const mins = (eh * 60 + em) - (sh * 60 + sm);
          if (mins <= 0) return null;
          return (
            <div className={`text-[10px] ${labelCls}`}>
              Dauer: {Math.floor(mins / 60)}h {mins % 60 > 0 ? `${mins % 60}min` : ''}
            </div>
          );
        })()}

        {/* Client */}
        <div>
          <label className={`block text-[10px] uppercase tracking-wider mb-1 ${labelCls}`}>Kunde</label>
          {clients.length === 0 ? (
            <p className={`text-[11px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>Noch keine Kunden erfasst.</p>
          ) : (
            <select value={form.clientId} onChange={e => set('clientId', e.target.value)}
              className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors ${inputCls}`}>
              <option value="">— Kunde wählen —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>

        {/* Project (required) */}
        <div>
          <label className={`block text-[10px] uppercase tracking-wider mb-1 ${labelCls}`}>
            Projekt <span className={form.project.trim() ? '' : 'text-red-400'}>*</span>
          </label>
          <ProjectInput value={form.project} onChange={v => set('project', v)}
            onCommit={v => touchProject(form.clientId, v)}
            suggestions={knownProjects} isDark={isDark}
            inputCls={form.project.trim() ? inputCls : `${inputCls} !border-red-400/60`} />
        </div>

        {/* Configurable extra field of the selected client (optional) */}
        {(() => {
          const extraCfg = clients.find(c => c.id === form.clientId)?.extraField;
          if (!extraCfg?.enabled) return null;
          return (
            <div>
              <label className={`block text-[10px] uppercase tracking-wider mb-1 ${labelCls}`}>
                {extraCfg.label || 'Zusatz'}
              </label>
              <ProjectInput value={form.extra} onChange={v => set('extra', v)}
                onCommit={v => touchExtra(form.clientId, v)}
                suggestions={knownExtras} isDark={isDark} inputCls={inputCls}
                placeholder={extraCfg.label || 'Zusatz'} />
            </div>
          );
        })()}

        {/* Description */}
        <div>
          <label className={`block text-[10px] uppercase tracking-wider mb-1 ${labelCls}`}>
            Beschreibung {descRequired && <span className={descMissing ? 'text-red-400' : ''}>*</span>}
          </label>
          <textarea rows={4} placeholder="Tätigkeitsbeschreibung…" value={form.description}
            onChange={e => set('description', e.target.value)}
            className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors resize-none ${inputCls} ${descMissing ? '!border-red-400/60' : ''}`} />
        </div>
      </div>

      {/* Actions */}
      <div className={`px-4 py-3 border-t flex items-center justify-between ${isDark ? 'border-white/8' : 'border-black/8'}`}>
        <span className={`text-[10px] ${isDark ? 'text-white/25' : 'text-black/25'}`}>
          Änderungen werden automatisch gespeichert
        </span>
        <button onClick={remove} title="Eintrag löschen"
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors ${
            isDark ? 'border-white/15 text-white/40 hover:border-red-400/50 hover:text-red-400' : 'border-black/15 text-black/40 hover:border-red-500/50 hover:text-red-500'
          }`}>
          <Trash2 size={12} /> Löschen
        </button>
      </div>
    </div>
  );
}
