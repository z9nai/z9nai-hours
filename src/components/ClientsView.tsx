import React, { useState } from 'react';
import { Plus, Pencil, X } from 'lucide-react';
import { Client, Address, ContactPerson, CcRecipient } from '../types';
import { useStore } from '../store';
import { CLIENT_COLORS, DEFAULT_COLOR } from '../colors';

const EMPTY_ADDR: Address = { street: '', zip: '', city: '', country: 'CH' };
const EMPTY_CONTACT: ContactPerson = { name: '', email: '', phone: '' };
const EMPTY_CLIENT: Omit<Client, 'id'> = { uid: '', name: '', color: DEFAULT_COLOR, address: { ...EMPTY_ADDR }, contact: { ...EMPTY_CONTACT } };

function genId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function fmtIso(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function Field({ label, value, onChange, placeholder, isDark }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; isDark: boolean;
}) {
  const inputCls = isDark
    ? 'bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-white/30'
    : 'bg-black/5 border-black/10 text-black placeholder-black/20 focus:border-black/30';
  return (
    <div>
      <label className={`block text-[10px] uppercase tracking-wider mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors ${inputCls}`} />
    </div>
  );
}

function ColorPicker({ value, onChange, isDark }: { value: string; onChange: (v: string) => void; isDark: boolean }) {
  return (
    <div>
      <label className={`block text-[10px] uppercase tracking-wider mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>Farbe</label>
      <div className="flex gap-2 flex-wrap">
        {Object.entries(CLIENT_COLORS).map(([key, c]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            title={c.label}
            className={`w-6 h-6 rounded-full transition-all ${c.dot} ${
              value === key ? 'ring-2 ring-offset-2 ring-white/60 scale-110' : 'opacity-60 hover:opacity-100'
            } ${isDark ? 'ring-offset-[#14151a]' : 'ring-offset-[#ededea]'}`}
          />
        ))}
      </div>
    </div>
  );
}

function ClientForm({ initial, onSave, onCancel, isDark }: {
  initial: Omit<Client, 'id'>;
  onSave: (c: Omit<Client, 'id'>) => void;
  onCancel: () => void;
  isDark: boolean;
}) {
  const [f, setF] = useState(initial);

  const setTop = (k: keyof Omit<Client, 'id' | 'address' | 'contact'>, v: string) =>
    setF(p => ({ ...p, [k]: v }));
  const setAddr = (k: keyof Address, v: string) =>
    setF(p => ({ ...p, address: { ...p.address, [k]: v } }));
  const setContact = (k: keyof ContactPerson, v: string) =>
    setF(p => ({ ...p, contact: { ...p.contact, [k]: v } }));

  const labelCls = isDark ? 'text-white/40' : 'text-black/40';
  const btnPrimary = isDark ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/80';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Firmenname" value={f.name} onChange={v => setTop('name', v)} placeholder="Acme AG" isDark={isDark} />
        <Field label="UID" value={f.uid} onChange={v => setTop('uid', v)} placeholder="CHE-123.456.789" isDark={isDark} />
      </div>
      <div className="grid grid-cols-2 gap-3 items-end">
        <Field label="Stundensatz (CHF)" value={f.hourlyRate != null ? String(f.hourlyRate) : ''}
          onChange={v => setF(p => ({ ...p, hourlyRate: v.trim() === '' ? undefined : Number(v.replace(',', '.')) || 0 }))}
          placeholder="150" isDark={isDark} />
        <ColorPicker value={f.color || DEFAULT_COLOR} onChange={v => setTop('color', v)} isDark={isDark} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="Strasse" value={f.address.street} onChange={v => setAddr('street', v)} placeholder="Musterstrasse 1" isDark={isDark} />
        </div>
        <Field label="PLZ" value={f.address.zip} onChange={v => setAddr('zip', v)} placeholder="8000" isDark={isDark} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ort" value={f.address.city} onChange={v => setAddr('city', v)} placeholder="Zürich" isDark={isDark} />
        <Field label="Land" value={f.address.country} onChange={v => setAddr('country', v)} placeholder="CH" isDark={isDark} />
      </div>
      <div className={`text-[10px] uppercase tracking-wider pt-1 ${labelCls}`}>Mandat: Kontingent / Kostendach &amp; Umsatzziel</div>
      <div className="grid grid-cols-4 gap-3">
        <Field label="Stunden" value={f.quota ? String(f.quota.hours || '') : ''}
          onChange={v => setF(p => {
            const hours = v.trim() === '' ? 0 : Number(v.replace(',', '.')) || 0;
            return { ...p, quota: { hours, from: p.quota?.from ?? '', to: p.quota?.to ?? '' } };
          })}
          placeholder="1500" isDark={isDark} />
        <div>
          <label className={`block text-[10px] uppercase tracking-wider mb-1 ${labelCls}`}>Von</label>
          <input type="date" value={f.quota?.from ?? ''}
            onChange={e => setF(p => ({ ...p, quota: { hours: p.quota?.hours ?? 0, from: e.target.value, to: p.quota?.to ?? '' } }))}
            className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors ${
              isDark ? 'bg-white/5 border-white/10 text-white focus:border-white/30' : 'bg-black/5 border-black/10 text-black focus:border-black/30'
            }`} />
        </div>
        <div>
          <label className={`block text-[10px] uppercase tracking-wider mb-1 ${labelCls}`}>Bis</label>
          <input type="date" value={f.quota?.to ?? ''}
            onChange={e => setF(p => ({ ...p, quota: { hours: p.quota?.hours ?? 0, from: p.quota?.from ?? '', to: e.target.value } }))}
            className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors ${
              isDark ? 'bg-white/5 border-white/10 text-white focus:border-white/30' : 'bg-black/5 border-black/10 text-black focus:border-black/30'
            }`} />
        </div>
        <Field label="Umsatzziel / Monat (CHF)" value={f.revenueTarget != null ? String(f.revenueTarget) : ''}
          onChange={v => {
            const t = v.replace(/['’\s]/g, '').replace(',', '.');
            setF(p => ({ ...p, revenueTarget: t === '' ? undefined : Math.max(0, Number(t) || 0) }));
          }}
          placeholder="18000" isDark={isDark} />
      </div>
      <p className={`text-[10px] -mt-1 ${labelCls}`}>
        Das Umsatzziel und der Umsatz zählen im Umsatz-Tab nur während des Mandats (Von – Bis); angebrochene Monate anteilig.
      </p>

      <div className={`text-[10px] uppercase tracking-wider pt-1 ${labelCls}`}>Zusatzfeld für Einträge</div>
      <div className="grid grid-cols-2 gap-3 items-end">
        <label className={`flex items-center gap-2 text-xs py-2 cursor-pointer ${isDark ? 'text-white/70' : 'text-black/70'}`}>
          <input type="checkbox"
            checked={f.extraField?.enabled ?? false}
            onChange={e => setF(p => ({ ...p, extraField: { enabled: e.target.checked, label: p.extraField?.label ?? '' } }))}
            className="accent-blue-500" />
          Einblenden
        </label>
        <Field label="Bezeichnung" value={f.extraField?.label ?? ''}
          onChange={v => setF(p => ({ ...p, extraField: { enabled: p.extraField?.enabled ?? false, label: v } }))}
          placeholder="z.B. Ticket-Nr." isDark={isDark} />
      </div>

      <div className={`text-[10px] uppercase tracking-wider pt-1 ${labelCls}`}>Ansprechperson</div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Name" value={f.contact.name} onChange={v => setContact('name', v)} isDark={isDark} />
        <Field label="E-Mail" value={f.contact.email} onChange={v => setContact('email', v)} isDark={isDark} />
        <Field label="Telefon" value={f.contact.phone} onChange={v => setContact('phone', v)} isDark={isDark} />
      </div>

      <div className={`flex items-center justify-between pt-1`}>
        <span className={`text-[10px] uppercase tracking-wider ${labelCls}`}>Rechnung CC</span>
        <button type="button"
          onClick={() => setF(p => ({ ...p, cc: [...(p.cc ?? []), { name: '', email: '' }] }))}
          className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-colors ${
            isDark ? 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/70' : 'border-black/15 text-black/40 hover:border-black/30 hover:text-black/70'
          }`}>
          <Plus size={10} /> CC hinzufügen
        </button>
      </div>
      {(f.cc ?? []).map((cc, i) => (
        <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] gap-3 items-end">
          <Field label="Name" value={cc.name}
            onChange={v => setF(p => ({ ...p, cc: (p.cc ?? []).map((c, j) => j === i ? { ...c, name: v } : c) }))}
            placeholder="Max Muster" isDark={isDark} />
          <Field label="E-Mail" value={cc.email}
            onChange={v => setF(p => ({ ...p, cc: (p.cc ?? []).map((c, j) => j === i ? { ...c, email: v } : c) }))}
            placeholder="max@acme.ch" isDark={isDark} />
          <button type="button"
            onClick={() => setF(p => ({ ...p, cc: (p.cc ?? []).filter((_, j) => j !== i) }))}
            className={`p-2 mb-0.5 rounded transition-colors ${isDark ? 'text-white/25 hover:text-red-400' : 'text-black/25 hover:text-red-500'}`}
            title="CC entfernen">
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel}
          className={`flex-1 text-xs py-2 rounded border transition-colors ${isDark ? 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/70' : 'border-black/15 text-black/40 hover:border-black/30 hover:text-black/70'}`}>
          Abbrechen
        </button>
        <button onClick={() => f.name && onSave({
          ...f,
          cc: (f.cc ?? []).filter(c => c.name.trim() || c.email.trim()),
          quota: f.quota && f.quota.hours > 0 && f.quota.from && f.quota.to ? f.quota : undefined,
        })}
          className={`flex-1 text-xs py-2 rounded font-semibold transition-colors ${btnPrimary}`}>
          Speichern
        </button>
      </div>
    </div>
  );
}

