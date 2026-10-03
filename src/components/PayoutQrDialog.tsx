import React, { useMemo } from 'react';
import { Check, X } from 'lucide-react';
import { useStore } from '../store';
import { fmtChf } from '../expenses';
import { payoutQr } from '../swissqr';

const fmtDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

// Swiss QR code for paying an amount from the company to the payee's private account
export default function PayoutQrDialog({ title, amount, message, paidAt, onClose, onPaid }: {
  title: string;
  amount: number;
  message: string;
  paidAt?: string;
  onClose: () => void;
  onPaid?: () => void;
}) {
  const { company } = useStore();
  const qr = useMemo(() => payoutQr(company, amount, message), [company, amount, message]);
  const row = (label: string, value: React.ReactNode) => (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-black/45">{label}</div>
      <div className="text-xs text-black">{value}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div className="bg-white text-black rounded-lg shadow-2xl w-full max-w-[560px] p-6" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-[11px] text-black/50">Mit der E-Banking-App der Firma scannen</div>
          </div>
          <button onClick={onClose} className="p-1 rounded text-black/40 hover:text-black"><X size={14} /></button>
        </div>
        {qr.ok ? (
          <div className="flex gap-6 flex-wrap">
            <div className="flex-shrink-0" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <div className="space-y-3 min-w-0 flex-1">
              {row('Konto / Zahlbar an', <>{qr.iban}<br />{qr.creditor.name}<br />{qr.creditor.street}<br />{qr.creditor.zip} {qr.creditor.city}</>)}
              {row('Betrag', <span className="font-semibold tabular-nums">CHF {fmtChf(amount)}</span>)}
              {row('Zusätzliche Informationen', message)}
              {qr.debtor && row('Zahlbar durch', <>{qr.debtor.name}<br />{qr.debtor.zip} {qr.debtor.city}</>)}
            </div>
          </div>
        ) : (
          <div className="text-xs text-red-600 py-6">{qr.reason}</div>
        )}
        <div className="flex items-center gap-2 mt-5 pt-4 border-t border-black/10">
          {paidAt ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check size={12} /> ausbezahlt am {fmtDate(paidAt)}</span>
          ) : qr.ok && onPaid ? (
            <button onClick={onPaid}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-black/15 text-black/70 hover:border-black/40 hover:text-black">
              <Check size={12} /> Als ausbezahlt markieren
            </button>
          ) : null}
          <button onClick={onClose} className="ml-auto text-xs px-4 py-1.5 rounded font-semibold bg-black text-white hover:bg-black/80">Schliessen</button>
        </div>
      </div>
    </div>
  );
}
