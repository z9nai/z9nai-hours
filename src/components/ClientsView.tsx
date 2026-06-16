import React, { useState } from 'react';
import { Plus, Pencil, X } from 'lucide-react';
import { Client, Address, ContactPerson } from '../types';
import { useStore } from '../store';

const EMPTY_ADDR: Address = { street: '', zip: '', city: '', country: 'CH' };
const EMPTY_CONTACT: ContactPerson = { name: '', email: '', phone: '' };
const EMPTY_CLIENT: Omit<Client, 'id'> = { uid: '', name: '', address: { ...EMPTY_ADDR }, contact: { ...EMPTY_CONTACT } };

function genId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function Field({ label, value, onChange, placeholder, isDark }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  isDark: boolean;
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
      <div className={`text-[10px] uppercase tracking-wider pt-1 ${labelCls}`}>Ansprechperson</div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Name" value={f.contact.name} onChange={v => setContact('name', v)} isDark={isDark} />
        <Field label="E-Mail" value={f.contact.email} onChange={v => setContact('email', v)} isDark={isDark} />
        <Field label="Telefon" value={f.contact.phone} onChange={v => setContact('phone', v)} isDark={isDark} />
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel}
          className={`flex-1 text-xs py-2 rounded border transition-colors ${isDark ? 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/70' : 'border-black/15 text-black/40 hover:border-black/30 hover:text-black/70'}`}>
          Abbrechen
        </button>
        <button onClick={() => f.name && onSave(f)}
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
        {clients.map(c => (
          <div key={c.id} className={`rounded-xl border ${border} ${isDark ? 'bg-white/2' : 'bg-black/2'}`}>
            {editId === c.id ? (
              <div className="p-4">
                <ClientForm initial={c} onSave={d => update(c.id, d)} onCancel={() => setEditId(null)} isDark={isDark} />
              </div>
            ) : (
              <div className="px-4 py-3 flex items-start justify-between gap-4">
                <div>
                  <div className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-black'}`}>{c.name}</div>
                  <div className={`text-[11px] mt-0.5 ${textMuted}`}>
                    {c.uid && <span className="mr-3">{c.uid}</span>}
                    {c.address.street && <span>{c.address.street}, {c.address.zip} {c.address.city}</span>}
                  </div>
                  {c.contact.name && (
                    <div className={`text-[11px] mt-1 ${textMuted}`}>
                      {c.contact.name}{c.contact.email && ` · ${c.contact.email}`}{c.contact.phone && ` · ${c.contact.phone}`}
                    </div>
                  )}
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
        ))}
      </div>
    </div>
  );
}