export default function ClientsView() {
  const { clients, setClients, isDark } = useStore();
  const [editId, setEditId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const border = isDark ? 'border-white/8' : 'border-black/8';
  const textMuted = isDark ? 'text-white/30' : 'text-black/30';

  const add = (data: Omit<Client, 'id'>) => {
    setClients([...clients, { ...data, id: genId() }]);
    setAdding(false);
  };

  const update = (id: string, data: Omit<Client, 'id'>) => {
    setClients(clients.map(c => c.id === id ? { ...data, id } : c));
    setEditId(null);
  };

  const remove = (id: string) => setClients(clients.filter(c => c.id !== id));

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className={`text-sm font-semibold uppercase tracking-widest ${isDark ? 'text-white/50' : 'text-black/50'}`}>Kunden</h2>
        {!adding && (
          <button onClick={() => setAdding(true)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors ${isDark ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white' : 'border-black/15 text-black/50 hover:border-black/30 hover:text-black'}`}>
            <Plus size={12} /> Neuer Kunde
          </button>
        )}
      </div>

      {adding && (
        <div className={`p-4 rounded-xl border mb-4 ${isDark ? 'border-white/8 bg-white/3' : 'border-black/8 bg-black/3'}`}>
          <p className={`text-[10px] uppercase tracking-wider mb-3 ${textMuted}`}>Neuer Kunde</p>
          <ClientForm
            initial={{ ...EMPTY_CLIENT, address: { ...EMPTY_ADDR }, contact: { ...EMPTY_CONTACT } }}
            onSave={add} onCancel={() => setAdding(false)} isDark={isDark} />
        </div>
      )}

      {clients.length === 0 && !adding && (
        <p className={`text-sm ${textMuted}`}>Noch keine Kunden erfasst.</p>
      )}

      <div className="space-y-3">
        {clients.map(c => {
          const color = CLIENT_COLORS[c.color] ?? CLIENT_COLORS[DEFAULT_COLOR];
          return (
            <div key={c.id} className={`rounded-xl border ${border} ${isDark ? 'bg-white/2' : 'bg-black/2'}`}>
              {editId === c.id ? (
                <div className="p-4">
                  <ClientForm initial={c} onSave={d => update(c.id, d)} onCancel={() => setEditId(null)} isDark={isDark} />
                </div>
              ) : (
                <div className="px-4 py-3 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-3 h-3 rounded-full flex-shrink-0 mt-1 ${color.dot}`} />
                    <div>
                      <div className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-black'}`}>{c.name}</div>
                      <div className={`text-[11px] mt-0.5 ${textMuted}`}>
                        {c.uid && <span className="mr-3">{c.uid}</span>}
                        {c.hourlyRate != null && <span className="mr-3">CHF {c.hourlyRate}/h</span>}
                        {c.revenueTarget != null && <span className="mr-3">Umsatzziel CHF {c.revenueTarget.toLocaleString('de-CH')}/Mt.</span>}
                        {c.quota && <span className="mr-3">Kontingent {c.quota.hours}h ({fmtIso(c.quota.from)}–{fmtIso(c.quota.to)})</span>}
                        {c.address.street && <span>{c.address.street}, {c.address.zip} {c.address.city}</span>}
                      </div>
                      {c.contact.name && (
                        <div className={`text-[11px] mt-1 ${textMuted}`}>
                          {c.contact.name}{c.contact.email && ` · ${c.contact.email}`}{c.contact.phone && ` · ${c.contact.phone}`}
                        </div>
                      )}
                      {(c.cc?.length ?? 0) > 0 && (
                        <div className={`text-[11px] mt-1 ${textMuted}`}>
                          CC: {c.cc!.map(r => r.name ? `${r.name} <${r.email}>` : r.email).join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => setEditId(c.id)}
                      className={`p-1.5 rounded transition-colors ${isDark ? 'text-white/25 hover:text-white/70' : 'text-black/25 hover:text-black/70'}`}>
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => remove(c.id)}
                      className={`p-1.5 rounded transition-colors ${isDark ? 'text-white/25 hover:text-red-400' : 'text-black/25 hover:text-red-500'}`}>
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
