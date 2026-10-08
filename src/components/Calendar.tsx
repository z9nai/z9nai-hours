import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Check, CalendarOff, CalendarPlus } from 'lucide-react';
import { AbsenceType, TimeEntry } from '../types';
import { useStore } from '../store';
import { clientColorClasses } from '../colors';
import { withInternal } from '../internal';
import { ABSENCE_ORDER, ABSENCE_TYPES, DayAbsences, absenceLabel, blocksBooking } from '../absences';

const HOUR_START = 5;
const HOUR_END = 23;
const SLOT_HEIGHT = 26; // px per 15-min slot
const TOTAL_SLOTS = (HOUR_END - HOUR_START) * 4;
const TIME_COL_W = 44;
const HANDLE_PX = 5; // resize handle height in px

function slotToTime(slot: number): string {
  const totalMins = HOUR_START * 60 + slot * 15;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeToSlot(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h - HOUR_START) * 4 + Math.floor(m / 15);
}

function dateToISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Find the first slot where an entry of `duration` fits on `date`,
 * starting the search at `preferredStart` and wrapping to slot 0 if needed.
 * Returns -1 if the day is completely full.
 */
function findFreeSlot(
  date: string,
  duration: number,
  preferredStart: number,
  allEntries: TimeEntry[],
  excludeId?: string,
): number {
  const occ = allEntries
    .filter(e => e.date === date && e.id !== excludeId)
    .map(e => ({ s: timeToSlot(e.startTime), e: timeToSlot(e.endTime) }))
    .sort((a, b) => a.s - b.s);

  const fits = (start: number) =>
    start >= 0 &&
    start + duration <= TOTAL_SLOTS &&
    !occ.some(o => start < o.e && start + duration > o.s);

  // Scan forward from preferred position
  let slot = clamp(preferredStart, 0, TOTAL_SLOTS - duration);
  while (slot + duration <= TOTAL_SLOTS) {
    if (fits(slot)) return slot;
    const b = occ.find(o => slot < o.e && slot + duration > o.s);
    slot = b ? b.e : slot + 1;
  }
  // Wrap around: scan from beginning up to preferred position
  slot = 0;
  while (slot < preferredStart) {
    if (fits(slot)) return slot;
    const b = occ.find(o => slot < o.e && slot + duration > o.s);
    slot = b ? b.e : slot + 1;
  }
  return -1; // day is packed
}

