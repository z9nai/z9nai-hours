export interface Address {
  street: string;
  zip: string;
  city: string;
  country: string;
}

export interface ExtraFieldConfig {
  enabled: boolean;
  label: string;
}

export interface Company {
  name: string;
  uid: string;
  iban: string;
  address: Address;
  email: string;
  phone: string;
  hoursPerDay?: number; // target working hours per working day (Arbeitszeit)
  startDate?: string;   // ISO date the company started; nothing before it is evaluated
  kmRate?: number;            // CHF per km for car trips (Spesen)
  expenseAllowance?: number;  // monthly lump-sum expense allowance (Pauschalspesen) in CHF
  expenseAllowanceFrom?: string; // "YYYY-MM" the allowance applies from
  payee?: Payee;              // private account expenses are paid out to (Swiss QR code)
}

export interface Payee {
  name: string;
  iban: string;
  street: string; // empty → company address
  zip: string;
  city: string;
}

export interface ContactPerson {
  name: string;
  email: string;
  phone: string;
}

export interface CcRecipient {
  name: string;
  email: string;
}

export interface Quota {
  hours: number; // budget in hours for the period (decimal, e.g. 733.33)
  from: string;  // ISO date, period start
  to: string;    // ISO date, period end
}

export interface Client {
  id: string;
  uid: string;
  name: string;
  address: Address;
  contact: ContactPerson;
  color: string; // key from CLIENT_COLORS palette
  hourlyRate?: number; // CHF per hour
  cc?: CcRecipient[]; // additional invoice recipients (CC)
  quota?: Quota; // hour budget (Kostendach / Kontingent)
  extraField?: ExtraFieldConfig; // optional additional entry field (configurable label)
  descriptionRequired?: boolean; // entries must have a description
  revenueTarget?: number; // monthly revenue target in CHF
}

export interface TimeEntry {
  id: string;
  clientId: string;
  date: string;       // ISO date: "2024-06-16"
  startTime: string;  // "HH:MM" in 15-min steps
  endTime: string;    // "HH:MM" in 15-min steps
  description: string;
  project: string;
  extra?: string;     // value of the company-configurable extra field
}

export type View = 'calendar' | 'clients' | 'company';

export interface MonthData {
  year: number;
  month: number; // 1-12
  entries: TimeEntry[];
}

export type AbsenceType = 'ferien' | 'krank' | 'feiertag';

export interface Absence {
  type: AbsenceType;
  half?: boolean; // half day
}

export type ExpenseKind = 'auto' | 'bahn' | 'other';

export interface Expense {
  id: string;
  date: string;          // ISO date
  kind: ExpenseKind;
  clientId?: string;     // optional client the expense belongs to
  purpose: string;       // Zweck
  from?: string;         // auto: start
  to?: string;           // auto: destination
  km?: number;           // auto: distance
  rate?: number;         // auto: CHF/km at the time of entry
  route?: string;        // bahn: Strecke
  art?: string;          // other: Verpflegung Mittag, Übernachtung, …
  amount?: number;       // bahn / other: CHF (auto is km × rate)
  receipts?: string[];   // paths relative to the data directory (belege/…)
  receiptFiled?: boolean; // receipt kept elsewhere (paper, imported "Beleg abgelegt")
}

export interface ExpenseMonth {
  paidAt?: string;       // ISO date the month was paid out; locks its expenses
  allowance?: number;    // Pauschale snapshot taken when marked as paid
}

export interface ExpenseData {
  expenses: Expense[];
  months: Record<string, ExpenseMonth>; // "YYYY-MM" → status
}
