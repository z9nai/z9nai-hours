// bexio API via the local proxy (scripts/bexio-proxy.mjs). bexio does not allow
// browser calls from other origins, and the proxy keeps the token out of the app.
import { BexioAccounts, Company } from './types';
import { DEFAULT_BEXIO_ACCOUNTS, ExpenseMonthSum } from './expenses';
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

export interface ProxyHealth {
  ok: boolean;
  mode?: 'pat' | 'oauth' | null;
  oauthConfigured?: boolean;
  tokenConfigured: boolean;     // a usable token is available
  tokenExpires?: string | null; // personal access tokens only
  scopes?: string[];            // granted OAuth scopes
  error?: string | null;
}

// Opens the bexio login (OAuth) through the proxy in a new tab
export const connectUrl = () => `${base()}/oauth/start`;

// Days until the token expires (negative: expired); null if unknown
export function tokenDaysLeft(h: ProxyHealth): number | null {
  return h.tokenExpires ? Math.floor((Date.parse(h.tokenExpires) - Date.now()) / 86_400_000) : null;
}

const fmtExpiry = (iso: string) => new Date(iso).toLocaleDateString('de-CH');

// Problem with the token that blocks booking, or null if it can be used
export function tokenProblem(h: ProxyHealth): string | null {
  if (h.error) return h.error;
  if (!h.tokenConfigured) {
    return h.oauthConfigured
      ? 'Noch nicht mit bexio verbunden – unter Admin «Mit bexio verbinden» klicken.'
      : 'Kein bexio-Zugang eingerichtet – im App-Verzeichnis «npm run bexio-proxy:setup» ausführen.';
  }
  const days = tokenDaysLeft(h);
  if (days != null && days < 0) return `Der bexio-Token ist am ${fmtExpiry(h.tokenExpires!)} abgelaufen – auf developer.bexio.com/pat einen neuen erstellen.`;
  return null;
}

export async function proxyHealth(): Promise<ProxyHealth> {
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

// One booking per month: debit expense account, credit liability towards the payee
export function bookingPlan(sum: ExpenseMonthSum, accounts: BexioAccounts) {
  return {
    date: lastDayOf(sum.ym),
    description: `Spesen ${monthLabel(sum.ym)} gemäss Spesenaufstellung`,
    debit: accounts.expense,
    credit: accounts.credit,
    amount: sum.total,
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

export interface UploadFile { name: string; blob: Blob }

// Uploads one file per request; returns the names that failed (with reason)
export async function uploadFiles(path: string, files: UploadFile[], onStep: (msg: string) => void) {
  const failed: { name: string; reason: string }[] = [];
  for (const [i, f] of files.entries()) {
    onStep(`Beleg ${i + 1}/${files.length} hochladen: ${f.name}`);
    try { await upload(path, f); }
    catch (e) { failed.push({ name: f.name, reason: e instanceof Error ? e.message : String(e) }); }
  }
  return failed;
}

// Bookings made before the attach path was stored: look the entry up in bexio
export async function findFilesPath(entryId: number): Promise<string> {
  for (let offset = 0; offset < 10_000; offset += 500) {
    const list = await call<CreatedEntry[]>(`/3.0/accounting/manual_entries?limit=500&offset=${offset}`);
    const e = list.find(x => x.id === entryId);
    if (e) {
      return e.entries?.length === 1
        ? `/3.0/accounting/manual_entries/${e.id}/entries/${e.entries[0].id}/files`
        : `/3.0/accounting/manual_entries/${e.id}/files`;
    }
    if (list.length < 500) break;
  }
  throw new BexioError(`Buchung ${entryId} in bexio nicht gefunden (gelöscht?)`);
}

export interface BookResult { entryId: number; refNr?: string; filesPath: string; failed: { name: string; reason: string }[] }

// Creates the expense booking and attaches the files (one request per file)
export async function bookExpenses(sum: ExpenseMonthSum, company: Company,
  files: UploadFile[], onStep: (msg: string) => void): Promise<BookResult> {
  const plan = bookingPlan(sum, bexioAccounts(company));
  if (!(plan.amount > 0)) throw new BexioError('Nichts zu buchen');
  onStep('Konten und Währung laden…');
  const [accounts, currency, refNr] = await Promise.all([loadAccounts(), chfId(), nextRefNr()]);

  onStep('Buchung erstellen…');
  const created = await call<CreatedEntry>('/3.0/accounting/manual_entries', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'manual_single_entry', date: plan.date, ...(refNr ? { reference_nr: refNr } : {}),
      entries: [{
        debit_account_id: accountId(accounts, plan.debit, 'Soll'), credit_account_id: accountId(accounts, plan.credit, 'Haben'),
        amount: plan.amount, description: plan.description, currency_id: currency, currency_factor: 1,
      }],
    }),
  });

  const filePath = created.entries?.[0]
    ? `/3.0/accounting/manual_entries/${created.id}/entries/${created.entries[0].id}/files`
    : `/3.0/accounting/manual_entries/${created.id}/files`;
  const failed = await uploadFiles(filePath, files, onStep);
  return { entryId: created.id, refNr: created.reference_nr ?? refNr, filesPath: filePath, failed };
}

// Check that all configured accounts exist (used by the settings "Testen" button)
export async function checkSetup(company: Company): Promise<string> {
  const h = await proxyHealth();
  const problem = tokenProblem(h);
  if (problem) throw new BexioError(problem);
  const accounts = await loadAccounts();
  const acc = bexioAccounts(company);
  const roles: [string, string | undefined][] = [['Soll', acc.expense], ['Haben', acc.credit]];
  const names = roles.filter(([, no]) => no).map(([role, no]) => {
    accountId(accounts, no!, role);
    return `${no} ${accounts.get(no!.trim())!.name}`;
  });
  const expiry = h.tokenExpires ? ` · Token gültig bis ${fmtExpiry(h.tokenExpires)}` : '';
  if (h.scopes && !h.scopes.includes('file')) {
    throw new BexioError('Verbunden, aber ohne Berechtigung «file» – Belege können nicht angehängt werden. Bitte erneut «Mit bexio verbinden».');
  }
  return `Verbunden – ${[...new Set(names)].join(' · ')}${expiry}`;
}
