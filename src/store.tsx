import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Absence, Client, Company, MonthData, TimeEntry } from './types';
import { DayAbsences, toDayAbsences } from './absences';
import { GitConfig, commitFiles, loadGitConfig, saveGitConfig } from './git';

export interface GitStatus {
  busy: boolean;
  pending: string[];        // files waiting to be committed
  lastCommitAt?: string;
  lastSha?: string;
  lastMessage?: string;
  error?: string;
}

const DEFAULT_COMPANY: Company = {
  name: '', uid: '', iban: '',
  address: { street: '', zip: '', city: '', country: 'CH' },
  email: '', phone: '',
};

interface StoreCtx {
  company: Company;
  clients: Client[];
  entries: TimeEntry[];
  projects: Record<string, string[]>; // clientId → projects, most recently used first
  extras: Record<string, string[]>;   // clientId → extra-field values, most recently used first
  absences: Record<string, DayAbsences>; // ISO date → Ferien / Krank / Feiertag (one full day or up to two halves)
  dirHandle: FileSystemDirectoryHandle | null;
  savedHandleAvailable: boolean;
  isDark: boolean;
  currentMonth: YM;
  ioError: string | null;
  setCompany: (c: Company) => void;
  setClients: (c: Client[]) => void;
  addEntry: (e: TimeEntry) => void;
  updateEntry: (e: TimeEntry) => void;
  deleteEntry: (id: string) => void;
  touchProject: (clientId: string, project: string) => void;
  touchExtra: (clientId: string, value: string) => void;
  setAbsence: (date: string, absences: DayAbsences | null) => void;
  pickDirectory: () => Promise<void>;
  reconnectDirectory: () => Promise<void>;
  toggleTheme: () => void;
  showMonths: (months: YM[], primary: YM) => void;
  readMonthEntries: (year: number, month: number) => Promise<TimeEntry[]>;
  gitConfig: GitConfig;
  setGitConfig: (c: GitConfig) => void;
  gitStatus: GitStatus;
  commitNow: () => Promise<void>;
  commitAllData: () => Promise<void>;
}

const GIT_COMMIT_DELAY_MS = 10_000; // collect changes, then one commit
const DATA_FILE = /^(hours-\d{4}-\d{2}|clients|company|projects|extras|absences)\.json$/;

type YM = { year: number; month: number };

const MAX_PROJECTS = 30;
const MAX_BACKUPS_PER_MONTH = 30;
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // at most one backup per month file and hour

const Ctx = createContext<StoreCtx>(null!);
export const useStore = () => useContext(Ctx);

const monthKey = (y: number, m: number) => `hours-${y}-${String(m).padStart(2, '0')}.json`;
const ymKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
const ymKeyOfDate = (iso: string) => iso.slice(0, 7);
const parseYm = (k: string): YM => ({ year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)) });

const isNotFound = (e: unknown) => (e as { name?: string } | null)?.name === 'NotFoundError';

