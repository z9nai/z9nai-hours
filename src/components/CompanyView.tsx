import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Company } from '../types';
import { useStore } from '../store';
import { DEFAULT_KM_RATE } from '../expenses';

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

export default function CompanyView() {
  const { company, setCompany, isDark } = useStore();
  const [f, setF] = useState<Company>(company);
  const [saved, setSaved] = useState(false);

  // Kept as text while typing so decimals like "8.4" can be entered
  const [hoursStr, setHoursStr] = useState('');
  const [kmRateStr, setKmRateStr] = useState('');
  const [allowanceStr, setAllowanceStr] = useState('');
  useEffect(() => {
    setF(company);
    setHoursStr(company.hoursPerDay != null ? String(company.hoursPerDay) : '');
    setKmRateStr(company.kmRate != null ? String(company.kmRate) : '');
    setAllowanceStr(company.expenseAllowance != null ? String(company.expenseAllowance) : '');
  }, [company]);

  const setAddr = (k: keyof Company['address'], v: string) =>
    setF(prev => ({ ...prev, address: { ...prev.address, [k]: v } }));

  const num = (str: string) => {
    const t = str.trim().replace(/['’\s]/g, '').replace(',', '.');
    return t === '' ? undefined : Math.max(0, Number(t) || 0);
  };

  const save = async () => {
    await setCompany({
      ...f,
      hoursPerDay: num(hoursStr),
      kmRate: num(kmRateStr),
      expenseAllowance: num(allowanceStr),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const btnPrimary = isDark ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/80';

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className={`text-sm font-semibold uppercase tracking-widest mb-6 ${isDark ? 'text-white/50' : 'text-black/50'}`}>Eigene Firma</h2>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Firmenname" value={f.name} onChange={v => setF(p => ({ ...p, name: v }))} placeholder="Meine AG" isDark={isDark} />
          <Field label="UID" value={f.uid} onChange={v => setF(p => ({ ...p, uid: v }))} placeholder="CHE-123.456.789" isDark={isDark} />
        </div>
        <Field label="IBAN" value={f.iban} onChange={v => setF(p => ({ ...p, iban: v }))} placeholder="CH93 0076 2011 6238 5295 7" isDark={isDark} />
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="E-Mail" value={f.email} onChange={v => setF(p => ({ ...p, email: v }))} placeholder="info@firma.ch" isDark={isDark} />
          <Field label="Telefon" value={f.phone} onChange={v => setF(p => ({ ...p, phone: v }))} placeholder="+41 44 000 00 00" isDark={isDark} />
        </div>

        <div className={`text-[10px] uppercase tracking-wider pt-2 ${isDark ? 'text-white/40' : 'text-black/40'}`}>Arbeitszeit</div>
        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <label className={`block text-[10px] uppercase tracking-wider mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>Firmenstart</label>
            <input type="date" value={f.startDate ?? ''}
              onChange={e => setF(p => ({ ...p, startDate: e.target.value || undefined }))}
              className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors ${
                isDark ? 'bg-white/5 border-white/10 text-white focus:border-white/30 [color-scheme:dark]' : 'bg-black/5 border-black/10 text-black focus:border-black/30'
              }`} />
          </div>
          <Field label="Stunden pro Arbeitstag" value={hoursStr} onChange={setHoursStr} placeholder="8.4" isDark={isDark} />
        </div>
        <p className={`text-[11px] -mt-2 ${isDark ? 'text-white/35' : 'text-black/35'}`}>
          Vor dem Firmenstart werden weder Soll-Arbeitszeit noch Umsatzziele gerechnet.
          Soll pro Arbeitstag (Mo–Fr); Ferien, Krank und Feiertage reduzieren das Soll.
        </p>

        <div className={`text-[10px] uppercase tracking-wider pt-2 ${isDark ? 'text-white/40' : 'text-black/40'}`}>Spesen</div>
        <div className="grid grid-cols-3 gap-3 items-end">
          <Field label="Kilometersatz (CHF/km)" value={kmRateStr} onChange={setKmRateStr} placeholder={String(DEFAULT_KM_RATE)} isDark={isDark} />
          <Field label="Pauschale / Monat (CHF)" value={allowanceStr} onChange={setAllowanceStr} placeholder="600" isDark={isDark} />
          <div>
            <label className={`block text-[10px] uppercase tracking-wider mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>Pauschale ab</label>
            <input type="month" value={f.expenseAllowanceFrom ?? ''}
              onChange={e => setF(p => ({ ...p, expenseAllowanceFrom: e.target.value || undefined }))}
              className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors ${
                isDark ? 'bg-white/5 border-white/10 text-white focus:border-white/30 [color-scheme:dark]' : 'bg-black/5 border-black/10 text-black focus:border-black/30'
              }`} />
          </div>
        </div>
        <p className={`text-[11px] -mt-2 ${isDark ? 'text-white/35' : 'text-black/35'}`}>
          Der Kilometersatz wird bei jeder neuen Autofahrt übernommen; bestehende Fahrten behalten ihren Satz.
          Ausbezahlte Monate behalten die Pauschale, mit der sie abgeschlossen wurden.
        </p>

        <div className="pt-2">
          <button onClick={save}
            className={`flex items-center gap-2 text-xs px-4 py-2 rounded font-semibold transition-all ${btnPrimary}`}>
            {saved ? <><Check size={12} /> Gespeichert</> : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}
