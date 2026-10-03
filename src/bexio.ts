// bexio API via the local proxy (scripts/bexio-proxy.mjs). bexio does not allow
// browser calls from other origins, and the proxy keeps the token out of the app.
import { BexioAccounts, Company } from './types';
import { DEFAULT_BEXIO_ACCOUNTS, ExpenseMonthSum, round2 } from './expenses';
import { monthLabel } from './expenseExport';

const LS_KEY = 'z9nai-hours-bexio';
export const DEFAULT_PROXY_URL = 'http://localhost:8787';

export function loadProxyUrl(): string {
  try { return localStorage.getItem(LS_KEY) || DEFAULT_PROXY_URL; } catch { return DEFAULT_PROXY_URL; }
}
export function saveProxyUrl(url: string) {
  try { localStorage.setItem(LS_KEY, url.trim() || DEFAULT_PROXY_URL); } catch { /* storage unavailable */ }
}

export class BexioError extends Error {}

const base = () => loadProxyUrl().replace(/\/+$/, '');

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}/bexio${path}`, init);
  } catch {
    throw new BexioError(`bexio-Proxy nicht erreichbar (${base()}). Läuft "npm run bexio-proxy"?`);
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const b = body as { message?: string; error?: string; errors?: unknown } | null;
    const detail = b?.message || b?.error || (b?.errors ? JSON.stringify(b.errors) : text.slice(0, 200));
    throw new BexioError(`bexio ${res.status}: ${detail}`);
  }
  return body as T;
}

export async function proxyHealth(): Promise<{ ok: boolean; tokenConfigured: boolean }> {
  try {
    const res = await fetch(`${base()}/health`);
    return await res.json();
  } catch {
    throw new BexioError(`bexio-Proxy nicht erreichbar (${base()}). Läuft "npm run bexio-proxy"?`);
  }
}

interface Account { id: number; account_no: string; name: string; is_active: boolean }

export async function loadAccounts(): Promise<Map<string, Account>> {
  const list = await call<Account[]>('/2.0/accounts?limit=2000');
  return new Map(list.map(a => [String(a.account_no), a]));
}

async function chfId(): Promise<number> {
  const list = await call<{ id: number; name: string }[]>('/3.0/currencies');
  const chf = list.find(c => c.name === 'CHF');
  if (!chf) throw new BexioError('Währung CHF in bexio nicht gefunden');
  return chf.id;
}

export const bexioAccounts = (company: Company): BexioAccounts => ({ ...DEFAULT_BEXIO_ACCOUNTS, ...company.bexio });

const lastDayOf = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

export interface BookingLine { account: string; amount: number; text: string }

// Debit lines per account (kinds sharing an account are merged), one credit line
export function bookingPlan(sum: ExpenseMonthSum, accounts: BexioAccounts) {
  const label = monthLabel(sum.ym);
  const parts: { account: string; amount: number; what: string }[] = [
    { account: accounts.auto, amount: sum.auto, what: `Auto ${sum.km} km` },
    { account: accounts.bahn, amount: sum.bahn, what: 'Bahn/ÖV' },
    { account: accounts.other, amount: sum.other, what: 'Übrige' },
    { account: accounts.allowance, amount: sum.allowance, what: 'Pauschale' },
  ].filter(p => p.amount > 0);
  const byAccount = new Map<string, { amount: number; what: string[] }>();
  for (const p of parts) {
    const cur = byAccount.get(p.account) ?? { amount: 0, what: [] };
    byAccount.set(p.account, { amount: round2(cur.amount + p.amount), what: [...cur.what, p.what] });
  }
  const debits: BookingLine[] = [...byAccount].map(([account, v]) => ({
    account, amount: v.amount, text: `Spesen ${label} (${v.what.join(', ')})`,
  }));
  return {
    date: lastDayOf(sum.ym),
    description: `Spesen ${label} gemäss Spesenaufstellung`,
    debits,
    credit: { account: accounts.credit, amount: sum.total, text: `Spesen ${label} gemäss Spesenaufstellung` } as BookingLine,
  };
}

function accountId(accounts: Map<string, Account>, no: string, role: string): number {
  const a = accounts.get(no.trim());
  if (!a) throw new BexioError(`Konto ${no} (${role}) gibt es in bexio nicht`);
  if (!a.is_active) throw new BexioError(`Konto ${no} (${role}) ist in bexio inaktiv`);
  return a.id;
}

interface CreatedEntry { id: number; reference_nr?: string; entries: { id: number }[] }

async function nextRefNr(): Promise<string | undefined> {
  try { return (await call<{ next_ref_nr?: string }>('/3.0/accounting/manual_entries/next_ref_nr')).next_ref_nr; }
  catch { return undefined; } // bexio assigns one itself
}

async function upload(path: string, file: { name: string; blob: Blob }) {
  const fd = new FormData();
  fd.append('fileName', file.blob, file.name);
  await call(path, { method: 'POST', body: fd });
}

export interface BookResult { entryId: number; refNr?: string; uploaded: number; failed: string[] }

// Creates the expense booking and attaches the files (one request per file)
export async function bookExpenses(sum: ExpenseMonthSum, company: Company,
  files: { name: string; blob: Blob }[], onStep: (msg: string) => void): Promise<BookResult> {
  const plan = bookingPlan(sum, bexioAccounts(company));
  if (plan.debits.length === 0) throw new BexioError('Nichts zu buchen');
  onStep('Konten und Währung laden…');
  const [accounts, currency, refNr] = await Promise.all([loadAccounts(), chfId(), nextRefNr()]);
  const creditId = accountId(accounts, plan.credit.account, 'Haben');
  const line = { currency_id: currency, currency_factor: 1 };

  onStep('Buchung erstellen…');
  const single = plan.debits.length === 1;
  const body = single
    ? {
      type: 'manual_single_entry', date: plan.date, ...(refNr ? { reference_nr: refNr } : {}),
      entries: [{ ...line, debit_account_id: accountId(accounts, plan.debits[0].account, 'Soll'), credit_account_id: creditId,
        amount: plan.credit.amount, description: plan.description }],
    }
    : {
      type: 'manual_compound_entry', date: plan.date, ...(refNr ? { reference_nr: refNr } : {}),
      entries: [
        ...plan.debits.map(d => ({ ...line, debit_account_id: accountId(accounts, d.account, 'Soll'), amount: d.amount, description: d.text })),
        { ...line, credit_account_id: creditId, amount: plan.credit.amount, description: plan.description },
      ],
    };
  const created = await call<CreatedEntry>('/3.0/accounting/manual_entries', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  const filePath = single && created.entries?.[0]
    ? `/3.0/accounting/manual_entries/${created.id}/entries/${created.entries[0].id}/files`
    : `/3.0/accounting/manual_entries/${created.id}/files`;
  const failed: string[] = [];
  let uploaded = 0;
  for (const [i, f] of files.entries()) {
    onStep(`Beleg ${i + 1}/${files.length} hochladen: ${f.name}`);
    try { await upload(filePath, f); uploaded++; }
    catch (e) { failed.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return { entryId: created.id, refNr: created.reference_nr ?? refNr, uploaded, failed };
}

// Transfer to the private account: debit liability, credit bank
export async function bookTransfer(ym: string, amount: number, date: string, company: Company): Promise<number> {
  const acc = bexioAccounts(company);
  if (!acc.bank) throw new BexioError('Kein Bankkonto für den Transfer hinterlegt');
  const [accounts, currency, refNr] = await Promise.all([loadAccounts(), chfId(), nextRefNr()]);
  const created = await call<CreatedEntry>('/3.0/accounting/manual_entries', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'manual_single_entry', date, ...(refNr ? { reference_nr: refNr } : {}),
      entries: [{
        debit_account_id: accountId(accounts, acc.credit, 'Spesen-Verbindlichkeit'),
        credit_account_id: accountId(accounts, acc.bank, 'Bank'),
        amount, description: `Spesen-Transfer ${monthLabel(ym)}`, currency_id: currency, currency_factor: 1,
      }],
    }),
  });
  return created.id;
}

// Check that all configured accounts exist (used by the settings "Testen" button)
export async function checkSetup(company: Company): Promise<string> {
  const h = await proxyHealth();
  if (!h.tokenConfigured) throw new BexioError('Proxy läuft, aber es ist kein bexio-Token hinterlegt');
  const accounts = await loadAccounts();
  const acc = bexioAccounts(company);
  const roles: [string, string | undefined][] = [
    ['Auto', acc.auto], ['Bahn', acc.bahn], ['Übrige', acc.other], ['Pauschale', acc.allowance], ['Haben', acc.credit], ['Bank', acc.bank],
  ];
  const names = roles.filter(([, no]) => no).map(([role, no]) => {
    accountId(accounts, no!, role);
    return `${no} ${accounts.get(no!.trim())!.name}`;
  });
  return `Verbunden – ${[...new Set(names)].join(' · ')}`;
}
