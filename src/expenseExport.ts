import { Client, Company, Expense, ExpenseData } from './types';
import { DEFAULT_KM_RATE, expenseAmount, fmtChf, monthSum, ymOf } from './expenses';
import { Cell, Sheet, buildXlsx } from './xlsx';
import { payoutQr } from './swissqr';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// Payment message shown in the e-banking ("Zusätzliche Informationen")
export const payoutMessage = (company: Company, ym: string) =>
  `Spesen ${monthLabel(ym)}${company.name ? ` ${company.name}` : ''}`;

const isoToDate = (iso: string) => new Date(iso + 'T00:00:00');
const fmtDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const baseName = (path: string) => path.split('/').pop() ?? path;

function receiptText(e: Expense): string {
  if (e.receipts?.length) return e.receipts.map(baseName).join(', ');
  return e.receiptFiled ? 'abgelegt' : '–';
}

function clientName(clients: Client[], id?: string) {
  return id ? clients.find(c => c.id === id)?.name ?? '' : '';
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const companySlug = (c: Company) => (c.name || 'firma').split(/\s+/)[0].toLowerCase();

// ── Excel: one workbook per year, same sheets as the former Spesen spreadsheet ──
export function exportYearXlsx(data: ExpenseData, company: Company, clients: Client[], year: number) {
  download(buildYearXlsx(data, company, clients, year), `Spesen_${year}_${companySlug(company)}.xlsx`);
}

export function buildYearXlsx(data: ExpenseData, company: Company, clients: Client[], year: number): Blob {
  const inYear = data.expenses.filter(e => e.date.startsWith(`${year}-`));
  const of = (k: Expense['kind']) => inYear.filter(e => e.kind === k);
  const firm = company.name || 'Firma';

  // Data rows start below the header; totals reference them with SUM formulas
  const withTotal = (rows: Cell[][], first: number, sumCols: { col: string; idx: number; money: boolean }[], width: number): Cell[][] => {
    const last = first + rows.length - 1;
    const total: Cell[] = Array(width).fill(null);
    total[0] = { v: 'Total', s: 'bold' };
    for (const c of sumCols) {
      const cached = rows.reduce((n, r) => n + (Number((r[c.idx] as { v: number } | null)?.v) || 0), 0);
      total[c.idx] = { v: Math.round(cached * 100) / 100, f: rows.length ? `SUM(${c.col}${first}:${c.col}${last})` : undefined, s: c.money ? 'moneyBold' : 'numberBold' };
    }
    return [...rows, [], total];
  };

  const autoRows: Cell[][] = of('auto').map(e => [
    { v: isoToDate(e.date) }, e.from ?? '', e.to ?? '', e.purpose, clientName(clients, e.clientId),
    { v: e.km ?? 0, s: 'number' }, { v: e.rate ?? DEFAULT_KM_RATE, s: 'money' },
    { v: expenseAmount(e), s: 'money' }, receiptText(e),
  ]);
  const auto: Sheet = {
    name: 'Fahrten Auto',
    widths: [12, 16, 16, 40, 22, 8, 8, 12, 30],
    rows: [
      [{ v: `Fahrtenliste Auto ${year} – ${firm}`, s: 'title' }],
      [{ v: 'Kilometersatz (CHF/km)', s: 'muted' }, { v: company.kmRate ?? DEFAULT_KM_RATE, s: 'money' }, { v: 'Satz pro Fahrt in Spalte G', s: 'muted' }],
      [],
      ['Datum', 'Von', 'Nach', 'Zweck', 'Kunde', 'km', 'Satz', 'CHF', 'Beleg'].map(v => ({ v, s: 'bold' as const })),
      ...withTotal(autoRows, 5, [{ col: 'F', idx: 5, money: false }, { col: 'H', idx: 7, money: true }], 9),
    ],
  };

  const bahnRows: Cell[][] = of('bahn').map(e => [
    { v: isoToDate(e.date) }, e.route ?? '', e.purpose, clientName(clients, e.clientId),
    { v: expenseAmount(e), s: 'money' }, receiptText(e),
  ]);
  const bahn: Sheet = {
    name: 'Bahn',
    widths: [12, 24, 40, 22, 12, 30],
    rows: [
      [{ v: `Bahnfahrten ${year} – effektiv mit Beleg`, s: 'title' }],
      [],
      ['Datum', 'Strecke', 'Zweck', 'Kunde', 'Betrag CHF', 'Beleg'].map(v => ({ v, s: 'bold' as const })),
      ...withTotal(bahnRows, 4, [{ col: 'E', idx: 4, money: true }], 6),
    ],
  };

  const otherRows: Cell[][] = of('other').map(e => [
    { v: isoToDate(e.date) }, e.art ?? '', e.purpose, clientName(clients, e.clientId),
    { v: expenseAmount(e), s: 'money' }, receiptText(e),
  ]);
  const other: Sheet = {
    name: 'Übrige Spesen',
    widths: [12, 20, 40, 22, 12, 30],
    rows: [
      [{ v: `Übrige Spesen ${year} – Verpflegung, Parking, Übernachtung etc.`, s: 'title' }],
      [],
      ['Datum', 'Art', 'Zweck', 'Kunde', 'Betrag CHF', 'Beleg'].map(v => ({ v, s: 'bold' as const })),
      ...withTotal(otherRows, 4, [{ col: 'E', idx: 4, money: true }], 6),
    ],
  };

  const monthRows: Cell[][] = MONTHS.map((name, i) => {
    const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
    const s = monthSum(data, company, ym);
    const r = 4 + i;
    const paid = data.months[ym]?.paidAt;
    return [
      name, { v: s.km, s: 'number' }, { v: s.auto, s: 'money' }, { v: s.bahn, s: 'money' }, { v: s.other, s: 'money' },
      { v: s.allowance, s: 'money' }, { v: s.total, s: 'money', f: `SUM(C${r}:F${r})` },
      paid ? { v: isoToDate(paid) } : '',
    ];
  });
  const overview: Sheet = {
    name: 'Monatsübersicht',
    widths: [14, 10, 12, 12, 12, 13, 12, 14],
    rows: [
      [{ v: `Spesen ${year} – Monatsübersicht (Auszahlung ${firm})`, s: 'title' }],
      [],
      ['Monat', 'Auto km', 'Auto CHF', 'Bahn CHF', 'Übrige CHF', 'Pauschal CHF', 'Total CHF', 'Ausbezahlt am'].map(v => ({ v, s: 'bold' as const })),
      ...monthRows,
      (() => {
        const sum = (idx: number) => monthRows.reduce((n, r) => n + (Number((r[idx] as { v: number }).v) || 0), 0);
        return [
          { v: `Total ${year}`, s: 'bold' },
          ...['B', 'C', 'D', 'E', 'F', 'G'].map((col, k) => ({
            v: Math.round(sum(k + 1) * 100) / 100, f: `SUM(${col}4:${col}15)`, s: k === 0 ? 'numberBold' as const : 'moneyBold' as const,
          })),
        ];
      })(),
    ],
  };

  return buildXlsx([auto, bahn, other, overview]);
}

// ── PDF: printable monthly statement (browser print → "Als PDF sichern") ──
const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function printMonth(data: ExpenseData, company: Company, clients: Client[], ym: string) {
  const list = data.expenses.filter(e => ymOf(e.date) === ym);
  const s = monthSum(data, company, ym);
  const paidAt = data.months[ym]?.paidAt;
  const of = (k: Expense['kind']) => list.filter(e => e.kind === k);
  const cn = (e: Expense) => h(clientName(clients, e.clientId));
  const money = (n: number) => fmtChf(n);

  const table = (title: string, head: string[], rows: string[][], total: number, note = '') => rows.length === 0 ? '' : `
    <h2>${title}</h2>
    <table>
      <thead><tr>${head.map((c, i) => `<th${i === head.length - 1 ? ' class="r"' : ''}>${c}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i === r.length - 1 ? ' class="r"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="${head.length - 1}">Total${note}</td><td class="r">${money(total)}</td></tr></tfoot>
    </table>`;

  const autoRates = [...new Set(of('auto').map(e => e.rate ?? DEFAULT_KM_RATE))];
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>Spesen_${ym}_${companySlug(company)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 10pt/1.4 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5pt solid #111; padding-bottom: 8pt; margin-bottom: 14pt; }
  header .firm { font-size: 9pt; color: #444; }
  header .firm b { font-size: 11pt; color: #111; }
  h1 { font-size: 16pt; margin: 0 0 2pt; }
  .status { font-size: 9pt; color: #444; text-align: right; }
  .status b { color: ${paidAt ? '#0a7a3d' : '#a15c00'}; }
  h2 { font-size: 10.5pt; margin: 16pt 0 4pt; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th { text-align: left; font-weight: 600; border-bottom: 0.75pt solid #111; padding: 3pt 4pt; }
  td { border-bottom: 0.5pt solid #ddd; padding: 3pt 4pt; vertical-align: top; }
  tfoot td { border-top: 0.75pt solid #111; border-bottom: none; font-weight: 600; }
  .r { text-align: right; white-space: nowrap; }
  .muted { color: #666; }
  .summary { margin-top: 20pt; width: 55%; margin-left: auto; }
  .summary td { border-bottom: 0.5pt solid #ddd; }
  .summary tr.total td { border-top: 1.5pt solid #111; border-bottom: none; font-weight: 700; font-size: 10.5pt; }
  .qr { display: flex; gap: 18pt; margin-top: 24pt; padding-top: 14pt; border-top: 0.75pt dashed #999; page-break-inside: avoid; font-size: 9pt; }
  .qr h2 { margin-top: 0; }
  .qr .lbl { font-size: 7.5pt; font-weight: 600; color: #555; margin-top: 6pt; }
  footer { margin-top: 28pt; font-size: 8pt; color: #888; }
</style></head><body>
<header>
  <div>
    <h1>Spesenabrechnung ${monthLabel(ym)}</h1>
    <div class="firm">${[
      company.name && `<b>${h(company.name)}</b>`,
      [company.address.street, [company.address.zip, company.address.city].filter(Boolean).join(' ')].filter(Boolean).map(h).join(', '),
      company.uid && `UID ${h(company.uid)}`,
    ].filter(Boolean).join('<br>')}</div>
  </div>
  <div class="status">Status: <b>${paidAt ? `ausbezahlt am ${fmtDate(paidAt)}` : 'offen'}</b></div>
</header>
${table('Fahrten Auto', ['Datum', 'Von', 'Nach', 'Zweck', 'Kunde', 'km', 'CHF'],
  of('auto').map(e => [fmtDate(e.date), h(e.from ?? ''), h(e.to ?? ''), h(e.purpose), cn(e), `${e.km ?? 0}`, money(expenseAmount(e))]),
  s.auto, ` <span class="muted">(${s.km} km à CHF ${autoRates.map(r => money(r)).join(' / ')})</span>`)}
${table('Bahn / ÖV', ['Datum', 'Strecke', 'Zweck', 'Kunde', 'Beleg', 'CHF'],
  of('bahn').map(e => [fmtDate(e.date), h(e.route ?? ''), h(e.purpose), cn(e), h(receiptText(e)), money(expenseAmount(e))]),
  s.bahn)}
${table('Übrige Spesen', ['Datum', 'Art', 'Zweck', 'Kunde', 'Beleg', 'CHF'],
  of('other').map(e => [fmtDate(e.date), h(e.art ?? ''), h(e.purpose), cn(e), h(receiptText(e)), money(expenseAmount(e))]),
  s.other)}
${list.length === 0 ? '<p class="muted">Keine Einzelspesen in diesem Monat.</p>' : ''}
<table class="summary">
  <tr><td>Fahrten Auto</td><td class="r">${money(s.auto)}</td></tr>
  <tr><td>Bahn / ÖV</td><td class="r">${money(s.bahn)}</td></tr>
  <tr><td>Übrige Spesen</td><td class="r">${money(s.other)}</td></tr>
  <tr><td>Pauschalspesen</td><td class="r">${money(s.allowance)}</td></tr>
  <tr class="total"><td>Total Auszahlung CHF</td><td class="r">${money(s.total)}</td></tr>
</table>
${(() => {
  const qr = payoutQr(company, s.total, payoutMessage(company, ym));
  if (!qr.ok || paidAt) return '';
  return `<section class="qr">
    <div>${qr.svg.replace(/width="\d+" height="\d+"/, 'width="130pt" height="130pt"')}</div>
    <div>
      <h2>Zahlung (QR-Code für das E-Banking)</h2>
      <div class="lbl">Konto / Zahlbar an</div>
      <div>${h(qr.iban)}<br>${h(qr.creditor.name)}<br>${h(qr.creditor.street)}<br>${h(qr.creditor.zip)} ${h(qr.creditor.city)}</div>
      <div class="lbl">Betrag</div><div><b>CHF ${money(s.total)}</b></div>
      <div class="lbl">Zusätzliche Informationen</div><div>${h(payoutMessage(company, ym))}</div>
    </div>
  </section>`;
})()}
<footer>Erstellt am ${new Date().toLocaleDateString('de-CH')} mit Z9nAI Hours</footer>
</body></html>`;

  // Print through a hidden iframe; the document title becomes the PDF file name
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  const prevTitle = document.title;
  document.title = doc.title;
  setTimeout(() => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    document.title = prevTitle;
    setTimeout(() => frame.remove(), 1000);
  }, 100);
}
