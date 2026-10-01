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
