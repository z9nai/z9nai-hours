export interface Address {
  street: string;
  zip: string;
  city: string;
  country: string;
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

export interface Client {
  id: string;
  uid: string;
  name: string;
  address: Address;
  contact: ContactPerson;
  color: string; // key from CLIENT_COLORS palette
}

export interface TimeEntry {
  id: string;
  clientId: string;
  date: string;       // ISO date: "2024-06-16"
  startTime: string;  // "HH:MM" in 15-min steps
  endTime: string;    // "HH:MM" in 15-min steps
  description: string;
  project: string;
}

export type View = 'calendar' | 'clients' | 'company';

export interface MonthData {
  year: number;
  month: number; // 1-12
  entries: TimeEntry[];
}
