import React, { useEffect, useMemo, useState } from 'react';
import { BookCheck, FileText, Landmark, Upload, X } from 'lucide-react';
import { useStore } from '../store';
import { BexioBooking } from '../types';
import { fmtChf, monthSum, ymOf } from '../expenses';
import { monthLabel } from '../expenseExport';
import {
  BexioError, UploadFile, bexioAccounts, bookExpenses, bookingPlan, connectUrl, findFilesPath, proxyHealth,
  tokenDaysLeft, tokenProblem, uploadFiles,
} from '../bexio';

const pad = (n: number) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const baseName = (p: string) => p.split('/').pop() ?? p;
const errText = (e: unknown) => e instanceof BexioError || e instanceof Error ? e.message : String(e);

export default function BexioDialog({ ym, onClose }: { ym: string; onClose: () => void }) {
  const { isDark, company, clients, expenseData, setExpenseData, openReceipt } = useStore();
  const sum = monthSum(expenseData, company, ym);
  const month = expenseData.months[ym];
  const booked = month?.bexio;
  const accounts = bexioAccounts(company);
  const plan = useMemo(() => bookingPlan(sum, accounts), [sum.total, sum.auto, sum.bahn, sum.other, sum.allowance, company]); // eslint-disable-line react-hooks/exhaustive-deps
  const receipts = expenseData.expenses.filter(e => ymOf(e.date) === ym).flatMap(e => e.receipts ?? []);
  const pdfName = `Spesen_${ym}_${(company.name || 'firma').split(/\s+/)[0].toLowerCase()}.pdf`;

  const [proxy, setProxy] = useState<'checking' | 'ok' | string>('checking');
  const [expiryHint, setExpiryHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]); // why uploads failed (this session)

  useEffect(() => {
    proxyHealth()
      .then(h => {
        setProxy(tokenProblem(h) ?? 'ok');
        const days = tokenDaysLeft(h);
        if (days != null && days >= 0 && days <= 7) {
          setExpiryHint(`bexio-Token läuft in ${days} Tag${days === 1 ? '' : 'en'} ab – auf developer.bexio.com/pat erneuern.`);
        }
      })
      .catch(e => setProxy(errText(e)));
  }, []);

  const saveBooking = (b: BexioBooking) =>
    setExpenseData(d => ({ ...d, months: { ...d.months, [ym]: { ...d.months[ym], allowance: sum.allowance, bexio: b } } }));

  // Statement PDF + receipts of the month; `only` limits to these file names
  const collectFiles = async (only?: string[]) => {
    const files: UploadFile[] = [];
    const missing: { name: string; reason: string }[] = [];
    if (!only || only.includes(pdfName)) {
      setStep('Spesenabrechnung erstellen…');
      const { buildMonthPdf } = await import('../expensePdf'); // jsPDF is large: load on demand
      files.push({ name: pdfName, blob: buildMonthPdf(expenseData, company, clients, ym) });
    }
    for (const p of receipts) {
      if (only && !only.includes(baseName(p))) continue;
      try { files.push({ name: baseName(p), blob: await openReceipt(p) }); }
      catch { missing.push({ name: baseName(p), reason: 'Datei nicht gefunden' }); }
    }
    return { files, missing };
  };

  const book = async () => {
    setBusy(true); setError(null); setReasons([]);
    try {
      const { files, missing } = await collectFiles();
      const r = await bookExpenses(sum, company, files, setStep);
      const failed = [...missing, ...r.failed];
      saveBooking({
        bookedAt: todayIso(), amount: sum.total, entryId: r.entryId, refNr: r.refNr,
        filesPath: r.filesPath, missingFiles: failed.map(f => f.name),
      });
      setReasons(failed.map(f => `${f.name}: ${f.reason}`));
      setStep(null);
    } catch (e) {
      setError(errText(e));
      setStep(null);
    } finally {
      setBusy(false);
    }
  };

  const markManual = () => {
    if (!confirm(`${monthLabel(ym)} als bereits manuell in bexio gebucht markieren (CHF ${fmtChf(sum.total)})? Die Spesen werden gesperrt.`)) return;
    saveBooking({ bookedAt: todayIso(), amount: sum.total });
  };

  // Upload attachments that are missing on an existing booking
  const retryFiles = async () => {
    if (!booked?.entryId) return;
    setBusy(true); setError(null); setReasons([]);
    try {
      setStep('Buchung in bexio suchen…');
      const path = booked.filesPath ?? await findFilesPath(booked.entryId);
      const { files, missing } = await collectFiles(booked.missingFiles);
      const failed = [...missing, ...await uploadFiles(path, files, setStep)];
      saveBooking({ ...booked, filesPath: path, missingFiles: failed.map(f => f.name) });
      setReasons(failed.map(f => `${f.name}: ${f.reason}`));
      setStep(null);
    } catch (e) {
      setError(errText(e));
      setStep(null);
    } finally {
      setBusy(false);
    }
  };
  // Bookings from before missingFiles was tracked: offer to upload everything
  const pendingFiles = booked?.entryId ? booked.missingFiles ?? [pdfName, ...receipts.map(baseName)] : [];

  const unlink = () => {
    if (!confirm('Verknüpfung zur bexio-Buchung lösen? Die Buchung in bexio bleibt bestehen und muss dort bei Bedarf manuell gelöscht werden. Die Spesen werden wieder bearbeitbar (sofern nicht ausbezahlt).')) return;
    setExpenseData(d => {
      const { bexio: _, ...rest } = d.months[ym] ?? {};
      const months = { ...d.months };
      if (rest.paidAt) months[ym] = rest; else delete months[ym];
      return { ...d, months };
    });
  };

  // ── Theme ──
  const card = isDark ? 'bg-[#16171c] text-white border-white/10' : 'bg-white text-black border-black/10';
  const muted = isDark ? 'text-white/45' : 'text-black/45';
  const border = isDark ? 'border-white/10' : 'border-black/10';
  const btn = `flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
    isDark ? 'border-white/15 text-white/70 hover:border-white/35 hover:text-white' : 'border-black/15 text-black/70 hover:border-black/40 hover:text-black'
  }`;
  const primary = `flex items-center gap-1.5 text-xs px-4 py-1.5 rounded font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none ${
    isDark ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/80'
  }`;
  const changed = booked && Math.abs(booked.amount - sum.total) > 0.004;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={() => !busy && onClose()}>
      <div className={`rounded-lg border shadow-2xl w-full max-w-[620px] p-6 ${card}`} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2"><Landmark size={14} /> bexio-Buchung {monthLabel(ym)}</div>
            <div className={`text-[11px] ${muted}`}>Saldosteuersatz: Buchung ohne Vorsteuer</div>
          </div>
          <button onClick={onClose} disabled={busy} className={`p-1 rounded ${muted} hover:opacity-100`}><X size={14} /></button>
        </div>

        {booked ? (
          <div className="space-y-3 text-xs">
            <div className="flex items-center gap-2 text-sky-500">
              <BookCheck size={14} />
              {booked.entryId ? 'In bexio gebucht' : 'Manuell in bexio gebucht'} am {fmtDate(booked.bookedAt)}
              {booked.refNr && <span className={muted}>· {booked.refNr}</span>}
            </div>
            <div className="tabular-nums">Betrag CHF {fmtChf(booked.amount)}</div>
            {changed && (
              <div className="text-amber-500">
                Achtung: Das aktuelle Monatstotal (CHF {fmtChf(sum.total)}) weicht von der Buchung ab.
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            <table className="w-full">
              <thead>
                <tr className={`text-[10px] uppercase tracking-wider ${muted}`}>
                  <th className="text-left font-normal py-1">Soll</th>
                  <th className="text-left font-normal">Haben</th>
                  <th className="text-left font-normal">Text</th>
                  <th className="text-right font-normal">CHF</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className={`border-t ${border}`}>
                  <td className="py-1.5">{plan.debit}</td><td>{plan.credit}</td>
                  <td>{plan.description}</td><td className="text-right">{fmtChf(plan.amount)}</td>
                </tr>
              </tbody>
            </table>
            <div className={muted}>Buchungsdatum {fmtDate(plan.date)}</div>

            <div>
              <div className={`text-[10px] uppercase tracking-wider mb-1 ${muted}`}>Anhänge</div>
              {[pdfName, ...receipts.map(baseName)].map(n => (
                <div key={n} className="flex items-center gap-1.5"><FileText size={11} className={muted} /> {n}</div>
              ))}
            </div>

            <div className={proxy === 'ok' ? 'text-emerald-500' : proxy === 'checking' ? muted : 'text-red-400'}>
              {proxy === 'ok' ? 'bexio-Proxy verbunden' : proxy === 'checking' ? 'Prüfe bexio-Proxy…' : proxy}
              {proxy.startsWith('Noch nicht mit bexio verbunden') && (
                <button className="ml-2 underline" onClick={() => window.open(connectUrl(), '_blank')}>Jetzt verbinden</button>
              )}
            </div>
            {expiryHint && <div className="text-amber-500">{expiryHint}</div>}
          </div>
        )}

        {step && <div className={`mt-4 text-xs ${muted}`}>{step}</div>}
        {error && <div className="mt-4 text-xs text-red-400 break-words">{error}</div>}
        {booked && pendingFiles.length > 0 && (
          <div className="mt-4 text-xs text-amber-500 space-y-1">
            <div>{booked.missingFiles ? 'Diese Anhänge fehlen in bexio noch:' : 'Anhänge in bexio nicht bestätigt:'}</div>
            {(reasons.length ? reasons : pendingFiles).map(w => <div key={w}>· {w}</div>)}
            <button className={`${btn} mt-2`} disabled={busy || proxy !== 'ok'} onClick={retryFiles}>
              <Upload size={12} /> Anhänge hochladen
            </button>
          </div>
        )}

        <div className={`flex items-center gap-2 mt-5 pt-4 border-t ${border}`}>
          {booked ? (
            <button className={btn} disabled={busy} onClick={unlink}>Verknüpfung lösen</button>
          ) : (
            <>
              <button className={primary} disabled={busy || proxy !== 'ok' || sum.total <= 0} onClick={book}>
                {busy ? 'Buche…' : 'In bexio buchen'}
              </button>
              <button className={btn} disabled={busy} onClick={markManual} title="Für Monate, die du schon von Hand in bexio gebucht hast">
                Bereits manuell gebucht
              </button>
            </>
          )}
          <button className={`${btn} ml-auto`} disabled={busy} onClick={onClose}>Schliessen</button>
        </div>
      </div>
    </div>
  );
}
