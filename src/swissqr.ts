// Swiss QR payment code (QR-Rechnung, SPC 0200) for paying out expenses:
// the company pays the amount to the private account of the payee.
import QRCode from 'qrcode';
import { Company } from './types';

export interface QrParty {
  name: string;
  street: string; // "Sonnenweg 23a" → split into street and building number
  zip: string;
  city: string;
  country: string;
}

export const normIban = (s: string) => s.replace(/\s+/g, '').toUpperCase();
export const fmtIban = (s: string) => normIban(s).replace(/(.{4})/g, '$1 ').trim();

export function ibanValid(raw: string): boolean {
  const iban = normIban(raw);
  if (!/^(CH|LI)\d{2}[0-9A-Z]{17}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

// QR-IBANs (IID 30000–31999) need a QR reference and cannot be used here
export const isQrIban = (raw: string) => {
  const iid = Number(normIban(raw).slice(4, 9));
  return iid >= 30000 && iid <= 31999;
};

function splitStreet(s: string): [string, string] {
  const m = s.trim().match(/^(.*?)\s+(\d+\s?[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?)$/);
  return m ? [m[1], m[2].replace(/\s/g, '')] : [s.trim(), ''];
}

const cut = (s: string, n: number) => s.replace(/[\r\n]+/g, ' ').trim().slice(0, n);

function partyLines(p: QrParty | null): string[] {
  if (!p) return ['', '', '', '', '', '', ''];
  const [street, nr] = splitStreet(p.street);
  return ['S', cut(p.name, 70), cut(street, 70), cut(nr, 16), cut(p.zip, 16), cut(p.city, 35), (p.country || 'CH').toUpperCase().slice(0, 2)];
}

export function qrPayload({ iban, creditor, debtor, amount, message }: {
  iban: string; creditor: QrParty; debtor: QrParty | null; amount: number; message: string;
}): string {
  return [
    'SPC', '0200', '1',
    normIban(iban),
    ...partyLines(creditor),
    '', '', '', '', '', '', '',           // ultimate creditor (reserved)
    amount.toFixed(2), 'CHF',
    ...partyLines(debtor),
    'NON', '',                            // no reference (regular IBAN)
    cut(message, 140),
    'EPD',
  ].join('\n');
}

// QR code as SVG markup with the Swiss cross in the centre (error correction M)
export function qrSvg(payload: string, sizePx = 220): string {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) d += `M${c} ${r}h1v1h-1z`;
  }
  // Cross: 7 mm on a 46 mm code → 7/46 of the width, plus a white margin
  const s = (n * 7) / 46, o = (n - s) / 2, m = s * 0.08;
  const u = s / 32; // Swiss flag grid: arms 6 wide, 20 long
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges">
<rect width="${n}" height="${n}" fill="#fff"/>
<path d="${d}" fill="#000"/>
<rect x="${o - m}" y="${o - m}" width="${s + 2 * m}" height="${s + 2 * m}" fill="#fff"/>
<rect x="${o}" y="${o}" width="${s}" height="${s}" fill="#000"/>
<rect x="${o + 13 * u}" y="${o + 6 * u}" width="${6 * u}" height="${20 * u}" fill="#fff"/>
<rect x="${o + 6 * u}" y="${o + 13 * u}" width="${20 * u}" height="${6 * u}" fill="#fff"/>
</svg>`;
}

// Everything needed to show the payout QR for an amount, or why it's not possible
export function payoutQr(company: Company, amount: number, message: string):
  { ok: true; svg: string; iban: string; creditor: QrParty; debtor: QrParty | null } | { ok: false; reason: string } {
  const p = company.payee;
  if (!p?.iban || !p.name) return { ok: false, reason: 'Kein Privatkonto hinterlegt (Firma → Spesen).' };
  if (!ibanValid(p.iban)) return { ok: false, reason: 'Die hinterlegte IBAN ist ungültig.' };
  if (isQrIban(p.iban)) return { ok: false, reason: 'Eine QR-IBAN kann hier nicht verwendet werden – bitte die normale IBAN hinterlegen.' };
  if (!(amount > 0)) return { ok: false, reason: 'Kein Betrag zum Auszahlen.' };
  const creditor: QrParty = {
    name: p.name,
    street: p.street || company.address.street,
    zip: p.zip || company.address.zip,
    city: p.city || company.address.city,
    country: company.address.country || 'CH',
  };
  if (!creditor.zip || !creditor.city) return { ok: false, reason: 'Adresse des Privatkontos fehlt (PLZ / Ort).' };
  const debtor: QrParty | null = company.name && company.address.zip && company.address.city
    ? { name: company.name, street: company.address.street, zip: company.address.zip, city: company.address.city, country: company.address.country || 'CH' }
    : null;
  const svg = qrSvg(qrPayload({ iban: p.iban, creditor, debtor, amount, message }));
  return { ok: true, svg, iban: fmtIban(p.iban), creditor, debtor };
}