// Strict month reader: a missing file is an empty month, but any other problem
// (unreadable, corrupt JSON) throws — the caller must then NOT treat the month
// as empty, or a later save would wipe the file.
async function readMonthStrict(dir: FileSystemDirectoryHandle, y: number, m: number): Promise<TimeEntry[]> {
  let fh: FileSystemFileHandle;
  try {
    fh = await dir.getFileHandle(monthKey(y, m));
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
  const text = await (await fh.getFile()).text();
  if (!text.trim()) return [];
  const md = JSON.parse(text) as MonthData;
  if (!Array.isArray(md.entries)) throw new Error('Datei hat kein gültiges "entries"-Feld');
  return md.entries;
}

// Copy the current on-disk month file to backup/hours-YYYY-MM.<timestamp>.json
// and keep only the newest MAX_BACKUPS_PER_MONTH copies per month.
async function backupMonthFile(dir: FileSystemDirectoryHandle, k: string) {
  const { year, month } = parseYm(k);
  const name = monthKey(year, month);
  let text: string;
  try {
    text = await (await (await dir.getFileHandle(name)).getFile()).text();
  } catch (e) {
    if (isNotFound(e)) return; // nothing to back up yet
    throw e;
  }
  if (!text.trim()) return;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  const prefix = name.replace(/\.json$/, '.');
  const backupDir = await dir.getDirectoryHandle('backup', { create: true });
  const w = await (await backupDir.getFileHandle(`${prefix}${stamp}.json`, { create: true })).createWritable();
  await w.write(text);
  await w.close();
  const existing: string[] = [];
  for await (const n of backupDir.keys()) if (n.startsWith(prefix)) existing.push(n);
  existing.sort(); // timestamps sort chronologically
  for (const old of existing.slice(0, Math.max(0, existing.length - MAX_BACKUPS_PER_MONTH))) {
    await backupDir.removeEntry(old);
  }
}

// ── IndexedDB: persist FileSystemDirectoryHandle across sessions ───────────
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('z9nai-hours', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persistHandle(handle: FileSystemDirectoryHandle) {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'dir');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[hours] persistHandle failed:', e);
  }
}

async function restoreHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get('dir');
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    if (!handle) return null;
    // Check if permission is still granted (no user gesture required)
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    return perm === 'granted' ? handle : null;
  } catch {
    return null;
  }
}

