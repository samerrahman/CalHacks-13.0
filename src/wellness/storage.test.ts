import assert from 'node:assert/strict';
import test from 'node:test';
import { appendCheckIn, clearJournal, JOURNAL_LIMIT, JOURNAL_STORAGE_KEY, loadJournal, WELLNESS_STORAGE_KEY } from './storage';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test('migrates the prior single answer before adding to the journal', () => {
  const storage = memoryStorage();
  const timestamp = '2026-10-23T12:00:00.000Z';
  storage.setItem(WELLNESS_STORAGE_KEY, JSON.stringify({ version: 1, choice: 'Calm', timestamp }));
  assert.deepEqual(loadJournal(storage), { entries: [{ choice: 'Calm', timestamp }], available: true });
  assert.equal(storage.values.has(WELLNESS_STORAGE_KEY), false);
  assert.deepEqual(JSON.parse(storage.values.get(JOURNAL_STORAGE_KEY)!), {
    version: 2, entries: [{ choice: 'Calm', timestamp }],
  });
  const next = appendCheckIn('Tense', storage);
  assert.equal(next?.entries[0].choice, 'Tense');
  assert.deepEqual(next?.entries[1], { choice: 'Calm', timestamp });
});

test('keeps only the ten most recent valid answers', () => {
  const storage = memoryStorage();
  const entries = Array.from({ length: JOURNAL_LIMIT + 3 }, (_, i) => ({
    choice: 'Mixed', timestamp: new Date(Date.UTC(2026, 9, 23, 0, i)).toISOString(),
  }));
  storage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify({ version: 2, entries }));
  const loaded = loadJournal(storage);
  assert.equal(loaded.entries.length, JOURNAL_LIMIT);
  assert.equal(loaded.entries[0].timestamp, entries.at(-1)?.timestamp);
  assert.equal(loaded.entries.at(-1)?.timestamp, entries[3].timestamp);
  const next = appendCheckIn('Calm', storage);
  assert.equal(next?.entries.length, JOURNAL_LIMIT);
  assert.equal(next?.entries[0].choice, 'Calm');
  assert.equal(JSON.parse(storage.values.get(JOURNAL_STORAGE_KEY)!).entries.length, JOURNAL_LIMIT);
});

test('clears current and legacy keys so old answers cannot reappear', () => {
  const storage = memoryStorage();
  storage.setItem(WELLNESS_STORAGE_KEY, '{stale');
  assert.ok(appendCheckIn('Mixed', storage));
  assert.equal(clearJournal(storage), true);
  assert.equal(storage.values.size, 0);
  assert.deepEqual(loadJournal(storage), { entries: [], available: true });
});

test('ignores malformed data and handles blocked storage', () => {
  const storage = memoryStorage();
  storage.setItem(JOURNAL_STORAGE_KEY, '{');
  storage.setItem(WELLNESS_STORAGE_KEY, '{');
  assert.deepEqual(loadJournal(storage), { entries: [], available: true });
  assert.ok(appendCheckIn('Calm', storage));
  assert.deepEqual(loadJournal(null), { entries: [], available: false });
  assert.equal(appendCheckIn('Calm', null), null);
  assert.equal(clearJournal(null), false);
  const blocked = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); },
  };
  assert.deepEqual(loadJournal(blocked), { entries: [], available: false });
  assert.equal(appendCheckIn('Calm', blocked), null);
  assert.equal(clearJournal(blocked), false);
});
