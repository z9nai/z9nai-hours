import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Client, Company, MonthData, TimeEntry } from './types';

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
  dirHandle: FileSystemDirectoryHandle | null;
  savedHandleAvailable: boolean;
  isDark: boolean;
  currentMonth: { year: number; month: number };
  setCompany: (c: Company) => void;
  setClients: (c: Client[]) => void;
  addEntry: (e: TimeEntry) => void;
  updateEntry: (e: TimeEntry) => void;
  deleteEntry: (id: string) => void;
  touchProject: (clientId: string, project: string) => void;
  pickDirectory: () => Promise<void>;
  reconnectDirectory: () => Promise<void>;
  toggleTheme: () => void;
  setMonth: (year: number, month: number) => void;
  readMonthEntries: (year: number, month: number) => Promise<TimeEntry[]>;
}

const MAX_PROJECTS = 30;

const Ctx = createContext<StoreCtx>(null!);
export const useStore = () => useContext(Ctx);

const monthKey = (y: number, m: number) => `hours-${y}-${String(m).padStart(2, '0')}.json`;

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
  const [currentMonth, setCurrentMonth] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const dirRef = useRef<FileSystemDirectoryHandle | null>(null);

  const loadAll = useCallback(async (dir: FileSystemDirectoryHandle, year: number, month: number) => {
    const [c, cl, md, pr] = await Promise.all([
      readJson<Company>(dir, 'company.json', DEFAULT_COMPANY),
      readJson<Client[]>(dir, 'clients.json', []),
      readJson<MonthData>(dir, monthKey(year, month), { year, month, entries: [] }),
      readJson<Record<string, string[]>>(dir, 'projects.json', {}),
    ]);
    setCompanyState(c);
    setClientsState(cl);
    setEntries(md.entries);
    setProjects(pr);
  }, []);

  const activateDir = useCallback(async (dir: FileSystemDirectoryHandle, year: number, month: number) => {
    dirRef.current = dir;
    setDirHandle(dir);
    await loadAll(dir, year, month);
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
    // projects.json fehlt noch → einmalig aus allen bestehenden Monatsdateien aufbauen
    try {
      await dir.getFileHandle('projects.json');
    } catch (e) {
      if (e instanceof Error && e.name === 'NotFoundError') {
        const built = await buildProjectsFromHistory(dir);
        await writeJson(dir, 'projects.json', built);
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
          await activateDir(handle, now.getFullYear(), now.getMonth() + 1);
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
        await activateDir(handle, currentMonth.year, currentMonth.month);
      }
    } catch (e) {
      console.error('[hours] reconnectDirectory:', e);
    }
  }, [currentMonth, activateDir]);

  const pickDirectory = useCallback(async () => {
    try {
      const dir = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      await persistHandle(dir);
      await activateDir(dir, currentMonth.year, currentMonth.month);
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') console.error('[hours] pickDirectory:', e);
    }
  }, [currentMonth, activateDir]);

  // Debounced disk write: rapid successive changes (e.g. typing in the panel)
  // collapse into one write. A pending write for a DIFFERENT month is flushed
  // immediately so it can never be lost on month switch.
  const pendingWriteRef = useRef<{ key: string; md: MonthData } | null>(null);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingWrite = useCallback(() => {
    const p = pendingWriteRef.current;
    pendingWriteRef.current = null;
    if (writeTimerRef.current) { clearTimeout(writeTimerRef.current); writeTimerRef.current = null; }
    if (p && dirRef.current) writeJson(dirRef.current, p.key, p.md);
  }, []);

  const setMonth = useCallback(async (year: number, month: number) => {
    flushPendingWrite();
    setCurrentMonth({ year, month });
    if (dirRef.current) {
      const md = await readJson<MonthData>(dirRef.current, monthKey(year, month), { year, month, entries: [] });
      setEntries(md.entries);
    }
  }, [flushPendingWrite]);

  const saveMonthEntries = useCallback((updated: TimeEntry[]) => {
    if (!dirRef.current) return;
    const key = monthKey(currentMonth.year, currentMonth.month);
    if (pendingWriteRef.current && pendingWriteRef.current.key !== key) flushPendingWrite();
    pendingWriteRef.current = { key, md: { year: currentMonth.year, month: currentMonth.month, entries: updated } };
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(flushPendingWrite, 400);
  }, [currentMonth, flushPendingWrite]);

  // Flush on tab close so no debounced change is lost
  useEffect(() => {
    window.addEventListener('beforeunload', flushPendingWrite);
    return () => window.removeEventListener('beforeunload', flushPendingWrite);
  }, [flushPendingWrite]);

  const setCompany = useCallback(async (c: Company) => {
    setCompanyState(c);
    if (dirRef.current) await writeJson(dirRef.current, 'company.json', c);
  }, []);

  const setClients = useCallback(async (c: Client[]) => {
    setClientsState(c);
    if (dirRef.current) {
      await writeJson(dirRef.current, 'clients.json', c);
    } else {
      console.warn('[hours] setClients: kein Verzeichnis gewählt, wird nicht gespeichert');
    }
  }, []);

  const addEntry = useCallback((e: TimeEntry) => {
    setEntries(prev => { const u = [...prev, e]; saveMonthEntries(u); return u; });
  }, [saveMonthEntries]);

  const updateEntry = useCallback((e: TimeEntry) => {
    setEntries(prev => { const u = prev.map(x => x.id === e.id ? e : x); saveMonthEntries(u); return u; });
  }, [saveMonthEntries]);

  const deleteEntry = useCallback((id: string) => {
    setEntries(prev => { const u = prev.filter(x => x.id !== id); saveMonthEntries(u); return u; });
  }, [saveMonthEntries]);

  // Record a project as "just used": move to front of the client's MRU list, cap at MAX_PROJECTS
  const touchProject = useCallback((clientId: string, project: string) => {
    const p = project.trim();
    if (!clientId || !p) return;
    setProjects(prev => {
      const list = prev[clientId] ?? [];
      if (list[0] === p) return prev; // already on top
      const updated = { ...prev, [clientId]: [p, ...list.filter(x => x !== p)].slice(0, MAX_PROJECTS) };
      if (dirRef.current) writeJson(dirRef.current, 'projects.json', updated);
      return updated;
    });
  }, []);

  const readMonthEntries = useCallback(async (year: number, month: number): Promise<TimeEntry[]> => {
    if (!dirRef.current) return [];
    flushPendingWrite();
    const md = await readJson<MonthData>(dirRef.current, monthKey(year, month), { year, month, entries: [] });
    return md.entries;
  }, [flushPendingWrite]);

  const toggleTheme = () => setIsDark(d => !d);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  return (
    <Ctx.Provider value={{
      company, clients, entries, projects, dirHandle, savedHandleAvailable, isDark, currentMonth,
      setCompany, setClients, addEntry, updateEntry, deleteEntry, touchProject,
      pickDirectory, reconnectDirectory, toggleTheme, setMonth, readMonthEntries,
    }}>
      {children}
    </Ctx.Provider>
  );
}
