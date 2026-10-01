import React, { useState } from 'react';
import { GitCommitHorizontal, Plug, Upload } from 'lucide-react';
import { useStore } from '../store';
import { parseRepo, testConnection } from '../git';

function Field({ label, value, onChange, placeholder, isDark, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; isDark: boolean; type?: string;
}) {
  const inputCls = isDark
    ? 'bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-white/30'
    : 'bg-black/5 border-black/10 text-black placeholder-black/20 focus:border-black/30';
  return (
    <div>
      <label className={`block text-[10px] uppercase tracking-wider mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        autoComplete="off" spellCheck={false}
        className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors ${inputCls}`} />
    </div>
  );
}

export default function AdminView() {
  const { isDark, gitConfig, setGitConfig, gitStatus, commitNow, commitAllData, dirHandle } = useStore();
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const muted = isDark ? 'text-white/40' : 'text-black/40';
  const btn = `flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors disabled:opacity-40 ${
    isDark ? 'border-white/15 text-white/60 hover:border-white/30 hover:text-white' : 'border-black/15 text-black/60 hover:border-black/30 hover:text-black'
  }`;
  const repo = parseRepo(gitConfig.repo);
  const ready = !!repo && !!gitConfig.token;

  const test = async () => {
    setTesting(true);
    try { setTestResult({ ok: true, text: await testConnection(gitConfig) }); }
    catch (e) { setTestResult({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setTesting(false); }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className={`text-sm font-semibold uppercase tracking-widest mb-6 ${isDark ? 'text-white/50' : 'text-black/50'}`}>Admin</h2>

      <div className={`text-[10px] uppercase tracking-wider mb-3 ${muted}`}>Git-Versionierung der Daten</div>
      <div className="space-y-4">
        <label className={`flex items-center gap-2 text-xs cursor-pointer ${isDark ? 'text-white/70' : 'text-black/70'}`}>
          <input type="checkbox" checked={gitConfig.enabled}
            onChange={e => setGitConfig({ ...gitConfig, enabled: e.target.checked })}
            className="accent-blue-500" />
          Nach jeder Anpassung automatisch committen
        </label>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Repository" value={gitConfig.repo} isDark={isDark}
              onChange={v => setGitConfig({ ...gitConfig, repo: v })}
              placeholder="git@github.com:z9nai/z9nai-hours-data.git" />
          </div>
          <Field label="Branch" value={gitConfig.branch} isDark={isDark}
            onChange={v => setGitConfig({ ...gitConfig, branch: v })} placeholder="main" />
        </div>
        {gitConfig.repo && !repo && <p className="text-[11px] text-red-400">Repository-Angabe nicht erkannt</p>}

        <Field label="GitHub Token" type="password" value={gitConfig.token} isDark={isDark}
          onChange={v => setGitConfig({ ...gitConfig, token: v.trim() })} placeholder="github_pat_…" />
        <p className={`text-[11px] leading-relaxed ${muted}`}>
          Fine-grained Token unter{' '}
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" className="underline">
            github.com/settings/personal-access-tokens
          </a>{' '}
          erstellen: nur dieses Repository, Berechtigung «Contents: Read and write».
          Der Token wird nur in diesem Browser gespeichert, nicht im Datenverzeichnis.
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          <button className={btn} disabled={!ready || testing} onClick={test}>
            <Plug size={12} /> {testing ? 'Teste…' : 'Verbindung testen'}
          </button>
          <button className={btn} disabled={!ready || !dirHandle || gitStatus.busy} onClick={commitAllData}
            title={!dirHandle ? 'Zuerst Datenverzeichnis wählen' : undefined}>
            <Upload size={12} /> Alle Daten jetzt committen
          </button>
          <button className={btn} disabled={!ready || gitStatus.pending.length === 0 || gitStatus.busy} onClick={commitNow}>
            <GitCommitHorizontal size={12} /> Offene Änderungen committen
          </button>
        </div>

        {testResult && (
          <p className={`text-[11px] ${testResult.ok ? (isDark ? 'text-emerald-400' : 'text-emerald-600') : 'text-red-400'}`}>
            {testResult.text}
          </p>
        )}

        {/* Status */}
        <div className={`rounded-xl border p-4 space-y-1.5 text-[11px] ${isDark ? 'border-white/8 text-white/60' : 'border-black/8 text-black/60'}`}>
          <div className="flex justify-between">
            <span className={muted}>Status</span>
            <span>{gitStatus.busy ? 'Committe…' : !gitConfig.enabled ? 'Auto-Commit aus' : 'Bereit'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className={muted}>Offen</span>
            <span className="text-right">{gitStatus.pending.length ? gitStatus.pending.join(', ') : '—'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className={muted}>Letzter Commit</span>
            <span className="text-right">
              {gitStatus.lastSha && repo ? (
                <a className="underline" target="_blank" rel="noopener noreferrer"
                  href={`https://github.com/${repo.owner}/${repo.repo}/commit/${gitStatus.lastSha}`}>
                  {gitStatus.lastSha.slice(0, 7)}
                </a>
              ) : '—'}
              {gitStatus.lastCommitAt && <> · {gitStatus.lastCommitAt}</>}
            </span>
          </div>
          {gitStatus.lastMessage && <div className="text-right">{gitStatus.lastMessage}</div>}
          {gitStatus.error && <div className="text-red-400">Fehler: {gitStatus.error}</div>}
        </div>
      </div>
    </div>
  );
}
