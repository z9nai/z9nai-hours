import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { TimeEntry } from '../types';
import { useStore } from '../store';
import { absenceLabel, blocksBooking } from '../absences';

interface Props {
  entry: TimeEntry;
  onClose: () => void;
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
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation(); // close only the suggestions, not the dialog
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

const POP_W = 288;  // popover width in px
const POP_GAP = 10; // distance to the time block
const MARGIN = 8;   // min distance to the window edge

type PopPos = { left: number; top: number; arrowY: number; side: 'right' | 'left'; maxH: number };

/**
 * The entry form as a dialog right next to its time block in the calendar.
 * The block is found via its data-entry-id; the dialog follows it on drag,
 * resize, scrolling and window resize, and hides while the block is out of view.
 */
export default function EntryPopover({ entry, onClose }: Props) {
  const { isDark } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PopPos | null>(null);
  const scrolledFor = useRef<string | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = document.querySelector<HTMLElement>(`[data-entry-id="${entry.id}"]`);
      const scroller = el?.closest<HTMLElement>('[data-cal-scroll]');
      if (!el || !scroller) { setPos(null); return; }
      // Bring a freshly opened block into view once (e.g. "Neuer Eintrag" outside the visible hours)
      if (scrolledFor.current !== entry.id) {
        scrolledFor.current = entry.id;
        el.scrollIntoView({ block: 'nearest' });
      }
      const r = el.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      const visTop = Math.max(r.top, s.top);
      const visBot = Math.min(r.bottom, s.bottom);
      if (visBot <= visTop) { setPos(null); return; }

      const maxH = window.innerHeight - 2 * MARGIN;
      const h = Math.min(ref.current?.offsetHeight ?? 0, maxH);
      const side = r.right + POP_GAP + POP_W <= window.innerWidth - MARGIN ? 'right' : 'left';
      const left = side === 'right' ? r.right + POP_GAP : Math.max(MARGIN, r.left - POP_GAP - POP_W);
      const anchorY = visTop + Math.min(14, (visBot - visTop) / 2);
      const top = Math.max(MARGIN, Math.min(anchorY - 22, window.innerHeight - h - MARGIN));
      const arrowY = Math.max(12, Math.min(anchorY - top, h - 12));
      setPos(p => p && p.left === left && p.top === top && p.arrowY === arrowY && p.side === side && p.maxH === maxH
        ? p : { left, top, arrowY, side, maxH });
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [entry.id]);

  // Close on Escape or a click outside the dialog (clicks on time blocks select/drag them instead)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || ref.current?.contains(t) || t.closest?.('[data-entry-id]')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const panelCls = isDark
    ? 'bg-[#1c1d22] border-white/12 shadow-[0_8px_32px_rgba(0,0,0,0.6)]'
    : 'bg-white border-black/10 shadow-[0_8px_32px_rgba(0,0,0,0.15)]';
  const arrowBg = isDark ? '#1c1d22' : '#ffffff';
  const arrowBorder = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
  const toRight = pos?.side !== 'left';

  return (
    <div ref={ref} role="dialog" aria-label="Eintrag"
      className={`fixed z-40 rounded-xl border flex flex-col ${panelCls}`}
      style={{
        left: pos?.left ?? 0, top: pos?.top ?? 0, width: POP_W, maxHeight: pos?.maxH,
        visibility: pos ? 'visible' : 'hidden',
      }}>
      {/* Arrow pointing at the time block */}
      <div style={{
        position: 'absolute',
        top: (pos?.arrowY ?? 12) - 5,
        [toRight ? 'left' : 'right']: -6,
        width: 10, height: 10,
        background: arrowBg,
        border: `1px solid ${arrowBorder}`,
        borderRight: toRight ? 'none' : undefined,
        borderTop:   toRight ? 'none' : undefined,
        borderLeft:  toRight ? undefined : 'none',
        borderBottom: toRight ? undefined : 'none',
        transform: 'rotate(45deg)',
      }} />
      <div className="flex flex-col min-h-0 rounded-xl overflow-hidden">
        <EntryForm entry={entry} onClose={onClose} />
      </div>
    </div>
  );
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

  const inputCls = isDark
    ? 'bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-white/30'
    : 'bg-black/5 border-black/10 text-black placeholder-black/20 focus:border-black/30';
  const labelCls = isDark ? 'text-white/40' : 'text-black/40';
  const descRequired = !!clients.find(c => c.id === form.clientId)?.descriptionRequired;
  const descMissing  = descRequired && !form.description.trim();

  return (
    <div className="flex flex-col min-h-0">
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
