import React, { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, MousePointerClick, Trash2, X } from 'lucide-react';
import { TimeEntry } from '../types';
import { useStore } from '../store';

type PanelEntry = Partial<TimeEntry> & { date: string; startTime: string; endTime: string };

interface Props {
  entry: PanelEntry | null;
  onClose: () => void;
  onNew: (entry: PanelEntry) => void;
}

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const TIMES: string[] = [];
for (let h = 0; h < 24; h++)
  for (let m = 0; m < 60; m += 15)
    TIMES.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

function ProjectInput({ value, onChange, suggestions, isDark, inputCls }: {
  value: string; onChange: (v: string) => void; suggestions: string[]; isDark: boolean; inputCls: string;
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
  return (
    <div className="relative">
      <input type="text" placeholder="Projektbezeichnung" value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors ${inputCls}`} />
      {open && filtered.length > 0 && (
        <div className={`absolute left-0 right-0 top-full mt-1 rounded border z-30 overflow-hidden ${dropCls}`}>
          {filtered.map(s => (
            <button key={s} type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(s); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${itemCls}`}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EntryPanel({ entry, onClose, onNew }: Props) {
  const { isDark } = useStore();

  if (!entry) {
    const newForToday = () => {
      const now = new Date();
      const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
          <button onClick={newForToday}
            className={`mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors ${
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

function EntryForm({ entry, onClose }: { entry: PanelEntry; onClose: () => void }) {
  const { clients, entries, addEntry, updateEntry, deleteEntry, isDark } = useStore();

  const knownProjects = useMemo(() => {
    const set = new Set<string>();
    entries.forEach(e => { if (e.project) set.add(e.project); });
    return Array.from(set).sort();
  }, [entries]);
  const isNew = !entry.id;

  const [form, setForm] = useState({
    clientId: entry.clientId ?? (clients[0]?.id ?? ''),
    date: entry.date,
    startTime: entry.startTime,
    endTime: entry.endTime,
    project: entry.project ?? '',
    description: entry.description ?? '',
  });

  useEffect(() => {
    setForm({
      clientId: entry.clientId ?? (clients[0]?.id ?? ''),
      date: entry.date,
      startTime: entry.startTime,
      endTime: entry.endTime,
      project: entry.project ?? '',
      description: entry.description ?? '',
    });
  }, [entry, clients]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.clientId || !form.date || !form.startTime || !form.endTime) return;
    const e: TimeEntry = { id: entry.id ?? genId(), ...form };
    if (isNew) addEntry(e); else updateEntry(e);
    onClose();
  };

  const remove = () => {
    if (entry.id) { deleteEntry(entry.id); onClose(); }
  };

  const bg = isDark ? 'bg-[#14151a] border-white/8' : 'bg-[#ededea] border-black/8';
  const inputCls = isDark
    ? 'bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-white/30'
    : 'bg-black/5 border-black/10 text-black placeholder-black/20 focus:border-black/30';
  const labelCls = isDark ? 'text-white/40' : 'text-black/40';
  const btnPrimary = isDark
    ? 'bg-white text-black hover:bg-white/90'
    : 'bg-black text-white hover:bg-black/80';

  return (
    <div className={`flex flex-col h-full border-l ${bg}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-white/8' : 'border-black/8'}`}>
        <span className={`text-xs font-semibold uppercase tracking-widest ${isDark ? 'text-white/50' : 'text-black/50'}`}>
          {isNew ? 'Neuer Eintrag' : 'Eintrag bearbeiten'}
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
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
            className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors ${inputCls}`} />
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

        {/* Project */}
        <div>
          <label className={`block text-[10px] uppercase tracking-wider mb-1 ${labelCls}`}>Projekt</label>
          <ProjectInput value={form.project} onChange={v => set('project', v)}
            suggestions={knownProjects} isDark={isDark} inputCls={inputCls} />
        </div>

        {/* Description */}
        <div>
          <label className={`block text-[10px] uppercase tracking-wider mb-1 ${labelCls}`}>Beschreibung</label>
          <textarea rows={4} placeholder="Tätigkeitsbeschreibung…" value={form.description}
            onChange={e => set('description', e.target.value)}
            className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors resize-none ${inputCls}`} />
        </div>
      </div>

      {/* Actions */}
      <div className={`px-4 py-3 border-t flex gap-2 ${isDark ? 'border-white/8' : 'border-black/8'}`}>
        {!isNew && (
          <button onClick={remove}
            className={`p-2 rounded transition-colors ${isDark ? 'text-white/30 hover:text-red-400' : 'text-black/30 hover:text-red-500'}`}>
            <Trash2 size={14} />
          </button>
        )}
        <button onClick={onClose}
          className={`flex-1 text-xs py-2 rounded border transition-colors ${isDark ? 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/70' : 'border-black/15 text-black/40 hover:border-black/30 hover:text-black/70'}`}>
          Abbrechen
        </button>
        <button onClick={save}
          className={`flex-1 text-xs py-2 rounded font-semibold transition-colors ${btnPrimary}`}>
          {isNew ? 'Erstellen' : 'Speichern'}
        </button>
      </div>
    </div>
  );
}
