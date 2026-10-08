import { Client } from './types';

// Non-billable hours (intern): a fixed pseudo-client. Its entries are stored like
// any other booking (clientId "intern"), its projects get the same MRU
// suggestions (projects.json → "intern"), and it counts as working time but
// never as revenue — it has no hourly rate and is not part of `clients`.
export const INTERNAL_ID = 'intern';

export const INTERNAL_CLIENT: Client = {
  id: INTERNAL_ID,
  uid: '',
  name: 'Intern',
  address: { street: '', zip: '', city: '', country: 'CH' },
  contact: { name: '', email: '', phone: '' },
  color: 'internal',
};

/** The clients plus the internal pseudo-client (last), for booking, calendar, report and working time. */
export const withInternal = (clients: Client[]): Client[] => [...clients, INTERNAL_CLIENT];
