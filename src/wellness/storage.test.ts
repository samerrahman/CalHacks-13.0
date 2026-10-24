import assert from 'node:assert/strict';
import test from 'node:test';
import { clearCheckIn, loadCheckIn, saveCheckIn, WELLNESS_STORAGE_KEY } from './storage';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test('saves one versioned latest choice and timestamp, then clears it', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadCheckIn(storage), { entry: null, available: true });
  saveCheckIn('Calm', storage);
  const latest = saveCheckIn('Tense', storage);
  assert.ok(latest);
  assert.equal(storage.values.size, 1);
  assert.deepEqual(JSON.parse(storage.values.get(WELLNESS_STORAGE_KEY)!), {
    version: 1, choice: 'Tense', timestamp: latest.timestamp,
  });
  assert.deepEqual(loadCheckIn(storage), { entry: latest, available: true });
  assert.equal(clearCheckIn(storage), true);
  assert.deepEqual(loadCheckIn(storage), { entry: null, available: true });
});

test('ignores malformed, unsupported, and invalid saved values', () => {
  const storage = memoryStorage();
  for (const raw of [
    '{',
    JSON.stringify({ version: 2, choice: 'Calm', timestamp: new Date().toISOString() }),
    JSON.stringify({ version: 1, choice: 'Other', timestamp: new Date().toISOString() }),
    JSON.stringify({ version: 1, choice: 'Mixed', timestamp: 'not a date' }),
  ]) {
    storage.setItem(WELLNESS_STORAGE_KEY, raw);
    assert.deepEqual(loadCheckIn(storage), { entry: null, available: true });
  }
  assert.ok(saveCheckIn('Mixed', storage));
  assert.equal(loadCheckIn(storage).entry?.choice, 'Mixed');
});

test('handles unavailable and throwing local storage without throwing', () => {
  assert.deepEqual(loadCheckIn(null), { entry: null, available: false });
  assert.equal(saveCheckIn('Calm', null), null);
  assert.equal(clearCheckIn(null), false);
  const broken = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); },
  };
  assert.deepEqual(loadCheckIn(broken), { entry: null, available: false });
  assert.equal(saveCheckIn('Calm', broken), null);
  assert.equal(clearCheckIn(broken), false);
});
