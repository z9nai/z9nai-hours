import { Company, Expense, ExpenseData, ExpenseKind } from './types';

export const DEFAULT_KM_RATE = 0.75;

export const EXPENSE_KINDS: Record<ExpenseKind, { label: string; short: string }> = {
  auto:  { label: 'Fahrt Auto', short: 'Auto' },
  bahn:  { label: 'Bahn / ÖV',  short: 'Bahn' },
  other: { label: 'Übrige',     short: 'Übrige' },
};
export const EXPENSE_KIND_ORDER: ExpenseKind[] = ['auto', 'bahn', 'other'];

export const OTHER_ARTS = ['Verpflegung Mittag', 'Verpflegung Abend', 'Übernachtung', 'Parking', 'Sonstiges'];

export const EMPTY_EXPENSE_DATA: ExpenseData = { expenses: [], months: {} };

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const fmtChf = (n: number) =>
  n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const ymOf = (iso: string) => iso.slice(0, 7);

export function expenseAmount(e: Expense): number {
  return e.kind === 'auto' ? round2((e.km ?? 0) * (e.rate ?? DEFAULT_KM_RATE)) : e.amount ?? 0;
}

export const hasReceipt = (e: Expense) => (e.receipts?.length ?? 0) > 0 || !!e.receiptFiled;

export const isPaid = (data: ExpenseData, ym: string) => !!data.months[ym]?.paidAt;

// Paid months keep the allowance they were paid with; open months follow the company setting
export function allowanceFor(data: ExpenseData, company: Company, ym: string): number {
  const snap = data.months[ym]?.allowance;
  if (snap != null) return snap;
  const from = company.expenseAllowanceFrom;
  return company.expenseAllowance && from && ym >= from ? company.expenseAllowance : 0;
}

export interface ExpenseMonthSum {
  ym: string;
  km: number;
  auto: number;
  bahn: number;
  other: number;
  allowance: number;
  total: number;
  count: number;
}

export function monthSum(data: ExpenseData, company: Company, ym: string): ExpenseMonthSum {
  const s = { ym, km: 0, auto: 0, bahn: 0, other: 0, allowance: allowanceFor(data, company, ym), total: 0, count: 0 };
  for (const e of data.expenses) {
    if (ymOf(e.date) !== ym) continue;
    s.count++;
    if (e.kind === 'auto') s.km += e.km ?? 0;
    s[e.kind] = round2(s[e.kind] + expenseAmount(e));
  }
  s.total = round2(s.auto + s.bahn + s.other + s.allowance);
  return s;
}

// Short description of where/what an expense was
export function expenseTitle(e: Expense): string {
  if (e.kind === 'auto') return [e.from, e.to].filter(Boolean).join(' → ') || 'Fahrt';
  if (e.kind === 'bahn') return e.route || 'Bahn';
  return e.art || 'Übrige';
}

export const sortExpenses = (list: Expense[]) =>
  [...list].sort((a, b) => a.date.localeCompare(b.date)
    || EXPENSE_KIND_ORDER.indexOf(a.kind) - EXPENSE_KIND_ORDER.indexOf(b.kind));
