export type Feeling = 'Calm' | 'Mixed' | 'Tense';

export interface CheckIn {
  choice: Feeling;
  timestamp: string;
}

export const WELLNESS_STORAGE_KEY = 'night-relay.wellness.check-in.v1';

type WellnessStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): WellnessStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isCheckIn(value: unknown): value is CheckIn & { version: 1 } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1
    && (record.choice === 'Calm' || record.choice === 'Mixed' || record.choice === 'Tense')
    && typeof record.timestamp === 'string'
    && !Number.isNaN(Date.parse(record.timestamp))
    && new Date(record.timestamp).toISOString() === record.timestamp;
}

export function loadCheckIn(storage: WellnessStorage | null = browserStorage()): { entry: CheckIn | null; available: boolean } {
  if (!storage) return { entry: null, available: false };
  let raw: string | null;
  try {
    raw = storage.getItem(WELLNESS_STORAGE_KEY);
  } catch {
    return { entry: null, available: false };
  }
  if (raw === null) return { entry: null, available: true };
  try {
    const value: unknown = JSON.parse(raw);
    if (isCheckIn(value)) return { entry: { choice: value.choice, timestamp: value.timestamp }, available: true };
  } catch {
    // A malformed or older value is treated as an empty check-in.
  }
  return { entry: null, available: true };
}

export function saveCheckIn(choice: Feeling, storage: WellnessStorage | null = browserStorage()): CheckIn | null {
  if (!storage) return null;
  const entry: CheckIn = { choice, timestamp: new Date().toISOString() };
  try {
    storage.setItem(WELLNESS_STORAGE_KEY, JSON.stringify({ version: 1, ...entry }));
    return entry;
  } catch {
    return null;
  }
}

export function clearCheckIn(storage: WellnessStorage | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(WELLNESS_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
