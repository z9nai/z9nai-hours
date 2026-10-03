import React, { useMemo, useRef, useState } from 'react';
import {
  Car, Train, Receipt, Plus, ChevronLeft, ChevronRight, Printer, FileSpreadsheet, Check, Lock, Undo2,
  Paperclip, X, Copy, Trash2, FileText, QrCode,
} from 'lucide-react';
import { useStore } from '../store';
import { Expense, ExpenseKind } from '../types';
import { clientColorClasses } from '../colors';
import {
  DEFAULT_KM_RATE, EXPENSE_KINDS, EXPENSE_KIND_ORDER, OTHER_ARTS, expenseAmount, expenseTitle, fmtChf, hasReceipt,
  isPaid, monthSum, round2, ymOf,
} from '../expenses';
import { exportYearXlsx, monthLabel, payoutMessage, printMonth } from '../expenseExport';
import { payoutQr } from '../swissqr';

const KIND_ICON: Record<ExpenseKind, React.ElementType> = { auto: Car, bahn: Train, other: Receipt };

const genId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const pad = (n: number) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const fmtDay = (iso: string) => {
  const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(iso + 'T00:00:00').getDay()];
  return `${wd} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
};
const parseNum = (s: string) => {
  const t = s.trim().replace(/['’\s]/g, '').replace(',', '.');
  return t === '' ? NaN : Number(t);
};
const baseName = (p: string) => p.split('/').pop() ?? p;

// Unique non-empty values, most recent first
const recent = (vals: (string | undefined)[]) => {
  const out: string[] = [];
  for (let i = vals.length - 1; i >= 0; i--) {
    const v = vals[i]?.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
};

interface Draft {
  expense: Expense;
  isNew: boolean;
  added: string[];   // receipts stored during this edit (removed again on cancel)
  removed: string[]; // existing receipts to delete on save
}

export default function ExpensesView() {
  const { isDark, company, clients, expenseData, setExpenseData, saveReceipt, openReceipt, deleteReceipt, dirHandle } = useStore();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [ym, setYm] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrYm, setQrYm] = useState<string | null>(null);

  const curYm = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
  const sums = useMemo(() => months.map(m => monthSum(expenseData, company, m)),
    [expenseData, company, year]); // eslint-disable-line react-hooks/exhaustive-deps
  const yearTotal = sums.reduce((t, s) => ({
    km: t.km + s.km, auto: t.auto + s.auto, bahn: t.bahn + s.bahn, other: t.other + s.other,
    allowance: t.allowance + s.allowance, total: t.total + s.total,
  }), { km: 0, auto: 0, bahn: 0, other: 0, allowance: 0, total: 0 });

  const monthList = expenseData.expenses.filter(e => ymOf(e.date) === ym);
  const monthPaid = isPaid(expenseData, ym);
  const sel = monthSum(expenseData, company, ym);

  // ── Theme ──
  const muted = isDark ? 'text-white/40' : 'text-black/40';
  const faint = isDark ? 'text-white/25' : 'text-black/25';
  const border = isDark ? 'border-white/8' : 'border-black/8';
  const rowHover = isDark ? 'hover:bg-white/5' : 'hover:bg-black/5';
  const selRow = isDark ? 'bg-white/8' : 'bg-black/8';
  const btn = `flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
    isDark ? 'border-white/15 text-white/60 hover:border-white/30 hover:text-white' : 'border-black/15 text-black/60 hover:border-black/30 hover:text-black'
  }`;
  const iconBtn = `p-1 rounded transition-colors disabled:opacity-30 disabled:pointer-events-none ${
    isDark ? 'text-white/40 hover:text-white hover:bg-white/10' : 'text-black/40 hover:text-black hover:bg-black/10'
  }`;

  // ── Draft handling ──
  const discardDraft = async (d: Draft | null) => {
    if (!d) return;
    for (const p of d.added) await deleteReceipt(p).catch(() => {});
  };

  const openDraft = async (expense: Expense, isNew: boolean) => {
    await discardDraft(draft);
    setError(null);
    setDraft({ expense, isNew, added: [], removed: [] });
  };

  const newExpense = (kind: ExpenseKind) => {
    const date = ymOf(todayIso()) === ym ? todayIso()
      : monthList.length ? monthList[monthList.length - 1].date : `${ym}-01`;
    const base: Expense = { id: genId(), date, kind, purpose: '' };
    openDraft(kind === 'auto' ? { ...base, rate: company.kmRate ?? DEFAULT_KM_RATE } : base, true);
  };

  const cancel = async () => { await discardDraft(draft); setDraft(null); setError(null); };

  const save = async (e: Expense) => {
    if (!draft) return;
    const orig = expenseData.expenses.find(x => x.id === e.id);
    if (isPaid(expenseData, ymOf(e.date)) || (orig && isPaid(expenseData, ymOf(orig.date)))) {
      setError('Dieser Monat ist bereits ausbezahlt. Hebe zuerst die Auszahlung auf.');
      return;
    }
    for (const p of draft.removed) await deleteReceipt(p).catch(() => {});
    setExpenseData(d => ({
      ...d,
      expenses: d.expenses.some(x => x.id === e.id) ? d.expenses.map(x => x.id === e.id ? e : x) : [...d.expenses, e],
    }));
    if (ymOf(e.date) !== ym) { setYm(ymOf(e.date)); setYear(Number(e.date.slice(0, 4))); }
    setDraft(null);
    setError(null);
  };

  const remove = async () => {
    if (!draft) return;
    const e = draft.expense;
    if (!draft.isNew && !confirm(`Spese vom ${fmtDate(e.date)} (${expenseTitle(e)}) löschen?`)) return;
    const orig = expenseData.expenses.find(x => x.id === e.id);
    for (const p of [...(orig?.receipts ?? []), ...draft.added]) await deleteReceipt(p).catch(() => {});
    setExpenseData(d => ({ ...d, expenses: d.expenses.filter(x => x.id !== e.id) }));
    setDraft(null);
  };

  const duplicate = (e: Expense) => {
    openDraft({
      ...e, id: genId(), date: todayIso(), receipts: undefined, receiptFiled: undefined,
      ...(e.kind === 'auto' ? { rate: company.kmRate ?? DEFAULT_KM_RATE } : {}),
    }, true);
  };

  const togglePaid = (m: string) => {
    if (isPaid(expenseData, m)) {
      if (!confirm(`Auszahlung ${monthLabel(m)} aufheben? Die Spesen werden wieder bearbeitbar.`)) return;
      setExpenseData(d => {
        const { [m]: _, ...rest } = d.months;
        return { ...d, months: rest };
      });
    } else {
      const s = monthSum(expenseData, company, m);
      if (!confirm(`${monthLabel(m)} als ausbezahlt markieren (CHF ${fmtChf(s.total)})? Die Spesen werden danach gesperrt.`)) return;
      setExpenseData(d => ({ ...d, months: { ...d.months, [m]: { paidAt: todayIso(), allowance: s.allowance } } }));
      if (draft && ymOf(draft.expense.date) === m) cancel();
    }
  };

  const showReceipt = async (path: string) => {
    try {
      const file = await openReceipt(path);
      const url = URL.createObjectURL(file);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(`Beleg ${baseName(path)} konnte nicht geöffnet werden: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const changeYear = (y: number) => {
    setYear(y);
    setYm(y === now.getFullYear() ? curYm : `${y}-12`);
  };

  const num = (n: number, dec = 2) => n === 0 ? '–' : dec === 0 ? n.toLocaleString('de-CH') : fmtChf(n);

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-5xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            <h2 className={`text-sm font-semibold uppercase tracking-widest ${isDark ? 'text-white/50' : 'text-black/50'}`}>Spesen</h2>
            <div className="flex items-center gap-1 ml-2">
              <button className={iconBtn} onClick={() => changeYear(year - 1)}><ChevronLeft size={14} /></button>
              <span className="text-xs font-semibold w-10 text-center">{year}</span>
              <button className={iconBtn} onClick={() => changeYear(year + 1)}><ChevronRight size={14} /></button>
            </div>
            <button className={`${btn} ml-auto`} onClick={() => exportYearXlsx(expenseData, company, clients, year)}
              title={`Alle Spesen ${year} als Excel exportieren`}>
              <FileSpreadsheet size={12} /> Excel {year}
            </button>
          </div>

          {!dirHandle && (
            <p className={`text-[11px] mb-4 ${muted}`}>Kein Datenverzeichnis gewählt — Spesen und Belege werden nicht gespeichert.</p>
          )}

          {/* Monthly overview */}
          <table className="w-full text-xs mb-8">
            <thead>
              <tr className={`text-[10px] uppercase tracking-wider ${muted}`}>
                <th className="text-left font-normal py-1.5 px-2">Monat</th>
                <th className="text-right font-normal px-2">Auto km</th>
                <th className="text-right font-normal px-2">Auto</th>
                <th className="text-right font-normal px-2">Bahn</th>
                <th className="text-right font-normal px-2">Übrige</th>
                <th className="text-right font-normal px-2">Pauschale</th>
                <th className="text-right font-normal px-2">Total CHF</th>
                <th className="text-left font-normal px-3">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sums.map(s => {
                const paidAt = expenseData.months[s.ym]?.paidAt;
                const isSel = s.ym === ym;
                const future = s.ym > curYm;
                return (
                  <tr key={s.ym} onClick={() => setYm(s.ym)}
                    className={`border-t ${border} cursor-pointer transition-colors ${isSel ? selRow : rowHover} ${future && s.total === 0 ? faint : ''}`}>
                    <td className={`py-1.5 px-2 ${isSel ? 'font-semibold' : ''}`}>{monthLabel(s.ym).split(' ')[0]}</td>
                    <td className="text-right px-2 tabular-nums">{num(s.km, 0)}</td>
                    <td className="text-right px-2 tabular-nums">{num(s.auto)}</td>
                    <td className="text-right px-2 tabular-nums">{num(s.bahn)}</td>
                    <td className="text-right px-2 tabular-nums">{num(s.other)}</td>
                    <td className="text-right px-2 tabular-nums">{num(s.allowance)}</td>
                    <td className="text-right px-2 tabular-nums font-semibold">{num(s.total)}</td>
                    <td className="px-3">
                      {paidAt ? (
                        <span className="inline-flex items-center gap-1 text-emerald-500"><Check size={11} /> {fmtDate(paidAt)}</span>
                      ) : s.total > 0 && !future ? (
                        <span className="text-amber-500">offen</span>
                      ) : null}
                    </td>
                    <td className="px-1 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <button className={iconBtn} disabled={s.total === 0}
                        onClick={() => printMonth(expenseData, company, clients, s.ym)} title="Spesenabrechnung als PDF drucken">
                        <Printer size={12} />
                      </button>
                      <button className={iconBtn} disabled={s.total === 0}
                        onClick={() => setQrYm(s.ym)} title="QR-Code für die Auszahlung (E-Banking)">
                        <QrCode size={12} />
                      </button>
                      <button className={iconBtn} disabled={!paidAt && s.total === 0}
                        onClick={() => togglePaid(s.ym)} title={paidAt ? 'Auszahlung aufheben' : 'Als ausbezahlt markieren'}>
                        {paidAt ? <Undo2 size={12} /> : <Check size={12} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr className={`border-t-2 ${isDark ? 'border-white/20' : 'border-black/20'} font-semibold`}>
                <td className="py-1.5 px-2">Total {year}</td>
                <td className="text-right px-2 tabular-nums">{num(yearTotal.km, 0)}</td>
                <td className="text-right px-2 tabular-nums">{num(round2(yearTotal.auto))}</td>
                <td className="text-right px-2 tabular-nums">{num(round2(yearTotal.bahn))}</td>
                <td className="text-right px-2 tabular-nums">{num(round2(yearTotal.other))}</td>
                <td className="text-right px-2 tabular-nums">{num(round2(yearTotal.allowance))}</td>
                <td className="text-right px-2 tabular-nums">{num(round2(yearTotal.total))}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>

          {/* Selected month */}
          <div className="flex items-center gap-3 mb-3">
            <h3 className="text-sm font-semibold">{monthLabel(ym)}</h3>
            {monthPaid && (
              <span className={`inline-flex items-center gap-1 text-[11px] ${muted}`}>
                <Lock size={11} /> ausbezahlt am {fmtDate(expenseData.months[ym]!.paidAt!)}
              </span>
            )}
            <span className={`text-xs ml-auto tabular-nums ${muted}`}>Total CHF {fmtChf(sel.total)}</span>
          </div>
          <div className="flex gap-2 mb-3">
            {EXPENSE_KIND_ORDER.map(k => {
              const Icon = KIND_ICON[k];
              return (
                <button key={k} className={btn} disabled={monthPaid} onClick={() => newExpense(k)}>
                  <Plus size={11} /><Icon size={12} /> {EXPENSE_KINDS[k].label}
                </button>
              );
            })}
          </div>

          {monthList.length === 0 ? (
            <p className={`text-xs py-6 ${muted}`}>
              Keine Spesen in diesem Monat{sel.allowance > 0 ? ` (Pauschale CHF ${fmtChf(sel.allowance)})` : ''}.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className={`text-[10px] uppercase tracking-wider ${muted}`}>
                  <th className="text-left font-normal py-1.5 px-2 w-24">Datum</th>
                  <th className="text-left font-normal px-2">Was</th>
                  <th className="text-left font-normal px-2">Zweck</th>
                  <th className="text-right font-normal px-2 w-16">km</th>
                  <th className="text-right font-normal px-2 w-24">CHF</th>
                  <th className="text-center font-normal px-2 w-12">Beleg</th>
                </tr>
              </thead>
              <tbody>
                {monthList.map(e => {
                  const Icon = KIND_ICON[e.kind];
                  const client = clients.find(c => c.id === e.clientId);
                  const isSel = draft?.expense.id === e.id;
                  return (
                    <tr key={e.id} onClick={() => openDraft(e, false)}
                      className={`border-t ${border} cursor-pointer transition-colors ${isSel ? selRow : rowHover}`}>
                      <td className="py-1.5 px-2 tabular-nums whitespace-nowrap">{fmtDay(e.date)}</td>
                      <td className="px-2">
                        <span className="inline-flex items-center gap-1.5">
                          <Icon size={12} className={muted} />{expenseTitle(e)}
                        </span>
                      </td>
                      <td className="px-2">
                        <span className="inline-flex items-center gap-1.5">
                          {client && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${clientColorClasses(client.color).dot}`} title={client.name} />}
                          {e.purpose}
                        </span>
                      </td>
                      <td className="text-right px-2 tabular-nums">{e.kind === 'auto' ? e.km : ''}</td>
                      <td className="text-right px-2 tabular-nums">{fmtChf(expenseAmount(e))}</td>
                      <td className="text-center px-2">
                        {e.receipts?.length
                          ? <Paperclip size={11} className="inline text-emerald-500" />
                          : e.receiptFiled ? <Check size={11} className={`inline ${muted}`} /> : <span className={faint}>–</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {qrYm && <QrDialog ym={qrYm} onClose={() => setQrYm(null)} onPaid={m => { setQrYm(null); togglePaid(m); }} />}

      {draft && (
        <div className={`w-80 flex-shrink-0 border-l overflow-y-auto ${border} ${isDark ? 'bg-[#14151a]' : 'bg-[#ededea]'}`}>
          <ExpenseForm
            key={draft.expense.id}
            draft={draft}
            locked={!draft.isNew && isPaid(expenseData, ymOf(draft.expense.date))}
            error={error}
            onChangeDraft={setDraft}
            onSave={save}
            onCancel={cancel}
            onDelete={remove}
            onDuplicate={duplicate}
            onShowReceipt={showReceipt}
            saveReceipt={saveReceipt}
            deleteReceipt={deleteReceipt}
            canStoreReceipts={!!dirHandle}
          />
        </div>
      )}
    </div>
  );
}

// ── Edit panel ────────────────────────────────────────────────────────────────
function ExpenseForm({
  draft, locked, error, onChangeDraft, onSave, onCancel, onDelete, onDuplicate, onShowReceipt, saveReceipt, deleteReceipt, canStoreReceipts,
}: {
  draft: Draft;
  locked: boolean;
  error: string | null;
  onChangeDraft: (d: Draft) => void;
  onSave: (e: Expense) => void;
  onCancel: () => void;
  onDelete: () => void;
  onDuplicate: (e: Expense) => void;
  onShowReceipt: (path: string) => void;
  saveReceipt: (file: File, date: string) => Promise<string>;
  deleteReceipt: (path: string) => Promise<void>;
  canStoreReceipts: boolean;
}) {
  const { isDark, clients, company, expenseData } = useStore();
  const e = draft.expense;
  const [f, setF] = useState({
    date: e.date, kind: e.kind, clientId: e.clientId ?? '', purpose: e.purpose,
    from: e.from ?? '', to: e.to ?? '', km: e.km != null ? String(e.km) : '',
    route: e.route ?? '', art: e.art ?? '', amount: e.amount != null ? String(e.amount) : '',
    receiptFiled: !!e.receiptFiled,
  });
  const [tried, setTried] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(p => ({ ...p, [k]: v }));

  const all = expenseData.expenses;
  const places = useMemo(() => recent(all.flatMap(x => [x.from, x.to])), [all]);
  const purposes = useMemo(() => recent(all.map(x => x.purpose)), [all]);
  const routes = useMemo(() => recent(all.map(x => x.route)), [all]);
  const arts = useMemo(() => [...OTHER_ARTS, ...recent(all.map(x => x.art)).filter(a => !OTHER_ARTS.includes(a))], [all]);

  const rate = e.kind === 'auto' && f.kind === 'auto' ? e.rate ?? company.kmRate ?? DEFAULT_KM_RATE : company.kmRate ?? DEFAULT_KM_RATE;
  const km = parseNum(f.km);
  const amount = parseNum(f.amount);
  const receipts = e.receipts ?? [];

  // Same route as an earlier trip (either direction) → take over its km
  const fillKm = () => {
    if (f.km.trim() || !f.from.trim() || !f.to.trim()) return;
    const a = f.from.trim(), b = f.to.trim();
    for (let i = all.length - 1; i >= 0; i--) {
      const x = all[i];
      if (x.kind !== 'auto' || !x.km) continue;
      if ((x.from === a && x.to === b) || (x.from === b && x.to === a)) { set('km', String(x.km)); return; }
    }
  };

  const invalid = {
    date: !/^\d{4}-\d{2}-\d{2}$/.test(f.date),
    purpose: !f.purpose.trim(),
    km: f.kind === 'auto' && !(km > 0),
    amount: f.kind !== 'auto' && !(amount > 0),
    art: f.kind === 'other' && !f.art.trim(),
  };
  const ok = !Object.values(invalid).some(Boolean);

  const build = (): Expense => {
    const base: Expense = {
      id: e.id, date: f.date, kind: f.kind, purpose: f.purpose.trim(),
      ...(f.clientId ? { clientId: f.clientId } : {}),
      ...(receipts.length ? { receipts } : {}),
      ...(f.receiptFiled ? { receiptFiled: true } : {}),
    };
    if (f.kind === 'auto') return { ...base, from: f.from.trim(), to: f.to.trim(), km: round2(km), rate };
    if (f.kind === 'bahn') return { ...base, route: f.route.trim(), amount: round2(amount) };
    return { ...base, art: f.art.trim(), amount: round2(amount) };
  };

  const submit = () => {
    setTried(true);
    if (ok) onSave(build());
  };

  const addFiles = async (files: FileList | File[]) => {
    if (!canStoreReceipts) { setUploadError('Kein Datenverzeichnis gewählt.'); return; }
    setUploading(true);
    setUploadError(null);
    try {
      const paths: string[] = [];
      for (const file of Array.from(files)) paths.push(await saveReceipt(file, f.date));
      onChangeDraft({ ...draft, expense: { ...e, receipts: [...receipts, ...paths] }, added: [...draft.added, ...paths] });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const removeReceipt = async (p: string) => {
    const isAdded = draft.added.includes(p);
    if (isAdded) await deleteReceipt(p).catch(() => {});
    onChangeDraft({
      ...draft,
      expense: { ...e, receipts: receipts.filter(x => x !== p) },
      added: draft.added.filter(x => x !== p),
      removed: isAdded ? draft.removed : [...draft.removed, p],
    });
  };

  // ── Theme ──
  const inputCls = isDark
    ? 'bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-white/30 [color-scheme:dark]'
    : 'bg-black/5 border-black/10 text-black placeholder-black/20 focus:border-black/30';
  const bad = (k: keyof typeof invalid) => tried && invalid[k] ? '!border-red-400/60' : '';
  const labelCls = `block text-[10px] uppercase tracking-wider mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`;
  const field = `w-full text-xs px-3 py-2 rounded border outline-none transition-colors disabled:opacity-60 ${inputCls}`;
  const muted = isDark ? 'text-white/40' : 'text-black/40';
  const smallBtn = `flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
    isDark ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white' : 'border-black/15 text-black/50 hover:border-black/30 hover:text-black'
  }`;
  const btnPrimary = isDark ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/80';
  const Req = ({ k }: { k: keyof typeof invalid }) => <span className={tried && invalid[k] ? 'text-red-400' : ''}>*</span>;

  return (
    <div className="flex flex-col min-h-full">
      <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-white/8' : 'border-black/8'}`}>
        <span className={`text-xs font-semibold uppercase tracking-widest ${isDark ? 'text-white/50' : 'text-black/50'}`}>
          {draft.isNew ? 'Neue Spese' : 'Spese'}
        </span>
        <button onClick={onCancel} className={`p-1 rounded ${isDark ? 'text-white/40 hover:text-white' : 'text-black/40 hover:text-black'}`}>
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 px-4 py-4 space-y-4 min-w-0">
        {locked && (
          <div className={`flex items-start gap-2 text-[11px] p-2 rounded ${isDark ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'}`}>
            <Lock size={12} className="mt-0.5 flex-shrink-0" />
            Monat ist ausbezahlt. Zum Ändern in der Übersicht die Auszahlung aufheben.
          </div>
        )}

        {/* Kind */}
        <div className={`grid grid-cols-3 rounded border overflow-hidden ${isDark ? 'border-white/10' : 'border-black/10'}`}>
          {EXPENSE_KIND_ORDER.map(k => {
            const Icon = KIND_ICON[k];
            const active = f.kind === k;
            return (
              <button key={k} type="button" disabled={locked} onClick={() => set('kind', k)}
                className={`flex items-center justify-center gap-1 text-[11px] py-1.5 transition-colors disabled:pointer-events-none ${locked && !active ? 'opacity-40' : ''} ${
                  active ? isDark ? 'bg-white/15 text-white' : 'bg-black/15 text-black'
                    : isDark ? 'text-white/40 hover:text-white/70' : 'text-black/40 hover:text-black/70'
                }`}>
                <Icon size={12} /> {EXPENSE_KINDS[k].short}
              </button>
            );
          })}
        </div>

        <div>
          <label className={labelCls}>Datum <Req k="date" /></label>
          <input disabled={locked} type="date" value={f.date} onChange={ev => set('date', ev.target.value)} className={`${field} ${bad('date')}`} />
        </div>

        {f.kind === 'auto' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Von</label>
                <input disabled={locked} list="exp-places" value={f.from} onChange={ev => set('from', ev.target.value)} onBlur={fillKm}
                  placeholder={company.address.city || 'Start'} className={field} />
              </div>
              <div>
                <label className={labelCls}>Nach</label>
                <input disabled={locked} list="exp-places" value={f.to} onChange={ev => set('to', ev.target.value)} onBlur={fillKm}
                  placeholder="Ziel" className={field} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 items-end">
              <div>
                <label className={labelCls}>km <Req k="km" /></label>
                <input disabled={locked} inputMode="decimal" value={f.km} onChange={ev => set('km', ev.target.value)} placeholder="0"
                  className={`${field} ${bad('km')}`} />
              </div>
              <div className={`text-xs pb-2 tabular-nums ${muted}`}>
                × {fmtChf(rate)} = <span className={isDark ? 'text-white' : 'text-black'}>CHF {fmtChf(km > 0 ? round2(km * rate) : 0)}</span>
              </div>
            </div>
            <p className={`text-[10px] -mt-2 ${muted}`}>Hin- und Rückfahrt zusammen erfassen, falls beides gefahren.</p>
          </>
        )}

        {f.kind === 'bahn' && (
          <div>
            <label className={labelCls}>Strecke</label>
            <input disabled={locked} list="exp-routes" value={f.route} onChange={ev => set('route', ev.target.value)} placeholder="Goldau–Bern" className={field} />
          </div>
        )}

        {f.kind === 'other' && (
          <div>
            <label className={labelCls}>Art <Req k="art" /></label>
            <input disabled={locked} list="exp-arts" value={f.art} onChange={ev => set('art', ev.target.value)} placeholder="Verpflegung Mittag"
              className={`${field} ${bad('art')}`} />
          </div>
        )}

        {f.kind !== 'auto' && (
          <div>
            <label className={labelCls}>Betrag CHF <Req k="amount" /></label>
            <input disabled={locked} inputMode="decimal" value={f.amount} onChange={ev => set('amount', ev.target.value)} placeholder="0.00"
              className={`${field} ${bad('amount')}`} />
          </div>
        )}

        <div>
          <label className={labelCls}>Kunde</label>
          <select disabled={locked} value={f.clientId} onChange={ev => set('clientId', ev.target.value)} className={field}>
            <option value="">— kein Kunde —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label className={labelCls}>Zweck <Req k="purpose" /></label>
          <input disabled={locked} list="exp-purposes" value={f.purpose} onChange={ev => set('purpose', ev.target.value)} placeholder="Arbeit vor Ort"
            className={`${field} ${bad('purpose')}`} />
        </div>

        {/* Receipts */}
        <div
          onDragOver={ev => { if (!locked) { ev.preventDefault(); setDragOver(true); } }}
          onDragLeave={() => setDragOver(false)}
          onDrop={ev => { ev.preventDefault(); setDragOver(false); if (!locked && ev.dataTransfer.files.length) addFiles(ev.dataTransfer.files); }}
          className={`rounded border border-dashed p-2 space-y-1.5 transition-colors ${
            dragOver ? 'border-blue-400 bg-blue-400/10' : isDark ? 'border-white/15' : 'border-black/15'
          }`}>
          <div className={`text-[10px] uppercase tracking-wider ${muted}`}>Belege</div>
          {receipts.map(p => (
            <div key={p} className="flex items-center gap-1.5 text-xs min-w-0">
              <FileText size={12} className={`flex-shrink-0 ${muted}`} />
              <button type="button" onClick={() => onShowReceipt(p)}
                className="truncate text-left hover:underline underline-offset-2" title={p}>
                {baseName(p)}
              </button>
              {!locked && (
                <button type="button" onClick={() => removeReceipt(p)} title="Beleg entfernen"
                  className={`ml-auto flex-shrink-0 p-0.5 rounded ${isDark ? 'text-white/30 hover:text-red-400' : 'text-black/30 hover:text-red-500'}`}>
                  <X size={11} />
                </button>
              )}
            </div>
          ))}
          <input ref={fileRef} type="file" multiple accept="application/pdf,image/*" className="hidden"
            onChange={ev => { if (ev.target.files?.length) addFiles(ev.target.files); ev.target.value = ''; }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || locked}
            className={`flex items-center gap-1.5 text-[11px] disabled:opacity-40 disabled:pointer-events-none ${isDark ? 'text-white/50 hover:text-white' : 'text-black/50 hover:text-black'}`}>
            <Paperclip size={11} /> {uploading ? 'Wird gespeichert…' : 'Beleg anhängen oder hierher ziehen'}
          </button>
          {uploadError && <div className="text-[11px] text-red-400">{uploadError}</div>}
          <label className={`flex items-center gap-2 text-[11px] pt-1 ${locked ? 'opacity-40' : 'cursor-pointer'} ${isDark ? 'text-white/60' : 'text-black/60'}`}>
            <input disabled={locked} type="checkbox" checked={f.receiptFiled} onChange={ev => set('receiptFiled', ev.target.checked)} className="accent-blue-500" />
            Beleg anderweitig abgelegt
          </label>
        </div>

        <datalist id="exp-places">{places.map(p => <option key={p} value={p} />)}</datalist>
        <datalist id="exp-routes">{routes.map(p => <option key={p} value={p} />)}</datalist>
        <datalist id="exp-arts">{arts.map(p => <option key={p} value={p} />)}</datalist>
        <datalist id="exp-purposes">{purposes.map(p => <option key={p} value={p} />)}</datalist>

        {(error || (tried && !ok)) && (
          <div className="text-[11px] text-red-400">{error ?? 'Bitte die markierten Felder ausfüllen.'}</div>
        )}
      </div>

      <div className={`px-4 py-3 border-t flex items-center gap-2 ${isDark ? 'border-white/8' : 'border-black/8'}`}>
        {!locked && (
          <button onClick={submit} className={`flex items-center gap-1.5 text-xs px-4 py-1.5 rounded font-semibold transition-all ${btnPrimary}`}>
            <Check size={12} /> Speichern
          </button>
        )}
        {!draft.isNew && (
          <button onClick={() => onDuplicate(e)} className={smallBtn} title="Als neue Spese mit heutigem Datum kopieren">
            <Copy size={12} />
          </button>
        )}
        {!locked && (
          <button onClick={onDelete} title={draft.isNew ? 'Verwerfen' : 'Spese löschen'}
            className={`ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors ${
              isDark ? 'border-white/15 text-white/40 hover:border-red-400/50 hover:text-red-400' : 'border-black/15 text-black/40 hover:border-red-500/50 hover:text-red-500'
            }`}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Payout QR code ──────────────────────────────────────────────────────────
function QrDialog({ ym, onClose, onPaid }: { ym: string; onClose: () => void; onPaid: (ym: string) => void }) {
  const { company, expenseData } = useStore();
  const total = monthSum(expenseData, company, ym).total;
  const message = payoutMessage(company, ym);
  const qr = useMemo(() => payoutQr(company, total, message), [company, total, message]);
  const paidAt = expenseData.months[ym]?.paidAt;
  const row = (label: string, value: React.ReactNode) => (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-black/45">{label}</div>
      <div className="text-xs text-black">{value}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div className="bg-white text-black rounded-lg shadow-2xl w-full max-w-[560px] p-6" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-sm font-semibold">Spesen-Auszahlung {monthLabel(ym)}</div>
            <div className="text-[11px] text-black/50">Mit der E-Banking-App der Firma scannen</div>
          </div>
          <button onClick={onClose} className="p-1 rounded text-black/40 hover:text-black"><X size={14} /></button>
        </div>
        {qr.ok ? (
          <div className="flex gap-6 flex-wrap">
            <div className="flex-shrink-0" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <div className="space-y-3 min-w-0 flex-1">
              {row('Konto / Zahlbar an', <>{qr.iban}<br />{qr.creditor.name}<br />{qr.creditor.street}<br />{qr.creditor.zip} {qr.creditor.city}</>)}
              {row('Betrag', <span className="font-semibold tabular-nums">CHF {fmtChf(total)}</span>)}
              {row('Zusätzliche Informationen', message)}
              {qr.debtor && row('Zahlbar durch', <>{qr.debtor.name}<br />{qr.debtor.zip} {qr.debtor.city}</>)}
            </div>
          </div>
        ) : (
          <div className="text-xs text-red-600 py-6">{qr.reason}</div>
        )}
        <div className="flex items-center gap-2 mt-5 pt-4 border-t border-black/10">
          {paidAt ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check size={12} /> ausbezahlt am {fmtDate(paidAt)}</span>
          ) : qr.ok ? (
            <button onClick={() => onPaid(ym)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-black/15 text-black/70 hover:border-black/40 hover:text-black">
              <Check size={12} /> Als ausbezahlt markieren
            </button>
          ) : null}
          <button onClick={onClose} className="ml-auto text-xs px-4 py-1.5 rounded font-semibold bg-black text-white hover:bg-black/80">Schliessen</button>
        </div>
      </div>
    </div>
  );
}
