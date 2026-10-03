// Monthly expense statement as a real PDF file (attached to the bexio booking).
import { jsPDF } from 'jspdf';
import { Client, Company, Expense, ExpenseData } from './types';
import { DEFAULT_KM_RATE, expenseAmount, fmtChf, monthSum, ymOf } from './expenses';
import { monthLabel } from './expenseExport';

const fmtDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const baseName = (p: string) => p.split('/').pop() ?? p;

interface Col { title: string; width: number; right?: boolean }

export function buildMonthPdf(data: ExpenseData, company: Company, clients: Client[], ym: string): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const L = 16, R = 194, W = R - L, BOTTOM = 280;
  let y = 20;

  const list = data.expenses.filter(e => ymOf(e.date) === ym);
  const s = monthSum(data, company, ym);
  const paidAt = data.months[ym]?.paidAt;
  const clientName = (e: Expense) => e.clientId ? clients.find(c => c.id === e.clientId)?.name ?? '' : '';
  const receipt = (e: Expense) => e.receipts?.length ? e.receipts.map(baseName).join(', ') : e.receiptFiled ? 'abgelegt' : '–';

  const fit = (text: string, width: number) => {
    if (doc.getTextWidth(text) <= width) return text;
    let t = text;
    while (t.length > 1 && doc.getTextWidth(t + '…') > width) t = t.slice(0, -1);
    return t + '…';
  };
  const newPageIfNeeded = (need: number) => {
    if (y + need <= BOTTOM) return;
    doc.addPage();
    y = 20;
  };

  // Header
  doc.setFont('helvetica', 'bold').setFontSize(16).text(`Spesenabrechnung ${monthLabel(ym)}`, L, y);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(80);
  doc.text(`Status: ${paidAt ? `ausbezahlt am ${fmtDate(paidAt)}` : 'offen'}`, R, y, { align: 'right' });
  y += 6;
  const firm = [
    company.name,
    [company.address.street, [company.address.zip, company.address.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    company.uid && `UID ${company.uid}`,
  ].filter(Boolean) as string[];
  firm.forEach(line => { doc.text(line, L, y); y += 4; });
  doc.setTextColor(0).setDrawColor(0).setLineWidth(0.5).line(L, y, R, y);
  y += 8;

  const table = (title: string, cols: Col[], rows: string[][], total: number, note = '') => {
    if (rows.length === 0) return;
    newPageIfNeeded(20);
    doc.setFont('helvetica', 'bold').setFontSize(10.5).text(title, L, y);
    y += 5;
    const xs: number[] = [];
    cols.reduce((x, c) => { xs.push(x); return x + c.width * W; }, L);
    const cell = (text: string, i: number) => {
      const c = cols[i], w = c.width * W - 2;
      const t = fit(text, w);
      if (c.right) doc.text(t, xs[i] + c.width * W - 1, y, { align: 'right' });
      else doc.text(t, xs[i] + 1, y);
    };
    doc.setFontSize(8.5);
    cols.forEach((c, i) => cell(c.title, i));
    y += 1.5;
    doc.setLineWidth(0.3).line(L, y, R, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    for (const r of rows) {
      newPageIfNeeded(6);
      r.forEach((v, i) => cell(v, i));
      y += 1.5;
      doc.setDrawColor(210).setLineWidth(0.15).line(L, y, R, y).setDrawColor(0);
      y += 4;
    }
    doc.setLineWidth(0.3).line(L, y - 4, R, y - 4);
    doc.setFont('helvetica', 'bold').text(`Total${note}`, L + 1, y);
    doc.text(fmtChf(total), R - 1, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    y += 9;
  };

  const of = (k: Expense['kind']) => list.filter(e => e.kind === k);
  const rates = [...new Set(of('auto').map(e => e.rate ?? DEFAULT_KM_RATE))].map(fmtChf).join(' / ');
  table('Fahrten Auto',
    [{ title: 'Datum', width: 0.12 }, { title: 'Von', width: 0.14 }, { title: 'Nach', width: 0.14 }, { title: 'Zweck', width: 0.28 },
      { title: 'Kunde', width: 0.16 }, { title: 'km', width: 0.07, right: true }, { title: 'CHF', width: 0.09, right: true }],
    of('auto').map(e => [fmtDate(e.date), e.from ?? '', e.to ?? '', e.purpose, clientName(e), String(e.km ?? 0), fmtChf(expenseAmount(e))]),
    s.auto, ` (${s.km} km à CHF ${rates})`);
  table('Bahn / ÖV',
    [{ title: 'Datum', width: 0.12 }, { title: 'Strecke', width: 0.18 }, { title: 'Zweck', width: 0.28 }, { title: 'Kunde', width: 0.16 },
      { title: 'Beleg', width: 0.17 }, { title: 'CHF', width: 0.09, right: true }],
    of('bahn').map(e => [fmtDate(e.date), e.route ?? '', e.purpose, clientName(e), receipt(e), fmtChf(expenseAmount(e))]),
    s.bahn);
  table('Übrige Spesen',
    [{ title: 'Datum', width: 0.12 }, { title: 'Art', width: 0.18 }, { title: 'Zweck', width: 0.28 }, { title: 'Kunde', width: 0.16 },
      { title: 'Beleg', width: 0.17 }, { title: 'CHF', width: 0.09, right: true }],
    of('other').map(e => [fmtDate(e.date), e.art ?? '', e.purpose, clientName(e), receipt(e), fmtChf(expenseAmount(e))]),
    s.other);

  // Summary
  newPageIfNeeded(40);
  y += 2;
  const sx = L + W * 0.45;
  doc.setFontSize(9);
  ([['Fahrten Auto', s.auto], ['Bahn / ÖV', s.bahn], ['Übrige Spesen', s.other], ['Pauschalspesen', s.allowance]] as const)
    .forEach(([label, v]) => {
      doc.text(label, sx, y);
      doc.text(fmtChf(v), R - 1, y, { align: 'right' });
      y += 1.5;
      doc.setDrawColor(210).setLineWidth(0.15).line(sx, y, R, y).setDrawColor(0);
      y += 4.5;
    });
  doc.setLineWidth(0.5).line(sx, y - 3, R, y - 3);
  y += 1.5;
  doc.setFont('helvetica', 'bold').setFontSize(10.5).text('Total Auszahlung CHF', sx, y);
  doc.text(fmtChf(s.total), R - 1, y, { align: 'right' });

  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(130);
  doc.text(`Erstellt am ${new Date().toLocaleDateString('de-CH')} mit Z9nAI Hours`, L, 287);
  return doc.output('blob');
}
