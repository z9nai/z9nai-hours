import React, { useState } from 'react';
import { Sun, Moon, FolderOpen, Clock, Users, Building2, BarChart2 } from 'lucide-react';
import { useStore } from './store';
import { TimeEntry } from './types';
import Calendar from './components/Calendar';
import EntryPanel from './components/EntryPanel';
import ClientsView from './components/ClientsView';
import CompanyView from './components/CompanyView';
import ReportsView from './components/ReportsView';

type View = 'calendar' | 'clients' | 'reports' | 'company';

type PanelEntry = Partial<TimeEntry> & { date: string; startTime: string; endTime: string };

export default function App() {
  const { isDark, toggleTheme, dirHandle, savedHandleAvailable, pickDirectory, reconnectDirectory } = useStore();
  const [view, setView] = useState<View>('calendar');
  const [panelEntry, setPanelEntry] = useState<PanelEntry | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = (entry: PanelEntry) => {
    setSelectedId(null);
    setPanelEntry(entry);
  };

  const handleEditEntry = (entry: TimeEntry) => {
    setSelectedId(entry.id);
    setPanelEntry(entry);
  };

  const handleClosePanel = () => {
    setPanelEntry(null);
    setSelectedId(null);
  };

  const bg = isDark ? 'bg-[#0e0f11]' : 'bg-[#f5f4f0]';
  const border = isDark ? 'border-white/8' : 'border-black/8';
  const topBg = isDark ? 'bg-[#0c0d0f]' : 'bg-[#eae9e5]';
  const textBase = isDark ? 'text-white' : 'text-black';

  const navBtn = (v: View, Icon: React.ElementType, label: string) => (
    <button
      onClick={() => setView(v)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors ${
        view === v
          ? isDark ? 'bg-white/10 text-white' : 'bg-black/10 text-black'
          : isDark ? 'text-white/35 hover:text-white/70' : 'text-black/35 hover:text-black/70'
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );

  return (
    <div className={`flex flex-col h-screen ${bg} ${textBase}`}>
      {/* Top bar */}
      <div className={`flex items-center gap-3 px-4 py-2 border-b ${border} ${topBg} flex-shrink-0`}>
        <span className={`text-xs font-bold tracking-widest mr-4 ${isDark ? 'text-white/70' : 'text-black/70'}`}>
          Z9nAI Hours
        </span>
        {navBtn('calendar', Clock, 'Stunden')}
        {navBtn('reports', BarChart2, 'Report')}
        {navBtn('clients', Users, 'Kunden')}
        {navBtn('company', Building2, 'Firma')}

        <div className="ml-auto flex items-center gap-3">
          {/* Data directory */}
          <button
            onClick={pickDirectory}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border transition-colors ${
              dirHandle
                ? isDark ? 'border-white/15 text-white/50 hover:border-white/30' : 'border-black/15 text-black/50 hover:border-black/30'
                : isDark ? 'border-blue-500/40 text-blue-400 hover:border-blue-400' : 'border-blue-500/40 text-blue-600 hover:border-blue-500'
            }`}
            title={dirHandle ? `Verzeichnis: geöffnet` : 'Datenverzeichnis wählen'}
          >
            <FolderOpen size={12} />
            {dirHandle ? dirHandle.name : 'Verzeichnis wählen'}
          </button>

          {/* Theme toggle */}
          <button onClick={toggleTheme}
            className={`flex items-center gap-1 p-1.5 rounded transition-colors ${isDark ? 'text-white/35 hover:text-white/70' : 'text-black/35 hover:text-black/70'}`}>
            {isDark ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </div>
      </div>

      {/* No directory warning — always visible */}
      {!dirHandle && (
        <div className={`px-4 py-2 text-[11px] flex items-center gap-2 border-b ${border} ${isDark ? 'bg-blue-950/30 text-blue-300/70 border-blue-500/20' : 'bg-blue-50 text-blue-700/70 border-blue-200'}`}>
          <FolderOpen size={12} />
          {savedHandleAvailable ? (
            <>
              Letztes Verzeichnis gefunden —
              <button onClick={reconnectDirectory} className="underline underline-offset-2 hover:opacity-80">Wieder verbinden</button>
              oder
              <button onClick={pickDirectory} className="underline underline-offset-2 hover:opacity-80">anderes wählen</button>
            </>
          ) : (
            <>
              Kein Datenverzeichnis gewählt — Daten werden nicht gespeichert.
              <button onClick={pickDirectory} className="underline underline-offset-2 hover:opacity-80">Verzeichnis wählen</button>
            </>
          )}
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {view === 'calendar' ? (
          <>
            <div className="flex-1 overflow-hidden">
              <Calendar onSelect={handleSelect} onEditEntry={handleEditEntry} selectedId={selectedId} />
            </div>
            {panelEntry && (
              <div className="w-72 flex-shrink-0 overflow-hidden">
                <EntryPanel entry={panelEntry} onClose={handleClosePanel} />
              </div>
            )}
          </>
        ) : view === 'clients' ? (
          <div className="flex-1 overflow-y-auto">
            <ClientsView />
          </div>
        ) : view === 'reports' ? (
          <div className="flex-1 overflow-y-auto">
            <ReportsView />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <CompanyView />
          </div>
        )}
      </div>
    </div>
  );
}