function getWeekDays(weekOffset: number): Date[] {
  const now = new Date();
  const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // Mon=0
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

const DAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// ── Absence menu: Ferien / Krank / Feiertag, a full day or up to two halves ──
function AbsenceMenu({ value, hasEntries, onChange, onClose, isDark }: {
  value: DayAbsences;
  hasEntries: boolean; // a full day off (also 2× ½) is not possible on a day with bookings
  onChange: (list: DayAbsences | null) => void;
  onClose: () => void;
  isDark: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const halves = value.filter(a => a.half);
  const isFull = (t: AbsenceType) => value.some(a => a.type === t && !a.half);
  const isHalf = (t: AbsenceType) => halves.some(a => a.type === t);
  // ½ toggles that type's half day; a second half of another type completes the day.
  // The menu stays open so a second half can be picked right away.
  const toggleHalf = (t: AbsenceType) => {
    if (isHalf(t)) onChange(halves.filter(a => a.type !== t));
    else onChange([...halves, { type: t, half: true }]);
  };
  // Adding a half to an existing half makes a full day: same rules as "Ganz"
  const halfDisabled = (t: AbsenceType) => !isHalf(t) && (halves.length >= 2 || (halves.length === 1 && hasEntries));

  const chip = (active: boolean) => `text-[10px] px-2 py-0.5 rounded border transition-colors disabled:opacity-30 disabled:pointer-events-none ${
    active
      ? isDark ? 'bg-white/15 border-white/30 text-white' : 'bg-black/10 border-black/30 text-black'
      : isDark ? 'border-white/10 text-white/50 hover:border-white/30 hover:text-white' : 'border-black/10 text-black/50 hover:border-black/30 hover:text-black'
  }`;
  return (
    <div ref={ref}
      className={`absolute top-full right-0 mt-1 z-50 w-52 rounded-lg border shadow-lg p-1.5 text-left ${
        isDark ? 'bg-[#1a1b20] border-white/10' : 'bg-white border-black/10'
      }`}>
      {ABSENCE_ORDER.map(t => {
        const cfg = ABSENCE_TYPES[t];
        const Icon = cfg.icon;
        return (
          <div key={t} className="flex items-center gap-2 px-1.5 py-1">
            <Icon size={12} className={isDark ? cfg.text : cfg.textLight} />
            <span className={`flex-1 text-xs ${isDark ? 'text-white/80' : 'text-black/80'}`}>{cfg.label}</span>
            <span title={hasEntries ? 'Tag hat bereits Buchungen' : undefined}>
              <button className={chip(isFull(t))} disabled={hasEntries}
                onClick={() => { onChange([{ type: t }]); onClose(); }}>Ganz</button>
            </span>
            <span title={halfDisabled(t) && hasEntries ? 'Tag hat bereits Buchungen' : undefined}>
              <button className={chip(isHalf(t))} disabled={halfDisabled(t)} onClick={() => toggleHalf(t)}>½</button>
            </span>
          </div>
        );
      })}
      <div className={`px-1.5 pt-1 text-[10px] leading-snug ${isDark ? 'text-white/35' : 'text-black/40'}`}>
        {hasEntries
          ? 'Ganzer Tag (auch 2× ½) nicht möglich – es gibt bereits Buchungen.'
          : 'Zwei halbe Tage ergeben einen ganzen – dann ist keine Buchung mehr möglich.'}
      </div>
      {value.length > 0 && (
        <button onClick={() => { onChange(null); onClose(); }}
          className={`w-full mt-1 pt-1.5 border-t text-xs text-left px-1.5 py-1 transition-colors ${
            isDark ? 'border-white/10 text-white/50 hover:text-red-400' : 'border-black/10 text-black/50 hover:text-red-500'
          }`}>
          Entfernen
        </button>
      )}
    </div>
  );
}

// ── Interaction state ───────────────────────────────────────────────────────
type Interaction =
  | { kind: 'select'; dayIdx: number; startSlot: number; endSlot: number }
  | { kind: 'move'; entry: TimeEntry; slotOffset: number; currentDayIdx: number; currentSlot: number }
  | { kind: 'resize-top'; entry: TimeEntry; currentSlot: number }
  | { kind: 'resize-bottom'; entry: TimeEntry; currentSlot: number };

type PanelEntry = Partial<TimeEntry> & { date: string; startTime: string; endTime: string };

interface Props {
  onSelect: (entry: PanelEntry) => void;
  onEditEntry: (entry: TimeEntry) => void;
  selectedId: string | null;
}

export default function Calendar({ onSelect, onEditEntry, selectedId }: Props) {
  const { entries, isDark, clients: realClients, addEntry, updateEntry, showMonths, absences, setAbsence } = useStore();
  const clients = useMemo(() => withInternal(realClients), [realClients]);
  const [absenceMenu, setAbsenceMenu] = useState<string | null>(null); // ISO date with open menu
  const closeAbsenceMenu = useCallback(() => setAbsenceMenu(null), []);
  const [weekOffset, setWeekOffset] = useState(0);
  const days = getWeekDays(weekOffset);

  // Tell the store which months the visible week spans (one or two); it loads
  // them and stores every entry in the file of its own month.
  useEffect(() => {
    const d = getWeekDays(weekOffset);
    const months = new Map<string, { year: number; month: number }>();
    for (const day of d) {
      months.set(`${day.getFullYear()}-${day.getMonth() + 1}`, { year: day.getFullYear(), month: day.getMonth() + 1 });
    }
    // Wednesday's month is the default month for the report view
    showMonths([...months.values()], { year: d[2].getFullYear(), month: d[2].getMonth() + 1 });
  }, [weekOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  // The store holds all loaded months; entries outside the visible days are not rendered
  const displayEntries = entries;

  // Keep the selected entry visible: jump to its week when it is created or moved
  // outside the visible days (e.g. "Neuer Eintrag" or a date change in the dialog)
  const selectedDate = entries.find(e => e.id === selectedId)?.date;
  useEffect(() => {
    if (!selectedDate || getWeekDays(weekOffset).some(d => dateToISO(d) === selectedDate)) return;
    const [y, m, d] = selectedDate.split('-').map(Number);
    const diffDays = Math.round((new Date(y, m - 1, d).getTime() - getWeekDays(0)[0].getTime()) / 86400000);
    setWeekOffset(Math.floor(diffDays / 7));
  }, [selectedId, selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Neuer Eintrag": one hour today at the current hour
  const todayISO = dateToISO(new Date());
  const todayBlocked = blocksBooking(absences[todayISO]);
  const newForToday = () => {
    const h = Math.min(Math.max(new Date().getHours(), HOUR_START), HOUR_END - 1);
    onSelect({ date: todayISO, startTime: `${String(h).padStart(2, '0')}:00`, endTime: `${String(h + 1).padStart(2, '0')}:00` });
  };

  // Interaction stored in both ref (for event callbacks) and state (for rendering)
  const iaRef = useRef<Interaction | null>(null);
  const [ia, setIa] = useState<Interaction | null>(null);
  const didMoveRef = useRef(false); // distinguish click vs actual drag on entries

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Always-current snapshot of entries for use inside event callbacks
  const entriesRef = useRef(displayEntries);
  useEffect(() => { entriesRef.current = displayEntries; }, [displayEntries]);

  // Days with a full-day absence take no new bookings
  const absencesRef = useRef(absences);
  useEffect(() => { absencesRef.current = absences; }, [absences]);
  const isBlocked = useCallback((iso: string) => blocksBooking(absencesRef.current[iso]), []);

  // ── Copy flash state ─────────────────────────────────────────────────────
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyEntry = useCallback((entry: TimeEntry) => {
    const duration = timeToSlot(entry.endTime) - timeToSlot(entry.startTime);
    // Try right after the original on the same day, then earlier gaps, then next days
    let targetDate = entry.date;
    let freeStart = isBlocked(entry.date) ? -1 : findFreeSlot(entry.date, duration, timeToSlot(entry.endTime), entriesRef.current);
    if (freeStart < 0) {
      // Day is full — walk forward up to 7 days
      const [dy, dm, dd] = entry.date.split('-').map(Number);
      for (let offset = 1; offset <= 7; offset++) {
        const next = new Date(dy, dm - 1, dd + offset);
        targetDate = dateToISO(next);
        if (isBlocked(targetDate)) continue;
        freeStart = findFreeSlot(targetDate, duration, timeToSlot(entry.startTime), entriesRef.current);
        if (freeStart >= 0) break;
      }
    }
    if (freeStart >= 0) {
      addEntry({
        ...entry,
        id: genId(),
        date: targetDate,
        startTime: slotToTime(freeStart),
        endTime: slotToTime(freeStart + duration),
      });
    }
    setCopiedId(entry.id);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedId(null), 1200);
  }, [addEntry, isBlocked]);

  // ── Tooltip ───────────────────────────────────────────────────────────────
  const [hoveredEntry, setHoveredEntry] = useState<TimeEntry | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startHover = useCallback((entry: TimeEntry, x: number, y: number) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoveredEntry(entry), 400);
    setTipPos({ x, y });
  }, []);

  const moveHover = useCallback((x: number, y: number) => {
    setTipPos({ x, y });
  }, []);

  const endHover = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoveredEntry(null);
  }, []);

  const clientColor = useCallback((clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    const c = clientColorClasses(client?.color ?? '');
    return `${c.bg} ${c.border}`;
  }, [clients]);

  // Convert a raw MouseEvent to { slot, dayIdx } relative to the grid
  const mouseToSlotDay = useCallback((e: MouseEvent): { slot: number; dayIdx: number } => {
    const grid = gridRef.current;
    const scroll = scrollRef.current;
    if (!grid || !scroll) return { slot: 0, dayIdx: 0 };
    const rect = grid.getBoundingClientRect();
    const relY = e.clientY - rect.top; // rect.top already moves with scroll
    const slot = clamp(Math.floor(relY / SLOT_HEIGHT), 0, TOTAL_SLOTS);
    const relX = e.clientX - rect.left - TIME_COL_W;
    const dayWidth = (rect.width - TIME_COL_W) / 7;
    const dayIdx = clamp(Math.floor(relX / dayWidth), 0, 6);
    return { slot, dayIdx };
  }, []);

  // ── Global mouse handlers ─────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const cur = iaRef.current;
      if (!cur) return;
      const { slot, dayIdx } = mouseToSlotDay(e);
      let next: Interaction;
      if (cur.kind === 'select') {
        if (cur.dayIdx !== dayIdx) return; // selection stays in one column
        next = { ...cur, endSlot: slot };
      } else if (cur.kind === 'move') {
        const blocked = isBlocked(dateToISO(days[dayIdx])) && dateToISO(days[dayIdx]) !== cur.entry.date;
        next = { ...cur, currentDayIdx: blocked ? cur.currentDayIdx : dayIdx, currentSlot: slot };
        didMoveRef.current = true;
      } else {
        // resize-top / resize-bottom
        next = { ...cur, currentSlot: slot };
        didMoveRef.current = true;
      }
      iaRef.current = next;
      setIa(next);
    };

    const onUp = (e: MouseEvent) => {
      const cur = iaRef.current;
      if (!cur) { setIa(null); return; }
      const { slot, dayIdx } = mouseToSlotDay(e);
      const snap = entriesRef.current;

      if (cur.kind === 'select') {
        const lo = Math.min(cur.startSlot, cur.endSlot);
        const hi = Math.max(cur.startSlot, cur.endSlot) + 1;
        onSelect({ date: dateToISO(days[cur.dayIdx]), startTime: slotToTime(lo), endTime: slotToTime(hi) });

      } else if (cur.kind === 'move') {
        if (didMoveRef.current) {
          const duration = timeToSlot(cur.entry.endTime) - timeToSlot(cur.entry.startTime);
          const requested = clamp(slot - cur.slotOffset, 0, TOTAL_SLOTS - duration);
          const targetDate = dateToISO(days[cur.currentDayIdx]);
          // Find nearest free slot on the target day (excluding the entry being moved)
          const freeStart = isBlocked(targetDate) && targetDate !== cur.entry.date
            ? -1
            : findFreeSlot(targetDate, duration, requested, snap, cur.entry.id);
          if (freeStart >= 0) {
            updateEntry({
              ...cur.entry,
              date: targetDate,
              startTime: slotToTime(freeStart),
              endTime: slotToTime(freeStart + duration),
            });
          }
          // freeStart === -1 means day is full → silently keep original position
        } else {
          onEditEntry(cur.entry); // no movement → treat as click
        }

      } else if (cur.kind === 'resize-top') {
        const origStart = timeToSlot(cur.entry.startTime);
        const origEnd   = timeToSlot(cur.entry.endTime);
        const requested = clamp(slot, 0, origEnd - 1);
        // Don't overlap any entry that ends inside (requested, origStart]
        const prevBlockerEnd = snap
          .filter(e => e.date === cur.entry.date && e.id !== cur.entry.id)
          .map(e => timeToSlot(e.endTime))
          .filter(end => end > requested && end <= origStart)
          .reduce((max, v) => Math.max(max, v), requested);
        updateEntry({ ...cur.entry, startTime: slotToTime(prevBlockerEnd) });

      } else if (cur.kind === 'resize-bottom') {
        const origStart = timeToSlot(cur.entry.startTime);
        const origEnd   = timeToSlot(cur.entry.endTime);
        const requested = clamp(slot, origStart + 1, TOTAL_SLOTS);
        // Don't overlap any entry that starts inside [origEnd, requested)
        const nextBlockerStart = snap
          .filter(e => e.date === cur.entry.date && e.id !== cur.entry.id)
          .map(e => timeToSlot(e.startTime))
          .filter(s => s >= origEnd && s < requested)
          .reduce((min, v) => Math.min(min, v), requested);
        updateEntry({ ...cur.entry, endTime: slotToTime(nextBlockerStart) });
      }

      iaRef.current = null;
      setIa(null);
      didMoveRef.current = false;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [days, mouseToSlotDay, onSelect, onEditEntry, updateEntry, isBlocked]);

  // ── Live position of an entry during drag/resize ──────────────────────────
  const livePos = (entry: TimeEntry) => {
    const origStart = timeToSlot(entry.startTime);
    const origEnd   = timeToSlot(entry.endTime);
    const origDay   = days.findIndex(d => dateToISO(d) === entry.date);
    if (!ia) return { startSlot: origStart, endSlot: origEnd, dayIdx: origDay };

    if (ia.kind === 'move' && ia.entry.id === entry.id) {
      const dur = origEnd - origStart;
      const s = clamp(ia.currentSlot - ia.slotOffset, 0, TOTAL_SLOTS - dur);
      return { startSlot: s, endSlot: s + dur, dayIdx: ia.currentDayIdx };
    }
    if (ia.kind === 'resize-top' && ia.entry.id === entry.id) {
      const requested = clamp(ia.currentSlot, 0, origEnd - 1);
      // Hard-stop live preview at the end of the nearest previous entry
      const prevBlockerEnd = displayEntries
        .filter(e => e.date === entry.date && e.id !== entry.id)
        .map(e => timeToSlot(e.endTime))
        .filter(end => end > requested && end <= origStart)
        .reduce((max, v) => Math.max(max, v), requested);
      return { startSlot: prevBlockerEnd, endSlot: origEnd, dayIdx: origDay };
    }
    if (ia.kind === 'resize-bottom' && ia.entry.id === entry.id) {
      const requested = clamp(ia.currentSlot, origStart + 1, TOTAL_SLOTS);
      // Hard-stop live preview at the start of the nearest next entry
      const nextBlockerStart = displayEntries
        .filter(e => e.date === entry.date && e.id !== entry.id)
        .map(e => timeToSlot(e.startTime))
        .filter(s => s >= origEnd && s < requested)
        .reduce((min, v) => Math.min(min, v), requested);
      return { startSlot: origStart, endSlot: nextBlockerStart, dayIdx: origDay };
    }
    return { startSlot: origStart, endSlot: origEnd, dayIdx: origDay };
  };

  const isEntryActive = (id: string) =>
    ia != null &&
    (ia.kind === 'move' || ia.kind === 'resize-top' || ia.kind === 'resize-bottom') &&
    (ia as { entry: TimeEntry }).entry.id === id;

  const today = dateToISO(new Date());
  const bg        = isDark ? 'bg-[#0e0f11]' : 'bg-[#f5f4f0]';
  const border    = isDark ? 'border-white/8' : 'border-black/8';
  const textMuted = isDark ? 'text-white/30' : 'text-black/30';
  const headerBg  = isDark ? 'bg-[#14151a]' : 'bg-[#ededea]';

  // ── Day / week totals ─────────────────────────────────────────────────────
  const entryMins = (e: TimeEntry) => {
    const [sh, sm] = e.startTime.split(':').map(Number);
    const [eh, em] = e.endTime.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  };
  const dayMins = days.map(d => {
    const iso = dateToISO(d);
    return displayEntries.filter(e => e.date === iso).reduce((s, e) => s + entryMins(e), 0);
  });
  const weekMins = dayMins.reduce((s, m) => s + m, 0);
  const fmtMins = (m: number) => m === 0 ? '' : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`;

  const monthYear = (() => {
    const months = new Set(days.map(d => d.getMonth()));
    if (months.size === 1) return `${MONTH_NAMES[days[0].getMonth()]} ${days[0].getFullYear()}`;
    return `${MONTH_NAMES[days[0].getMonth()]} / ${MONTH_NAMES[days[6].getMonth()]} ${days[6].getFullYear()}`;
  })();

  return (
    <div className={`flex flex-col h-full ${bg} select-none`}>
      {/* ── Header nav ── */}
      <div className={`flex items-center gap-4 px-4 py-2 border-b ${border} ${headerBg} flex-shrink-0`}>
        <button
          onClick={() => setWeekOffset(w => w - 1)}
          className={`p-1 rounded hover:bg-white/10 transition-colors ${isDark ? 'text-white/60 hover:text-white' : 'text-black/50 hover:text-black'}`}
        ><ChevronLeft size={16} /></button>
        <span className={`text-xs font-semibold tracking-widest uppercase ${isDark ? 'text-white/50' : 'text-black/50'}`}>{monthYear}</span>
        <button
          onClick={() => setWeekOffset(w => w + 1)}
          className={`p-1 rounded hover:bg-white/10 transition-colors ${isDark ? 'text-white/60 hover:text-white' : 'text-black/50 hover:text-black'}`}
        ><ChevronRight size={16} /></button>
        {weekMins > 0 && (
          <span className={`ml-auto text-[11px] tabular-nums font-medium ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            {fmtMins(weekMins)}
          </span>
        )}
        <button
          onClick={() => setWeekOffset(0)}
          className={`${weekMins > 0 ? '' : 'ml-auto '}text-[10px] px-2 py-0.5 rounded border transition-colors ${isDark ? 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/70' : 'border-black/15 text-black/40 hover:border-black/30 hover:text-black/70'}`}
        >Heute</button>
        <button
          onClick={newForToday} disabled={todayBlocked}
          title={todayBlocked ? `Heute: ${absenceLabel(absences[todayISO])} – keine Buchung möglich` : 'Neuer Eintrag heute – oder im Kalender über einen Zeitraum ziehen'}
          className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors disabled:opacity-40 disabled:pointer-events-none ${isDark ? 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/70' : 'border-black/15 text-black/40 hover:border-black/30 hover:text-black/70'}`}
        ><CalendarPlus size={11} /> Neuer Eintrag</button>
      </div>

      {/* ── Day header row ── */}
      <div className={`flex border-b ${border} flex-shrink-0`} style={{ paddingLeft: TIME_COL_W }}>
        {days.map((d, i) => {
          const iso = dateToISO(d);
          const isToday = iso === today;
          const dayAbs = absences[iso] ?? [];
          const dayTotal = fmtMins(dayMins[i]);
          return (
            <div key={i} className={`group relative flex-1 text-center py-1.5 text-xs ${isToday ? (isDark ? 'text-blue-400' : 'text-blue-600') : textMuted}`}>
              {/* Absence (Ferien / Krank / Feiertag): excluded from the revenue forecast */}
              <button
                onMouseDown={e => e.stopPropagation()} // keep the menu's outside-click handler from re-opening it
                onClick={() => setAbsenceMenu(m => (m === iso ? null : iso))}
                title={dayAbs.length > 0 ? `${absenceLabel(dayAbs)} – ändern` : 'Abwesenheit markieren'}
                className={`absolute top-1 right-1 p-0.5 rounded flex gap-0.5 transition-opacity ${
                  dayAbs.length > 0
                    ? ''
                    : `${absenceMenu === iso ? '' : 'opacity-0'} group-hover:opacity-100 ${isDark ? 'text-white/30 hover:text-white/70' : 'text-black/30 hover:text-black/70'}`
                }`}
              >
                {dayAbs.length === 0 && <CalendarOff size={12} />}
                {dayAbs.map(a => {
                  const cfg = ABSENCE_TYPES[a.type];
                  const Icon = cfg.icon;
                  return <Icon key={a.type} size={12} className={isDark ? cfg.text : cfg.textLight} />;
                })}
              </button>
              {absenceMenu === iso && (
                <AbsenceMenu value={dayAbs} hasEntries={dayMins[i] > 0} onChange={list => setAbsence(iso, list)} onClose={closeAbsenceMenu} isDark={isDark} />
              )}
              <div className="font-semibold truncate px-1">{DAY_NAMES[i]}</div>
              <div className={`text-[11px] ${isToday ? 'font-bold' : ''}`}>{d.getDate()}</div>
              {dayAbs.length > 0 && (
                <div className="text-[10px] mt-0.5 opacity-80 truncate px-1">
                  {dayAbs.map((a, j) => {
                    const cfg = ABSENCE_TYPES[a.type];
                    return (
                      <span key={a.type} className={isDark ? cfg.text : cfg.textLight}>
                        {j > 0 && ' + '}{cfg.label}{a.half ? ' ½' : ''}
                      </span>
                    );
                  })}
                </div>
              )}
              {dayTotal && (
                <div className={`text-[10px] tabular-nums mt-0.5 ${isToday ? (isDark ? 'text-blue-400/70' : 'text-blue-600/70') : (isDark ? 'text-white/20' : 'text-black/20')}`}>
                  {dayTotal}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Scrollable grid ── */}
      <div ref={scrollRef} data-cal-scroll className="flex-1 overflow-y-auto">
        <div ref={gridRef} className="flex" style={{ minHeight: TOTAL_SLOTS * SLOT_HEIGHT }}>

          {/* Time column */}
          <div className="flex-shrink-0" style={{ width: TIME_COL_W }}>
            {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
              <div key={i} style={{ height: SLOT_HEIGHT * 4 }} className={`relative border-b ${border}`}>
                <span className={`absolute -top-2 right-2 text-[10px] ${textMuted}`}>
                  {String(HOUR_START + i).padStart(2, '0')}:00
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day, dayIdx) => {
            // Render entries whose LIVE position lands in this column
            const dayEntries = displayEntries.filter(e => livePos(e).dayIdx === dayIdx);
            const dayAbs = absences[dateToISO(day)] ?? [];
            const blocked = blocksBooking(dayAbs);
            const stripes = dayAbs.map(a => (isDark ? ABSENCE_TYPES[a.type].stripe : ABSENCE_TYPES[a.type].stripeLight));

            return (
              <div key={dayIdx} className={`flex-1 relative border-l ${border}`}>
                {dayAbs.length > 0 && (
                  <div className="absolute inset-0 pointer-events-none"
                    style={{
                      // single half day: lighter; two halves: their stripes alternate
                      opacity: blocked ? 1 : 0.5,
                      backgroundImage: stripes.length > 1
                        ? `repeating-linear-gradient(45deg, ${stripes[0]} 0 6px, transparent 6px 14px, ${stripes[1]} 14px 20px, transparent 20px 28px)`
                        : `repeating-linear-gradient(45deg, ${stripes[0]} 0 6px, transparent 6px 14px)`,
                    }} />
                )}

                {/* Background slot grid (for new-entry drag-selection) */}
                {Array.from({ length: TOTAL_SLOTS }, (_, slot) => {
                  const isHourBorder = slot % 4 === 0;
                  const sel = ia?.kind === 'select' && ia.dayIdx === dayIdx;
                  const lo  = sel ? Math.min(ia!.startSlot, ia!.endSlot) : -1;
                  const hi  = sel ? Math.max(ia!.startSlot, ia!.endSlot) : -1;
                  const inSel = sel && slot >= lo && slot <= hi;
                  return (
                    <div
                      key={slot}
                      className={`cal-slot ${inSel ? 'selecting' : ''} ${isHourBorder ? `border-t ${border}` : ''} ${blocked ? 'cursor-not-allowed' : ''}`}
                      style={{ height: SLOT_HEIGHT }}
                      onMouseDown={() => {
                        if (blocked) return; // full-day absence: no new bookings
                        didMoveRef.current = false;
                        const next: Interaction = { kind: 'select', dayIdx, startSlot: slot, endSlot: slot };
                        iaRef.current = next;
                        setIa(next);
                      }}
                    />
                  );
                })}

                {/* Live drag-selection preview */}
                {ia?.kind === 'select' && ia.dayIdx === dayIdx && (() => {
                  const lo = Math.min(ia.startSlot, ia.endSlot);
                  const hi = Math.max(ia.startSlot, ia.endSlot) + 1;
                  return (
                    <div
                      className="absolute left-0.5 right-0.5 rounded pointer-events-none z-10"
                      style={{
                        top: lo * SLOT_HEIGHT,
                        height: Math.max((hi - lo) * SLOT_HEIGHT, SLOT_HEIGHT),
                        background: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)',
                        border: `1px dashed ${isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)'}`,
                      }}
                    >
                      <div className={`px-1 pt-0.5 text-[9px] leading-tight ${isDark ? 'text-white/45' : 'text-black/40'}`}>
                        {slotToTime(lo)}–{slotToTime(hi)}
                      </div>
                    </div>
                  );
                })()}


                {/* Time entries */}
                {dayEntries.map(entry => {
                  const pos    = livePos(entry);
                  const top    = pos.startSlot * SLOT_HEIGHT;
                  const height = Math.max((pos.endSlot - pos.startSlot) * SLOT_HEIGHT, SLOT_HEIGHT);
                  const client = clients.find(c => c.id === entry.clientId);
                  const color  = clientColor(entry.clientId);
                  const isSelected = entry.id === selectedId;
                  const active     = isEntryActive(entry.id);
                  const justCopied = copiedId === entry.id;
                  const descMissing = !!client?.descriptionRequired && !entry.description.trim();

                  return (
                    <div
                      key={entry.id}
                      data-entry-id={entry.id}
                      className={`absolute left-0.5 right-0.5 rounded border text-[10px] overflow-hidden
                        ${color}
                        ${isSelected ? 'ring-1 ring-white/60' : descMissing ? 'ring-2 ring-red-500' : ''}
                        ${active ? 'opacity-95 shadow-lg z-10' : 'opacity-80 hover:opacity-100'}`}
                      style={{ top, height }}
                    >
                      {/* ── Copy button (visible only when selected) ── */}
                      {isSelected && (
                        <button
                          className={`absolute z-30 flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold
                            transition-all duration-150 pointer-events-auto
                            ${justCopied
                              ? 'bg-white/40 text-white'
                              : 'bg-black/25 hover:bg-black/45 text-white/90 hover:text-white'}`}
                          style={{ top: HANDLE_PX + 2, right: 3 }}
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); endHover(); copyEntry(entry); }}
                          title="Eintrag kopieren"
                        >
                          {justCopied
                            ? <><Check size={8} /> Kopiert</>
                            : <><Copy size={8} /> Kopieren</>}
                        </button>
                      )}

                      {/* ▲ Top resize handle */}
                      <div
                        className="absolute top-0 left-0 right-0 z-20 group"
                        style={{ height: HANDLE_PX, cursor: 'ns-resize' }}
                        onMouseDown={e => {
                          e.stopPropagation();
                          didMoveRef.current = false;
                          const next: Interaction = { kind: 'resize-top', entry, currentSlot: timeToSlot(entry.startTime) };
                          iaRef.current = next; setIa(next);
                        }}
                      >
                        <div className="absolute inset-x-2 top-0.5 h-px bg-white/0 group-hover:bg-white/50 transition-colors rounded" />
                      </div>

                      {/* ↕ Body — drag to move */}
                      <div
                        className="absolute inset-0 px-1 overflow-hidden"
                        style={{ top: HANDLE_PX, bottom: HANDLE_PX, cursor: active ? 'grabbing' : 'grab' }}
                        onMouseEnter={e => startHover(entry, e.clientX, e.clientY)}
                        onMouseMove={e => moveHover(e.clientX, e.clientY)}
                        onMouseLeave={endHover}
                        onMouseDown={e => {
                          e.stopPropagation();
                          endHover();
                          didMoveRef.current = false;
                          const { slot } = mouseToSlotDay(e.nativeEvent);
                          const origDay = days.findIndex(d => dateToISO(d) === entry.date);
                          const next: Interaction = {
                            kind: 'move', entry,
                            slotOffset: slot - timeToSlot(entry.startTime),
                            currentDayIdx: origDay,
                            currentSlot: slot,
                          };
                          iaRef.current = next; setIa(next);
                        }}
                      >
                        <div className="font-semibold text-white leading-tight truncate mt-0.5">
                          {entry.project || client?.name || '—'}
                        </div>
                        {height >= SLOT_HEIGHT * 2 && (
                          <div className="text-white/70 truncate">
                            {slotToTime(pos.startSlot)}–{slotToTime(pos.endSlot)}
                          </div>
                        )}
                        {/* Extra field + description, when there is room (body clips overflow) */}
                        {height >= SLOT_HEIGHT * 3 && (entry.extra || entry.description) && (
                          <div className="mt-1 space-y-0.5 text-white/85 leading-snug">
                            {entry.extra && (
                              <div className="truncate">
                                <span className="text-white/60">{client?.extraField?.label || 'Zusatz'}:</span> {entry.extra}
                              </div>
                            )}
                            {entry.description && (
                              <div className="whitespace-pre-line break-words">{entry.description}</div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* ▼ Bottom resize handle */}
                      <div
                        className="absolute bottom-0 left-0 right-0 z-20 group"
                        style={{ height: HANDLE_PX, cursor: 'ns-resize' }}
                        onMouseDown={e => {
                          e.stopPropagation();
                          didMoveRef.current = false;
                          const next: Interaction = { kind: 'resize-bottom', entry, currentSlot: timeToSlot(entry.endTime) };
                          iaRef.current = next; setIa(next);
                        }}
                      >
                        <div className="absolute inset-x-2 bottom-0.5 h-px bg-white/0 group-hover:bg-white/50 transition-colors rounded" />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Tooltip / Sprechblase ── */}
      {hoveredEntry && !ia && hoveredEntry.id !== selectedId && (() => {
        const tc = clients.find(c => c.id === hoveredEntry.clientId);
        const [sh, sm] = hoveredEntry.startTime.split(':').map(Number);
        const [eh, em] = hoveredEntry.endTime.split(':').map(Number);
        const mins = (eh * 60 + em) - (sh * 60 + sm);
        const dur = `${Math.floor(mins / 60)}h${mins % 60 > 0 ? ` ${mins % 60}min` : ''}`;
        const [dy, dm, dd] = hoveredEntry.date.split('-').map(Number);
        const dateStr = new Date(dy, dm - 1, dd).toLocaleDateString('de-CH', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });

        const TIP_W = 230;
        const GAP   = 14;
        const toRight = tipPos.x + GAP + TIP_W < window.innerWidth - 12;
        const left = toRight ? tipPos.x + GAP : tipPos.x - GAP - TIP_W;
        const top  = Math.min(tipPos.y - 8, window.innerHeight - 260);

        const panelCls = isDark
          ? 'bg-[#1c1d22] border-white/12 text-white shadow-[0_8px_32px_rgba(0,0,0,0.6)]'
          : 'bg-white border-black/10 text-black shadow-[0_8px_32px_rgba(0,0,0,0.15)]';
        const labelCls = isDark ? 'text-white/35' : 'text-black/35';
        const dividerCls = isDark ? 'border-white/8' : 'border-black/8';
        const arrowBg = isDark ? '#1c1d22' : '#ffffff';
        const arrowBorder = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';

        return (
          <div
            className={`fixed z-50 pointer-events-none rounded-xl border text-[11px] leading-relaxed ${panelCls}`}
            style={{ left, top, width: TIP_W }}
          >
            {/* Arrow */}
            <div style={{
              position: 'absolute',
              top: 12,
              [toRight ? 'left' : 'right']: -5,
              width: 10, height: 10,
              background: arrowBg,
              border: `1px solid ${arrowBorder}`,
              borderRight: toRight ? 'none' : undefined,
              borderTop:   toRight ? 'none' : undefined,
              borderLeft:  toRight ? undefined : 'none',
              borderBottom: toRight ? undefined : 'none',
              transform: 'rotate(45deg)',
            }} />

            <div className="px-3 pt-2.5 pb-2 space-y-1.5">
              {/* Project + client */}
              <div>
                <div className="font-semibold text-[12px] leading-tight">
                  {hoveredEntry.project || tc?.name || '—'}
                </div>
                {hoveredEntry.project && tc?.name && (
                  <div className={labelCls}>{tc.name}</div>
                )}
              </div>

              <div className={`border-t ${dividerCls}`} />

              {/* Date */}
              <div className="flex gap-2">
                <span className={`w-14 flex-shrink-0 ${labelCls}`}>Datum</span>
                <span className="font-medium">{dateStr}</span>
              </div>

              {/* Time */}
              <div className="flex gap-2">
                <span className={`w-14 flex-shrink-0 ${labelCls}`}>Zeit</span>
                <span className="font-medium">{hoveredEntry.startTime} – {hoveredEntry.endTime}</span>
              </div>

              {/* Duration */}
              <div className="flex gap-2">
                <span className={`w-14 flex-shrink-0 ${labelCls}`}>Dauer</span>
                <span className="font-medium">{dur}</span>
              </div>

              {/* Description */}
              {hoveredEntry.description && (
                <>
                  <div className={`border-t ${dividerCls}`} />
                  <div className={`${labelCls} leading-snug`}>
                    {hoveredEntry.description}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
