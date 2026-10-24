export type Feeling = 'Calm' | 'Mixed' | 'Tense';

export interface CheckIn {
  choice: Feeling;
  timestamp: string;
}

export interface Journal {
  entries: CheckIn[];
  available: boolean;
}

export const WELLNESS_STORAGE_KEY = 'night-relay.wellness.check-in.v1';
export const JOURNAL_STORAGE_KEY = 'night-relay.wellness.journal.v2';
export const JOURNAL_LIMIT = 10;

type WellnessStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): WellnessStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isCheckIn(value: unknown): value is CheckIn {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (record.choice === 'Calm' || record.choice === 'Mixed' || record.choice === 'Tense')
    && typeof record.timestamp === 'string'
    && !Number.isNaN(Date.parse(record.timestamp))
    && new Date(record.timestamp).toISOString() === record.timestamp;
}

function parseJournal(raw: string | null): CheckIn[] | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    if (record.version !== 2 || !Array.isArray(record.entries)) return null;
    return record.entries.filter(isCheckIn)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, JOURNAL_LIMIT);
  } catch {
    return null;
  }
}

function parseLegacy(raw: string | null): CheckIn | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    if (record.version === 1 && isCheckIn(record)) {
      return { choice: record.choice, timestamp: record.timestamp };
    }
  } catch {
    // Corrupt local data must not prevent a new journal entry.
  }
  return null;
}

function encode(entries: CheckIn[]): string {
  return JSON.stringify({ version: 2, entries });
}

export function loadJournal(storage: WellnessStorage | null = browserStorage()): Journal {
  if (!storage) return { entries: [], available: false };
  let current: string | null;
  let old: string | null;
  try {
    current = storage.getItem(JOURNAL_STORAGE_KEY);
    old = storage.getItem(WELLNESS_STORAGE_KEY);
  } catch {
    return { entries: [], available: false };
  }
  const entries = parseJournal(current);
  if (entries !== null) return { entries, available: true };
  const legacy = parseLegacy(old);
  if (!legacy) return { entries: [], available: true };
  try {
    storage.setItem(JOURNAL_STORAGE_KEY, encode([legacy]));
  } catch {
    return { entries: [legacy], available: false };
  }
  try { storage.removeItem(WELLNESS_STORAGE_KEY); } catch { /* v2 is already saved. */ }
  return { entries: [legacy], available: true };
}

export function appendCheckIn(choice: Feeling, storage: WellnessStorage | null = browserStorage()): Journal | null {
  const journal = loadJournal(storage);
  if (!storage || !journal.available) return null;
  const entry: CheckIn = { choice, timestamp: new Date().toISOString() };
  const entries = [entry, ...journal.entries].slice(0, JOURNAL_LIMIT);
  try {
    storage.setItem(JOURNAL_STORAGE_KEY, encode(entries));
    return { entries, available: true };
  } catch {
    return null;
  }
}

export function clearJournal(storage: WellnessStorage | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(WELLNESS_STORAGE_KEY);
    storage.removeItem(JOURNAL_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
