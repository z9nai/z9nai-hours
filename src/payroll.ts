import { PayrollData, PayrollMonth, PayrollRates } from './types';

export const DEFAULT_RATES: PayrollRates = {
  ahv: 5.3, alv: 1.1, nbu: 1.725, ktg: 0,
  bvgSalary: 0, bvgCoordination: 26460, bvgEmployee: 12.5, bvgEmployer: 12.5,
  agAhv: 5.3, agAlv: 1.1, fak: 0, vk: 0, bu: 0, agKtg: 0,
  alvCeiling: 148200, childAllowance: 280,
};

export const EMPTY_PAYROLL: PayrollData = { employee: { name: '', ahvNr: '' }, rates: {}, months: {} };

const round2 = (n: number) => Math.round(n * 100) / 100;
const round05 = (n: number) => Math.round(n * 20) / 20; // Swiss 5 Rappen
const round10 = (n: number) => Math.round(n * 10) / 10;

// Rates of a year; falls back to the latest earlier year, then to the defaults
export function ratesFor(data: PayrollData, year: number): PayrollRates {
  if (data.rates[year]) return { ...DEFAULT_RATES, ...data.rates[year] };
  const earlier = Object.keys(data.rates).map(Number).filter(y => y < year).sort((a, b) => b - a)[0];
  return { ...DEFAULT_RATES, ...(earlier ? data.rates[earlier] : {}) };
}

// BVG contribution per month (rounded to 10 Rappen like the policy table)
export function bvgMonthly(r: PayrollRates) {
  const insured = Math.max(0, r.bvgSalary - r.bvgCoordination);
  return { insured, employee: round10(insured * r.bvgEmployee / 100 / 12), employer: round10(insured * r.bvgEmployer / 100 / 12) };
}

export interface PayrollCalc {
  ym: string;
  gross: number;
  bonus: number;
  base: number;        // AHV salary
  capped: number;      // ALV/UVG salary (monthly share of the annual maximum)
  ahv: number; alv: number; nbu: number; ktg: number; bvg: number;
  deductions: number;
  allowance: number;   // Kinderzulagen
  withholdingTax: number;
  net: number;         // Nettolohn incl. allowances
  advance: number;
  payout: number;      // to transfer
  // employer
  agAhv: number; agAlv: number; fak: number; vk: number; bu: number; agKtg: number; agBvg: number;
  employer: number;    // total employer contributions
  cost: number;        // gross + employer contributions
}

export function calcMonth(data: PayrollData, ym: string, m: PayrollMonth | undefined = data.months[ym]): PayrollCalc {
  const r = ratesFor(data, Number(ym.slice(0, 4)));
  const gross = m?.gross ?? 0, bonus = m?.bonus ?? 0;
  const base = gross + bonus;
  const capped = Math.min(base, r.alvCeiling / 12);
  const pct = (amount: number, rate: number) => round05(amount * rate / 100);
  const bvg = base > 0 ? bvgMonthly(r) : { employee: 0, employer: 0 };

  const ahv = pct(base, r.ahv), alv = pct(capped, r.alv), nbu = pct(capped, r.nbu), ktg = pct(base, r.ktg);
  const deductions = round2(ahv + alv + nbu + ktg + bvg.employee);
  const allowance = round2((m?.children ?? 0) * r.childAllowance);
  const withholdingTax = m?.withholdingTax ?? 0;
  const net = round2(base - deductions + allowance - withholdingTax);
  const advance = m?.advance ?? 0;

  const agAhv = pct(base, r.agAhv), agAlv = pct(capped, r.agAlv), fak = pct(base, r.fak);
  const vk = round05((ahv + agAhv) * r.vk / 100), bu = pct(capped, r.bu), agKtg = pct(base, r.agKtg);
  const employer = round2(agAhv + agAlv + fak + vk + bu + agKtg + bvg.employer);

  return {
    ym, gross, bonus, base, capped, ahv, alv, nbu, ktg, bvg: bvg.employee, deductions, allowance, withholdingTax,
    net, advance, payout: round2(net - advance),
    agAhv, agAlv, fak, vk, bu, agKtg, agBvg: bvg.employer, employer, cost: round2(base + employer),
  };
}

const NUM_KEYS = ['gross', 'bonus', 'base', 'ahv', 'alv', 'nbu', 'ktg', 'bvg', 'deductions', 'allowance', 'withholdingTax',
  'net', 'advance', 'payout', 'agAhv', 'agAlv', 'fak', 'vk', 'bu', 'agKtg', 'agBvg', 'employer', 'cost'] as const;
export type PayrollSum = Record<(typeof NUM_KEYS)[number], number>;

export function sumCalcs(list: PayrollCalc[]): PayrollSum {
  const s = Object.fromEntries(NUM_KEYS.map(k => [k, 0])) as PayrollSum;
  for (const c of list) for (const k of NUM_KEYS) s[k] = round2(s[k] + c[k]);
  return s;
}

export const isPayrollPaid = (data: PayrollData, ym: string) => !!data.months[ym]?.paidAt;
