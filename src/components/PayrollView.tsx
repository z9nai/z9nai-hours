import React, { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Lock, QrCode, Settings2, Undo2, X } from 'lucide-react';
import { useStore } from '../store';
import { PayrollMonth, PayrollRates } from '../types';
import { PayrollCalc, bvgMonthly, calcMonth, isPayrollPaid, ratesFor, sumCalcs } from '../payroll';
import { allowanceFor, expenseAmount, fmtChf } from '../expenses';
import { monthLabel } from '../expenseExport';
import PayoutQrDialog from './PayoutQrDialog';

const pad = (n: number) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const parseNum = (s: string) => {
  const t = s.trim().replace(/['’\s]/g, '').replace(',', '.');
  return t === '' ? 0 : Number(t);
};
const num = (n: number) => (n === 0 ? '–' : fmtChf(n));

type Panel = { kind: 'month'; ym: string } | { kind: 'rates' } | null;

export default function PayrollView() {
  const { isDark, company, payrollData, setPayrollData, expenseData } = useStore();
  const now = new Date();
  const curYm = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const [year, setYear] = useState(now.getFullYear());
  const [panel, setPanel] = useState<Panel>(null);
  const [qrYm, setQrYm] = useState<string | null>(null);

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
  const calcs = useMemo(() => months.map(ym => calcMonth(payrollData, ym)), [payrollData, year]); // eslint-disable-line react-hooks/exhaustive-deps
  const h1 = sumCalcs(calcs.slice(0, 6)), h2 = sumCalcs(calcs.slice(6)), total = sumCalcs(calcs);
  const rates = ratesFor(payrollData, year);
  const showKtg = rates.ktg > 0 || total.ktg > 0;
  const showBonus = total.bonus > 0;
  const showTax = total.withholdingTax > 0;
  const showAdvance = total.advance > 0;

  // ── Theme ──
  const muted = isDark ? 'text-white/40' : 'text-black/40';
  const faint = isDark ? 'text-white/25' : 'text-black/25';
  const border = isDark ? 'border-white/8' : 'border-black/8';
  const strong = isDark ? 'border-white/20' : 'border-black/20';
  const rowHover = isDark ? 'hover:bg-white/5' : 'hover:bg-black/5';
  const selRow = isDark ? 'bg-white/8' : 'bg-black/8';
  const card = `rounded-xl border p-4 ${isDark ? 'border-white/8' : 'border-black/8'}`;
  const btn = `flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
    isDark ? 'border-white/15 text-white/60 hover:border-white/30 hover:text-white' : 'border-black/15 text-black/60 hover:border-black/30 hover:text-black'
  }`;
  const iconBtn = `p-1 rounded transition-colors disabled:opacity-30 disabled:pointer-events-none ${
    isDark ? 'text-white/40 hover:text-white hover:bg-white/10' : 'text-black/40 hover:text-black hover:bg-black/10'
  }`;

  const togglePaid = (ym: string) => {
    const m = payrollData.months[ym];
    if (!m) return;
    if (m.paidAt) {
      if (!confirm(`Auszahlung Lohn ${monthLabel(ym)} aufheben? Der Monat wird wieder bearbeitbar.`)) return;
      setPayrollData(d => ({ ...d, months: { ...d.months, [ym]: { ...m, paidAt: undefined } } }));
    } else {
      const c = calcMonth(payrollData, ym);
      if (!confirm(`Lohn ${monthLabel(ym)} als ausbezahlt markieren (CHF ${fmtChf(c.payout)})? Der Monat wird danach gesperrt.`)) return;
      setPayrollData(d => ({ ...d, months: { ...d.months, [ym]: { ...m, paidAt: todayIso() } } }));
    }
  };

  // Columns of the monthly table (some only when used)
  const cols: { key: keyof PayrollCalc; label: string; show: boolean; bold?: boolean }[] = [
    { key: 'gross', label: 'Brutto', show: true },
    { key: 'bonus', label: 'Bonus', show: showBonus },
    { key: 'ahv', label: 'AHV', show: true },
    { key: 'alv', label: 'ALV', show: true },
    { key: 'nbu', label: 'NBU', show: true },
    { key: 'ktg', label: 'KTG', show: showKtg },
    { key: 'bvg', label: 'BVG', show: true },
    { key: 'deductions', label: 'Abzüge', show: true },
    { key: 'allowance', label: 'Kinderz.', show: true },
    { key: 'withholdingTax', label: 'QSt', show: showTax },
    { key: 'net', label: 'Netto', show: true, bold: true },
    { key: 'advance', label: 'à-cto', show: showAdvance },
    { key: 'payout', label: 'Auszahlung', show: showAdvance },
  ];
  const shown = cols.filter(c => c.show);

  const totalRow = (label: string, s: Record<string, number>, heavy = false) => (
    <tr className={`border-t ${heavy ? `border-t-2 ${strong}` : strong} font-semibold`}>
      <td className="py-1.5 px-2 whitespace-nowrap">{label}</td>
      {shown.map(c => <td key={c.key} className="text-right px-2 tabular-nums">{num(s[c.key])}</td>)}
      <td colSpan={2} />
    </tr>
  );

  const monthRow = (c: PayrollCalc) => {
    const m = payrollData.months[c.ym];
    const paidAt = m?.paidAt;
    const isSel = panel?.kind === 'month' && panel.ym === c.ym;
    const empty = !m || c.base === 0;
    return (
      <tr key={c.ym} onClick={() => setPanel({ kind: 'month', ym: c.ym })}
        className={`border-t ${border} cursor-pointer transition-colors ${isSel ? selRow : rowHover} ${empty ? faint : ''}`}>
        <td className={`py-1.5 px-2 ${isSel ? 'font-semibold' : ''}`}>{monthLabel(c.ym).split(' ')[0]}</td>
        {shown.map(col => (
          <td key={col.key} className={`text-right px-2 tabular-nums ${col.bold ? 'font-semibold' : ''}`}>{num(c[col.key] as number)}</td>
        ))}
        <td className="px-3 whitespace-nowrap">
          {paidAt ? (
            <span className="inline-flex items-center gap-1 text-emerald-500"><Check size={11} /> {fmtDate(paidAt)}</span>
          ) : !empty && c.ym <= curYm ? <span className="text-amber-500">offen</span> : null}
        </td>
        <td className="px-1 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
          <button className={iconBtn} disabled={c.payout <= 0} onClick={() => setQrYm(c.ym)} title="QR-Code für die Lohnzahlung (E-Banking)">
            <QrCode size={12} />
          </button>
          <button className={iconBtn} disabled={empty} onClick={() => togglePaid(c.ym)}
            title={paidAt ? 'Auszahlung aufheben' : 'Als ausbezahlt markieren'}>
            {paidAt ? <Undo2 size={12} /> : <Check size={12} />}
          </button>
        </td>
      </tr>
    );
  };

  // ── Lohnausweis (year) ──
  const yearExpenses = expenseData.expenses.filter(e => e.date.startsWith(`${year}-`));
  const effectiveExpenses = yearExpenses.reduce((n, e) => n + expenseAmount(e), 0);
  const allowanceExpenses = months.reduce((n, ym) => n + allowanceFor(expenseData, company, ym), 0);
  const paidMonths = calcs.filter(c => c.base > 0);
  const period = paidMonths.length
    ? `01.${paidMonths[0].ym.slice(5, 7)}.${year} – ${new Date(year, Number(paidMonths[paidMonths.length - 1].ym.slice(5, 7)), 0).getDate()}.${paidMonths[paidMonths.length - 1].ym.slice(5, 7)}.${year}`
    : '–';
  const z8 = total.base + total.allowance;
  const z9 = total.ahv + total.alv + total.nbu;
  const lohnausweis: [string, string, number | string, string?][] = [
    ['', 'Zeitraum', period],
    ['1', 'Lohn (inkl. Kinderzulagen)', total.gross + total.allowance, `davon Kinderzulagen ${fmtChf(total.allowance)}`],
    ['3', 'Unregelmässige Leistungen (Bonus)', total.bonus],
    ['8', 'Bruttolohn total', z8],
    ['9', 'Beiträge AHV/IV/EO/ALV/NBUV', z9],
    ['10.1', 'Berufliche Vorsorge, ordentliche Beiträge', total.bvg],
    ['11', 'Nettolohn', z8 - z9 - total.bvg],
    ['12', 'Quellensteuerabzug', total.withholdingTax],
    ['13.1.1', 'Effektive Spesen: Reise, Verpflegung, Übernachtung', effectiveExpenses, 'aus Spesen-Tab'],
    ['13.2.3', 'Pauschalspesen: übrige', allowanceExpenses, 'aus Spesen-Tab'],
  ];

  const editing = panel?.kind === 'month' ? panel.ym : null;

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-3 mb-1">
            <h2 className={`text-sm font-semibold uppercase tracking-widest ${isDark ? 'text-white/50' : 'text-black/50'}`}>Lohn</h2>
            <div className="flex items-center gap-1 ml-2">
              <button className={iconBtn} onClick={() => setYear(year - 1)}><ChevronLeft size={14} /></button>
              <span className="text-xs font-semibold w-10 text-center">{year}</span>
              <button className={iconBtn} onClick={() => setYear(year + 1)}><ChevronRight size={14} /></button>
            </div>
            <button className={`${btn} ml-auto`} onClick={() => setPanel(panel?.kind === 'rates' ? null : { kind: 'rates' })}>
              <Settings2 size={12} /> Sätze {year}
            </button>
          </div>
          <div className={`text-xs mb-5 ${muted}`}>
            {payrollData.employee.name || 'Arbeitnehmer nicht erfasst'}{payrollData.employee.ahvNr && ` · AHV-Nr. ${payrollData.employee.ahvNr}`}
          </div>

          {/* Monthly table */}
          <div className="overflow-x-auto mb-8">
            <table className="w-full text-xs">
              <thead>
                <tr className={`text-[10px] uppercase tracking-wider ${muted}`}>
                  <th className="text-left font-normal py-1.5 px-2">Monat</th>
                  {shown.map(c => <th key={c.key} className="text-right font-normal px-2">{c.label}</th>)}
                  <th className="text-left font-normal px-3">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {calcs.slice(0, 6).map(monthRow)}
                {totalRow('Total 1. Halbjahr', h1)}
                {calcs.slice(6).map(monthRow)}
                {totalRow('Total 2. Halbjahr', h2)}
                {totalRow(`Total ${year}`, total, true)}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Employer contributions */}
            <div className={card}>
              <div className={`text-[10px] uppercase tracking-wider mb-3 ${muted}`}>Arbeitgeberbeiträge {year}</div>
              <table className="w-full text-xs tabular-nums">
                <tbody>
                  {([
                    ['AHV/IV/EO', total.agAhv, `${rates.agAhv} %`],
                    ['ALV', total.agAlv, `${rates.agAlv} %`],
                    ['FAK', total.fak, `${rates.fak} %`],
                    ['Verwaltungskosten', total.vk, `${rates.vk} % der AHV`],
                    ['BU', total.bu, `${rates.bu} %`],
                    ['KTG', total.agKtg, `${rates.agKtg} %`],
                    ['BVG', total.agBvg, `${rates.bvgEmployer} %`],
                  ] as const).map(([label, v, rate]) => (
                    <tr key={label} className={`border-t ${border}`}>
                      <td className="py-1">{label}</td>
                      <td className={`text-right ${muted}`}>{rate}</td>
                      <td className="text-right">{num(v)}</td>
                    </tr>
                  ))}
                  <tr className={`border-t ${strong} font-semibold`}>
                    <td className="py-1.5" colSpan={2}>Total Arbeitgeber</td><td className="text-right">{fmtChf(total.employer)}</td>
                  </tr>
                  <tr className={`border-t ${border} font-semibold`}>
                    <td className="py-1.5" colSpan={2}>Lohnkosten (Brutto + Arbeitgeber)</td><td className="text-right">{fmtChf(total.cost)}</td>
                  </tr>
                </tbody>
              </table>
              {(rates.fak === 0 || rates.vk === 0 || rates.bu === 0) && (
                <p className="text-[11px] text-amber-500 mt-2">FAK, Verwaltungskosten und BU noch ohne Satz – unter «Sätze {year}» gemäss Ausgleichskasse / Police erfassen.</p>
              )}
            </div>

            {/* Lohnausweis */}
            <div className={card}>
              <div className={`text-[10px] uppercase tracking-wider mb-3 ${muted}`}>Lohnausweis {year} (Formular 11)</div>
              <table className="w-full text-xs tabular-nums">
                <tbody>
                  {lohnausweis.map(([z, label, v, note]) => (
                    <tr key={label} className={`border-t ${border} ${['8', '11'].includes(z) ? 'font-semibold' : ''}`}>
                      <td className={`py-1 pr-2 w-12 ${muted}`}>{z}</td>
                      <td>
                        {label}
                        {note && <div className={`text-[10px] ${muted}`}>{note}</div>}
                      </td>
                      <td className="text-right whitespace-nowrap">{typeof v === 'number' ? fmtChf(v) : v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={`text-[11px] mt-2 ${muted}`}>
                Zum Übertragen in den Lohnausweis. Bei Spesen nach genehmigtem Reglement in Ziffer 13 nur ankreuzen, Beträge je nach Reglement.
                {total.ktg > 0 && ' KTG-Beiträge des Arbeitnehmers gehören nicht in Ziffer 9.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {panel && (
        <div className={`w-80 flex-shrink-0 border-l overflow-y-auto ${border} ${isDark ? 'bg-[#14151a]' : 'bg-[#ededea]'}`}>
          {panel.kind === 'rates'
            ? <RatesForm key={`rates-${year}`} year={year} onClose={() => setPanel(null)} />
            : <MonthForm key={editing!} ym={editing!} onClose={() => setPanel(null)} />}
        </div>
      )}

      {qrYm && (
        <PayoutQrDialog
          title={`Lohnzahlung ${monthLabel(qrYm)}`}
          amount={calcMonth(payrollData, qrYm).payout}
          message={`Lohn ${monthLabel(qrYm)}${company.name ? ` ${company.name}` : ''}`}
          paidAt={payrollData.months[qrYm]?.paidAt}
          onClose={() => setQrYm(null)}
          onPaid={() => { const m = qrYm; setQrYm(null); togglePaid(m); }}
        />
      )}
    </div>
  );
}

// ── Shared form bits ──────────────────────────────────────────────────────────
function useFormTheme() {
  const { isDark } = useStore();
  return {
    isDark,
    label: `block text-[10px] uppercase tracking-wider mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`,
    field: `w-full text-xs px-3 py-2 rounded border outline-none transition-colors disabled:opacity-60 ${
      isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-white/30' : 'bg-black/5 border-black/10 text-black placeholder-black/20 focus:border-black/30'
    }`,
    muted: isDark ? 'text-white/40' : 'text-black/40',
    border: isDark ? 'border-white/8' : 'border-black/8',
    primary: `flex items-center gap-1.5 text-xs px-4 py-1.5 rounded font-semibold transition-all ${isDark ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/80'}`,
    secondary: `flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors ${
      isDark ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white' : 'border-black/15 text-black/50 hover:border-black/30 hover:text-black'
    }`,
  };
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const t = useFormTheme();
  return (
    <div className={`flex items-center justify-between px-4 py-3 border-b ${t.border}`}>
      <span className={`text-xs font-semibold uppercase tracking-widest ${t.isDark ? 'text-white/50' : 'text-black/50'}`}>{title}</span>
      <button onClick={onClose} className={`p-1 rounded ${t.isDark ? 'text-white/40 hover:text-white' : 'text-black/40 hover:text-black'}`}><X size={14} /></button>
    </div>
  );
}

function NumField({ label, value, onChange, placeholder, disabled }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
}) {
  const t = useFormTheme();
  return (
    <div>
      <label className={t.label}>{label}</label>
      <input inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} className={t.field} />
    </div>
  );
}

// ── Month panel ───────────────────────────────────────────────────────────────
function MonthForm({ ym, onClose }: { ym: string; onClose: () => void }) {
  const { payrollData, setPayrollData } = useStore();
  const t = useFormTheme();
  const existing = payrollData.months[ym];
  const locked = isPayrollPaid(payrollData, ym);

  // New month: suggest the latest earlier month with a salary
  const template: PayrollMonth | undefined = existing ?? Object.entries(payrollData.months)
    .filter(([k, m]) => k < ym && m.gross > 0).sort(([a], [b]) => b.localeCompare(a))[0]?.[1];
  const str = (n?: number) => (n ? String(n) : '');
  const [f, setF] = useState({
    gross: str(template?.gross), bonus: str(existing?.bonus), children: str(template?.children),
    withholdingTax: str(existing?.withholdingTax), advance: str(existing?.advance),
  });
  const set = (k: keyof typeof f) => (v: string) => setF(p => ({ ...p, [k]: v }));

  const draft: PayrollMonth = {
    gross: parseNum(f.gross), bonus: parseNum(f.bonus) || undefined, children: Math.round(parseNum(f.children)) || undefined,
    withholdingTax: parseNum(f.withholdingTax) || undefined, advance: parseNum(f.advance) || undefined,
    ...(existing?.paidAt ? { paidAt: existing.paidAt } : {}),
  };
  const invalid = Object.values(f).some(v => Number.isNaN(parseNum(v)));
  const c = calcMonth(payrollData, ym, draft);

  const save = () => {
    if (invalid) return;
    setPayrollData(d => ({ ...d, months: { ...d.months, [ym]: draft } }));
    onClose();
  };
  const clear = () => {
    if (!confirm(`Lohn ${monthLabel(ym)} löschen?`)) return;
    setPayrollData(d => {
      const { [ym]: _, ...rest } = d.months;
      return { ...d, months: rest };
    });
    onClose();
  };

  const line = (label: string, v: number, sign = '', bold = false) => (
    <div className={`flex justify-between py-0.5 ${bold ? 'font-semibold' : ''}`}>
      <span className={bold ? '' : t.muted}>{label}</span><span className="tabular-nums">{sign}{fmtChf(v)}</span>
    </div>
  );

  return (
    <div className="flex flex-col min-h-full">
      <PanelHeader title={`Lohn ${monthLabel(ym)}`} onClose={onClose} />
      <div className="flex-1 px-4 py-4 space-y-4 text-xs">
        {locked && (
          <div className={`flex items-start gap-2 text-[11px] p-2 rounded ${t.isDark ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'}`}>
            <Lock size={12} className="mt-0.5 flex-shrink-0" /> Ausbezahlt am {fmtDate(existing!.paidAt!)}. Zum Ändern die Auszahlung aufheben.
          </div>
        )}
        {!existing && template && <div className={`text-[11px] ${t.muted}`}>Vorschlag aus dem Vormonat – mit Speichern übernehmen.</div>}
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Gehalt brutto" value={f.gross} onChange={set('gross')} placeholder="0.00" disabled={locked} />
          <NumField label="Bonus" value={f.bonus} onChange={set('bonus')} placeholder="0.00" disabled={locked} />
          <NumField label="Anzahl Kinder" value={f.children} onChange={set('children')} placeholder="0" disabled={locked} />
          <NumField label="Quellensteuer" value={f.withholdingTax} onChange={set('withholdingTax')} placeholder="0.00" disabled={locked} />
          <NumField label="à-cto bezahlt" value={f.advance} onChange={set('advance')} placeholder="0.00" disabled={locked} />
        </div>
        {invalid && <div className="text-red-400 text-[11px]">Bitte gültige Zahlen eingeben.</div>}

        <div className={`pt-3 border-t ${t.border}`}>
          <div className={`text-[10px] uppercase tracking-wider mb-1 ${t.muted}`}>Abrechnung</div>
          {line('AHV-pflichtiger Lohn', c.base, '', true)}
          {line('AHV/IV/EO', c.ahv, '− ')}
          {line('ALV', c.alv, '− ')}
          {line('NBU', c.nbu, '− ')}
          {c.ktg > 0 && line('KTG', c.ktg, '− ')}
          {line('BVG', c.bvg, '− ')}
          {c.allowance > 0 && line('Kinderzulagen', c.allowance, '+ ')}
          {c.withholdingTax > 0 && line('Quellensteuer', c.withholdingTax, '− ')}
          {line('Nettolohn', c.net, '', true)}
          {c.advance > 0 && line('à-cto bezahlt', c.advance, '− ')}
          {c.advance > 0 && line('Auszahlung', c.payout, '', true)}
        </div>

        <div className={`pt-3 border-t ${t.border}`}>
          <div className={`text-[10px] uppercase tracking-wider mb-1 ${t.muted}`}>Arbeitgeber</div>
          {line('AHV/IV/EO', c.agAhv)}
          {line('ALV', c.agAlv)}
          {c.fak > 0 && line('FAK', c.fak)}
          {c.vk > 0 && line('Verwaltungskosten', c.vk)}
          {c.bu > 0 && line('BU', c.bu)}
          {c.agKtg > 0 && line('KTG', c.agKtg)}
          {line('BVG', c.agBvg)}
          {line('Total Arbeitgeber', c.employer, '', true)}
          {line('Lohnkosten', c.cost, '', true)}
        </div>
      </div>
      {!locked && (
        <div className={`px-4 py-3 border-t flex items-center gap-2 ${t.border}`}>
          <button onClick={save} disabled={invalid} className={t.primary}><Check size={12} /> Speichern</button>
          {existing && <button onClick={clear} className={`${t.secondary} ml-auto`}>Löschen</button>}
        </div>
      )}
    </div>
  );
}

// ── Rates panel ───────────────────────────────────────────────────────────────
function RatesForm({ year, onClose }: { year: number; onClose: () => void }) {
  const { payrollData, setPayrollData } = useStore();
  const t = useFormTheme();
  const r = ratesFor(payrollData, year);
  const [emp, setEmp] = useState(payrollData.employee);
  const [f, setF] = useState<Record<keyof PayrollRates, string>>(
    () => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])) as Record<keyof PayrollRates, string>,
  );
  const set = (k: keyof PayrollRates) => (v: string) => setF(p => ({ ...p, [k]: v }));
  const parsed = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, parseNum(v)])) as unknown as PayrollRates;
  const invalid = Object.values(parsed).some(v => Number.isNaN(v) || v < 0);
  const bvg = bvgMonthly(parsed);
  const inherited = !payrollData.rates[year];

  const save = () => {
    if (invalid) return;
    setPayrollData(d => ({ ...d, employee: { name: emp.name.trim(), ahvNr: emp.ahvNr.trim() }, rates: { ...d.rates, [year]: parsed } }));
    onClose();
  };
  const section = (title: string) => <div className={`text-[10px] uppercase tracking-wider pt-2 ${t.muted}`}>{title}</div>;

  return (
    <div className="flex flex-col min-h-full">
      <PanelHeader title={`Sätze ${year}`} onClose={onClose} />
      <div className="flex-1 px-4 py-4 space-y-3 text-xs">
        {inherited && <div className={`text-[11px] ${t.muted}`}>Noch keine Sätze für {year} – Werte vom Vorjahr bzw. Standard.</div>}
        {section('Arbeitnehmer')}
        <div>
          <label className={t.label}>Name</label>
          <input value={emp.name} onChange={e => setEmp(p => ({ ...p, name: e.target.value }))} className={t.field} />
        </div>
        <div>
          <label className={t.label}>AHV-Nr.</label>
          <input value={emp.ahvNr} onChange={e => setEmp(p => ({ ...p, ahvNr: e.target.value }))} placeholder="756.xxxx.xxxx.xx" className={t.field} />
        </div>

        {section('Abzüge Arbeitnehmer (%)')}
        <div className="grid grid-cols-2 gap-2">
          <NumField label="AHV/IV/EO" value={f.ahv} onChange={set('ahv')} />
          <NumField label="ALV" value={f.alv} onChange={set('alv')} />
          <NumField label="NBU" value={f.nbu} onChange={set('nbu')} />
          <NumField label="KTG" value={f.ktg} onChange={set('ktg')} />
        </div>

        {section('BVG gemäss Police')}
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Jahreslohn" value={f.bvgSalary} onChange={set('bvgSalary')} />
          <NumField label="Koordinationsabzug" value={f.bvgCoordination} onChange={set('bvgCoordination')} />
          <NumField label="Arbeitnehmer %" value={f.bvgEmployee} onChange={set('bvgEmployee')} />
          <NumField label="Arbeitgeber %" value={f.bvgEmployer} onChange={set('bvgEmployer')} />
        </div>
        <div className={`text-[11px] ${t.muted}`}>
          Versicherter Lohn {fmtChf(bvg.insured)} · pro Monat AN {fmtChf(bvg.employee)} / AG {fmtChf(bvg.employer)}
        </div>

        {section('Beiträge Arbeitgeber (%)')}
        <div className="grid grid-cols-2 gap-2">
          <NumField label="AHV/IV/EO" value={f.agAhv} onChange={set('agAhv')} />
          <NumField label="ALV" value={f.agAlv} onChange={set('agAlv')} />
          <NumField label="FAK" value={f.fak} onChange={set('fak')} />
          <NumField label="Verwaltungskosten" value={f.vk} onChange={set('vk')} />
          <NumField label="BU" value={f.bu} onChange={set('bu')} />
          <NumField label="KTG" value={f.agKtg} onChange={set('agKtg')} />
        </div>
        <div className={`text-[11px] ${t.muted}`}>Verwaltungskosten in % der AHV-Beiträge (AN + AG).</div>

        {section('Weitere')}
        <div className="grid grid-cols-2 gap-2">
          <NumField label="ALV/UVG-Höchstlohn" value={f.alvCeiling} onChange={set('alvCeiling')} />
          <NumField label="Kinderzulage / Kind" value={f.childAllowance} onChange={set('childAllowance')} />
        </div>
        {invalid && <div className="text-red-400 text-[11px]">Bitte gültige, positive Zahlen eingeben.</div>}
      </div>
      <div className={`px-4 py-3 border-t flex items-center gap-2 ${t.border}`}>
        <button onClick={save} disabled={invalid} className={t.primary}><Check size={12} /> Speichern</button>
      </div>
    </div>
  );
}