// ── JSON helpers ────────────────────────────────────────────────────────────
async function readJson<T>(dir: FileSystemDirectoryHandle, name: string, fallback: T): Promise<T> {
  try {
    const fh = await dir.getFileHandle(name);
    const file = await fh.getFile();
    return JSON.parse(await file.text()) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(dir: FileSystemDirectoryHandle, name: string, data: unknown) {
  try {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(data, null, 2));
    await w.close();
  } catch (e) {
    console.error(`[hours] writeJson failed for ${name}:`, e);
    throw e;
  }
}

// One-time migration: build the per-client MRU project list from all existing
// month files (hours-YYYY-MM.json). Entries are processed chronologically so
// the most recently used project ends up first.
async function buildProjectsFromHistory(dir: FileSystemDirectoryHandle): Promise<Record<string, string[]>> {
  const names: string[] = [];
  for await (const name of dir.keys()) {
    if (/^hours-\d{4}-\d{2}\.json$/.test(name)) names.push(name);
  }
  names.sort();
  const all: TimeEntry[] = [];
  for (const name of names) {
    const md = await readJson<MonthData>(dir, name, { year: 0, month: 0, entries: [] });
    all.push(...md.entries);
  }
  all.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const result: Record<string, string[]> = {};
  for (const e of all) {
    const p = e.project?.trim();
    if (!p || !e.clientId) continue;
    const list = result[e.clientId] ?? [];
    result[e.clientId] = [p, ...list.filter(x => x !== p)].slice(0, MAX_PROJECTS);
  }
  return result;
}

// ── Store ───────────────────────────────────────────────────────────────────
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const now = new Date();
  const [isDark, setIsDark] = useState(true);
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [savedHandleAvailable, setSavedHandleAvailable] = useState(false);
  const savedHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const [company, setCompanyState] = useState<Company>(DEFAULT_COMPANY);
  const [clients, setClientsState] = useState<Client[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [projects, setProjects] = useState<Record<string, string[]>>({});
  const [extras, setExtras] = useState<Record<string, string[]>>({});
  const [absences, setAbsences] = useState<Record<string, DayAbsences>>({});
  const [currentMonth, setCurrentMonth] = useState<YM>({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [ioError, setIoError] = useState<string | null>(null);
  const dirRef = useRef<FileSystemDirectoryHandle | null>(null);

  // ── Git: every data-file write is queued and committed after a short idle ──
  const [gitConfig, setGitConfigState] = useState<GitConfig>(loadGitConfig);
  const gitConfigRef = useRef(gitConfig);
  const [gitStatus, setGitStatus] = useState<GitStatus>({ busy: false, pending: [] });
  const gitPendingRef = useRef<Map<string, string>>(new Map()); // file → content
  const gitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gitBusyRef = useRef<Promise<void>>(Promise.resolve());

  const setGitConfig = useCallback((c: GitConfig) => {
    gitConfigRef.current = c;
    saveGitConfig(c);
    setGitConfigState(c);
  }, []);

  // `manual`: triggered by a button, so it runs even while auto-commit is off
  const runCommit = useCallback((files: Map<string, string>, message: string, manual = false) => {
    gitBusyRef.current = gitBusyRef.current.then(async () => {
      const cfg = gitConfigRef.current;
      if ((!cfg.enabled && !manual) || files.size === 0) return;
      if (!cfg.token) {
        setGitStatus(s => ({ ...s, error: 'Kein Token hinterlegt' }));
        return;
      }
      setGitStatus(s => ({ ...s, busy: true }));
      try {
        const sha = await commitFiles(cfg, Object.fromEntries(files), message);
        setGitStatus(s => ({
          ...s, busy: false, error: undefined,
          pending: [...gitPendingRef.current.keys()],
          ...(sha ? { lastSha: sha, lastCommitAt: new Date().toLocaleString('de-CH'), lastMessage: message } : {}),
        }));
      } catch (e) {
        // Put the files back unless a newer version is already queued
        for (const [name, content] of files) if (!gitPendingRef.current.has(name)) gitPendingRef.current.set(name, content);
        setGitStatus(s => ({
          ...s, busy: false, pending: [...gitPendingRef.current.keys()],
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    });
    return gitBusyRef.current;
  }, []);

  const commitNow = useCallback(async () => {
    if (gitTimerRef.current) { clearTimeout(gitTimerRef.current); gitTimerRef.current = null; }
    const files = new Map(gitPendingRef.current);
    gitPendingRef.current.clear();
    if (files.size === 0) return;
    await runCommit(files, `Daten aktualisiert: ${[...files.keys()].sort().join(', ')}`);
  }, [runCommit]);

  const queueGit = (name: string, content: string) => {
    if (!gitConfigRef.current.enabled) return;
    gitPendingRef.current.set(name, content);
    setGitStatus(s => ({ ...s, pending: [...gitPendingRef.current.keys()] }));
    if (gitTimerRef.current) clearTimeout(gitTimerRef.current);
    gitTimerRef.current = setTimeout(commitNow, GIT_COMMIT_DELAY_MS);
  };

  // Write a data file to disk, then queue exactly that content for git
  const writeData = async (dir: FileSystemDirectoryHandle, name: string, data: unknown) => {
    await writeJson(dir, name, data);
    queueGit(name, JSON.stringify(data, null, 2));
  };

  // Commit right away when the tab goes to the background
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') commitNow(); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [commitNow]);

  // ── Month files ──────────────────────────────────────────────────────────
  // Every month that was successfully read from disk lives here with its FULL
  // content. Only months in this map are ever written, and each entry is stored
  // in the month of its own date — so one month's list can never overwrite
  // another month's file.
  const loadedRef = useRef<Map<string, TimeEntry[]>>(new Map());
  const wantedRef = useRef<YM[]>([currentMonth]); // months the calendar shows
  const dirtyRef = useRef<Set<string>>(new Set());
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBackupRef = useRef<Map<string, number>>(new Map());

  // All month-file IO runs strictly in order (reads never overtake writes)
  const ioQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = <T,>(fn: () => Promise<T>): Promise<T> => {
    const p = ioQueueRef.current.then(fn, fn);
    ioQueueRef.current = p.catch(() => {});
    return p;
  };

  const publish = () => setEntries([...loadedRef.current.values()].flat());

  const fail = (msg: string, e: unknown) => {
    console.error(`[hours] ${msg}`, e);
    setIoError(`${msg} — ${e instanceof Error ? e.message : String(e)}`);
  };

  const backupIfDue = async (dir: FileSystemDirectoryHandle, k: string) => {
    const last = lastBackupRef.current.get(k) ?? 0;
    if (Date.now() - last < BACKUP_INTERVAL_MS) return;
    await backupMonthFile(dir, k);
    lastBackupRef.current.set(k, Date.now());
  };

  const flushWrites = useCallback((): Promise<void> => {
    if (writeTimerRef.current) { clearTimeout(writeTimerRef.current); writeTimerRef.current = null; }
    const dir = dirRef.current;
    const keys = [...dirtyRef.current];
    dirtyRef.current.clear();
    if (!dir || keys.length === 0) return Promise.resolve();
    return enqueue(async () => {
      for (const k of keys) {
        const list = loadedRef.current.get(k);
        if (!list) continue; // never write a month that was not read from disk
        const { year, month } = parseYm(k);
        try {
          await backupIfDue(dir, k);
          await writeData(dir, monthKey(year, month), { year, month, entries: list });
        } catch (e) {
          dirtyRef.current.add(k); // retry with the next write
          fail(`Speichern von ${monthKey(year, month)} fehlgeschlagen`, e);
        }
      }
    });
  }, []);

  const markDirty = (k: string) => {
    dirtyRef.current.add(k);
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(flushWrites, 400);
  };

  // Read a month into memory (no-op if already loaded). A failed read leaves the
  // month unloaded, so it can never be overwritten with an empty list.
  const loadMonth = async (dir: FileSystemDirectoryHandle, k: string): Promise<boolean> => {
    if (loadedRef.current.has(k)) return true;
    const { year, month } = parseYm(k);
    try {
      loadedRef.current.set(k, await readMonthStrict(dir, year, month));
      return true;
    } catch (e) {
      fail(`Lesen von ${monthKey(year, month)} fehlgeschlagen`, e);
      return false;
    }
  };

  const loadWanted = useCallback((dir: FileSystemDirectoryHandle) =>
    enqueue(async () => {
      for (const { year, month } of wantedRef.current) await loadMonth(dir, ymKey(year, month));
      publish();
    }), []);

  // Apply a change to one month; loads the month first if needed.
  const mutateMonth = (k: string, fn: (list: TimeEntry[]) => TimeEntry[]) => {
    const list = loadedRef.current.get(k);
    if (list) {
      loadedRef.current.set(k, fn(list));
      markDirty(k);
      publish();
      return;
    }
    const dir = dirRef.current;
    if (!dir) return;
    enqueue(async () => {
      if (!(await loadMonth(dir, k))) return;
      loadedRef.current.set(k, fn(loadedRef.current.get(k)!));
      markDirty(k);
      publish();
    });
  };

  const findLoaded = (id: string): string | null => {
    for (const [k, list] of loadedRef.current) if (list.some(x => x.id === id)) return k;
    return null;
  };

  const loadAll = useCallback(async (dir: FileSystemDirectoryHandle) => {
    const [c, cl, pr, ex, va] = await Promise.all([
      readJson<Company>(dir, 'company.json', DEFAULT_COMPANY),
      readJson<Client[]>(dir, 'clients.json', []),
      readJson<Record<string, string[]>>(dir, 'projects.json', {}),
      readJson<Record<string, string[]>>(dir, 'extras.json', {}),
      readJson<Record<string, unknown> | null>(dir, 'absences.json', null),
    ]);
    setCompanyState(c);
    setClientsState(cl);
    setProjects(pr);
    setExtras(ex);
    if (va) {
      const norm: Record<string, DayAbsences> = {};
      for (const [d, v] of Object.entries(va)) {
        const list = toDayAbsences(v);
        if (list.length > 0) norm[d] = list;
      }
      setAbsences(norm);
    } else {
      // Migrate the earlier vacations.json (list of full Ferien days)
      const old = await readJson<string[]>(dir, 'vacations.json', []);
      const migrated: Record<string, DayAbsences> = {};
      for (const d of Array.isArray(old) ? old : []) migrated[d] = [{ type: 'ferien' }];
      setAbsences(migrated);
      if (Object.keys(migrated).length > 0) await writeData(dir, 'absences.json', migrated);
    }
    await loadWanted(dir);
  }, [loadWanted]);

  const activateDir = useCallback(async (dir: FileSystemDirectoryHandle) => {
    await flushWrites();
    dirRef.current = dir;
    loadedRef.current = new Map();
    dirtyRef.current.clear();
    setIoError(null);
    setDirHandle(dir);
    await loadAll(dir);
    const initIfMissing = async (name: string, data: unknown) => {
      try {
        await dir.getFileHandle(name);
      } catch (e) {
        if (e instanceof Error && e.name === 'NotFoundError') {
          await writeJson(dir, name, data);
        }
      }
    };
    await initIfMissing('company.json', DEFAULT_COMPANY);
    await initIfMissing('clients.json', []);
    await initIfMissing('extras.json', {});
    // projects.json fehlt noch → einmalig aus allen bestehenden Monatsdateien aufbauen
    try {
      await dir.getFileHandle('projects.json');
    } catch (e) {
      if (e instanceof Error && e.name === 'NotFoundError') {
        const built = await buildProjectsFromHistory(dir);
        await writeData(dir, 'projects.json', built);
        setProjects(built);
      }
    }
  }, [loadAll]);

  // Auto-restore saved directory handle on startup
  useEffect(() => {
    (async () => {
      try {
        const db = await openDB();
        const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
          const tx = db.transaction('handles', 'readonly');
          const req = tx.objectStore('handles').get('dir');
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => reject(req.error);
        });
        if (!handle) return;
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          await activateDir(handle);
        } else {
          // Permission needs re-approval — show reconnect button
          savedHandleRef.current = handle;
          setSavedHandleAvailable(true);
        }
      } catch {
        // IndexedDB not available or handle invalid
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reconnectDirectory = useCallback(async () => {
    const handle = savedHandleRef.current;
    if (!handle) return;
    try {
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        setSavedHandleAvailable(false);
        savedHandleRef.current = null;
        await activateDir(handle);
      }
    } catch (e) {
      console.error('[hours] reconnectDirectory:', e);
    }
  }, [activateDir]);

  const pickDirectory = useCallback(async () => {
    try {
      const dir = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      await persistHandle(dir);
      await activateDir(dir);
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') console.error('[hours] pickDirectory:', e);
    }
  }, [activateDir]);

  // Calendar tells the store which months the visible week spans
  const showMonths = useCallback((months: YM[], primary: YM) => {
    wantedRef.current = months;
    setCurrentMonth(primary);
    if (dirRef.current) loadWanted(dirRef.current);
  }, [loadWanted]);

  // Flush on tab close so no debounced change is lost
  useEffect(() => {
    const onUnload = () => { flushWrites(); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [flushWrites]);

  const setCompany = useCallback(async (c: Company) => {
    setCompanyState(c);
    if (dirRef.current) await writeData(dirRef.current, 'company.json', c);
  }, []);

  const setClients = useCallback(async (c: Client[]) => {
    setClientsState(c);
    if (dirRef.current) {
      await writeData(dirRef.current, 'clients.json', c);
    } else {
      console.warn('[hours] setClients: kein Verzeichnis gewählt, wird nicht gespeichert');
    }
  }, []);

  const upsert = (list: TimeEntry[], e: TimeEntry) =>
    list.some(x => x.id === e.id) ? list.map(x => x.id === e.id ? e : x) : [...list, e];

  const addEntry = useCallback((e: TimeEntry) => {
    mutateMonth(ymKeyOfDate(e.date), list => upsert(list, e));
  }, []);

  // Moving an entry into another month removes it from the old month's file
  const updateEntry = useCallback((e: TimeEntry) => {
    const newK = ymKeyOfDate(e.date);
    const oldK = findLoaded(e.id);
    if (oldK && oldK !== newK) mutateMonth(oldK, list => list.filter(x => x.id !== e.id));
    mutateMonth(newK, list => upsert(list, e));
  }, []);

  const deleteEntry = useCallback((id: string) => {
    const k = findLoaded(id);
    if (k) mutateMonth(k, list => list.filter(x => x.id !== id));
  }, []);

  // Record a value as "just used": move to front of the client's MRU list, cap at MAX_PROJECTS
  const touchMru = (
    setter: React.Dispatch<React.SetStateAction<Record<string, string[]>>>,
    fileName: string,
    clientId: string,
    value: string,
  ) => {
    const p = value.trim();
    if (!clientId || !p) return;
    setter(prev => {
      const list = prev[clientId] ?? [];
      if (list[0] === p) return prev; // already on top
      const updated = { ...prev, [clientId]: [p, ...list.filter(x => x !== p)].slice(0, MAX_PROJECTS) };
      if (dirRef.current) writeData(dirRef.current, fileName, updated);
      return updated;
    });
  };

  const touchProject = useCallback((clientId: string, project: string) => {
    touchMru(setProjects, 'projects.json', clientId, project);
  }, []);

  const touchExtra = useCallback((clientId: string, value: string) => {
    touchMru(setExtras, 'extras.json', clientId, value);
  }, []);

  const setAbsence = useCallback((date: string, list: DayAbsences | null) => {
    setAbsences(prev => {
      const { [date]: _, ...rest } = prev;
      const merged: Record<string, DayAbsences> = list && list.length > 0 ? { ...rest, [date]: list } : rest;
      // Keep the file sorted by date
      const updated = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
      if (dirRef.current) {
        writeData(dirRef.current, 'absences.json', updated)
          .catch(e => fail('Speichern von absences.json fehlgeschlagen', e));
      }
      return updated;
    });
  }, []);

  // For reports: in-memory content if the month is loaded (includes unsaved
  // changes), otherwise read from disk — in queue order after pending writes.
  const readMonthEntries = useCallback(async (year: number, month: number): Promise<TimeEntry[]> => {
    const loaded = loadedRef.current.get(ymKey(year, month));
    if (loaded) return loaded;
    const dir = dirRef.current;
    if (!dir) return [];
    await flushWrites();
    return enqueue(async () => {
      try { return await readMonthStrict(dir, year, month); }
      catch (e) { fail(`Lesen von ${monthKey(year, month)} fehlgeschlagen`, e); return []; }
    });
  }, [flushWrites]);

  // Commit every data file as it is on disk (initial upload / full re-sync)
  const commitAllData = useCallback(async () => {
    const dir = dirRef.current;
    if (!dir) { setGitStatus(s => ({ ...s, error: 'Kein Datenverzeichnis gewählt' })); return; }
    await flushWrites();
    const files = await enqueue(async () => {
      const out = new Map<string, string>();
      for await (const name of dir.keys()) {
        if (!DATA_FILE.test(name)) continue;
        out.set(name, await (await (await dir.getFileHandle(name)).getFile()).text());
      }
      return out;
    });
    for (const name of files.keys()) gitPendingRef.current.delete(name);
    await runCommit(files, `Vollständiger Abgleich (${files.size} Dateien)`, true);
  }, [flushWrites, runCommit]);

  const toggleTheme = () => setIsDark(d => !d);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  return (
    <Ctx.Provider value={{
      company, clients, entries, projects, extras, absences, dirHandle, savedHandleAvailable, isDark, currentMonth, ioError,
      setCompany, setClients, addEntry, updateEntry, deleteEntry, touchProject, touchExtra, setAbsence,
      pickDirectory, reconnectDirectory, toggleTheme, showMonths, readMonthEntries,
      gitConfig, setGitConfig, gitStatus, commitNow, commitAllData,
    }}>
      {children}
    </Ctx.Provider>
  );
}
