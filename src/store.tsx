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
  dirHandle: FileSystemDirectoryHandle | null;
  savedHandleAvailable: boolean;
  isDark: boolean;
  currentMonth: { year: number; month: number };
  setCompany: (c: Company) => void;
  setClients: (c: Client[]) => void;
  addEntry: (e: TimeEntry) => void;
  updateEntry: (e: TimeEntry) => void;
  deleteEntry: (id: string) => void;
  pickDirectory: () => Promise<void>;
  reconnectDirectory: () => Promise<void>;
  toggleTheme: () => void;
  setMonth: (year: number, month: number) => void;
}

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
  const [currentMonth, setCurrentMonth] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const dirRef = useRef<FileSystemDirectoryHandle | null>(null);

  const loadAll = useCallback(async (dir: FileSystemDirectoryHandle, year: number, month: number) => {
    const [c, cl, md] = await Promise.all([
      readJson<Company>(dir, 'company.json', DEFAULT_COMPANY),
      readJson<Client[]>(dir, 'clients.json', []),
      readJson<MonthData>(dir, monthKey(year, month), { year, month, entries: [] }),
    ]);
    setCompanyState(c);
    setClientsState(cl);
    setEntries(md.entries);
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

  const setMonth = useCallback(async (year: number, month: number) => {
    setCurrentMonth({ year, month });
    if (dirRef.current) {
      const md = await readJson<MonthData>(dirRef.current, monthKey(year, month), { year, month, entries: [] });
      setEntries(md.entries);
    }
  }, []);

  const saveMonthEntries = useCallback(async (updated: TimeEntry[]) => {
    if (!dirRef.current) return;
    const md: MonthData = { year: currentMonth.year, month: currentMonth.month, entries: updated };
    await writeJson(dirRef.current, monthKey(currentMonth.year, currentMonth.month), md);
  }, [currentMonth]);

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

  const toggleTheme = () => setIsDark(d => !d);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  return (
    <Ctx.Provider value={{
      company, clients, entries, dirHandle, savedHandleAvailable, isDark, currentMonth,
      setCompany, setClients, addEntry, updateEntry, deleteEntry,
      pickDirectory, reconnectDirectory, toggleTheme, setMonth,
    }}>
      {children}
    </Ctx.Provider>
  );
}
