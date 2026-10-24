import assert from 'node:assert/strict';
import test from 'node:test';
import { holdable, holdVital, VITALS_HOLD_MS } from '../src/ui/vitalsHold';
import type { SensorView } from '../src/sensing/types';

const view = (extra: Partial<SensorView> = {}): SensorView => ({ source: 'presage', status: 'ready', trend: 'UNKNOWN', quality: 'rejected', hint: '', baselineBpm: 70, pulseBpm: null, ageMs: 400, acceptedSeconds: 30, canContinueManual: true, sampleAtMs: null, captureSegment: 2, ...extra });

test('a brief rejected reading keeps the last accepted value visible and labelled as held', () => {
  const live = holdVital(null, 84, 1000, 'presage:2', true);
  assert.deepEqual([live.value, live.heldMs], [84, null]);
  const held = holdVital(live.held, null, 4000, 'presage:2', true);
  assert.deepEqual([held.value, held.heldMs], [84, 3000]);
  const resumed = holdVital(held.held, 79, 5000, 'presage:2', true);
  assert.deepEqual([resumed.value, resumed.heldMs, resumed.held?.at], [79, null, 5000]);
});

test('the hold expires, never crosses captures and stops when the stream goes stale', () => {
  const live = holdVital(null, 84, 0, 'presage:2', true).held;
  assert.equal(holdVital(live, null, VITALS_HOLD_MS + 1, 'presage:2', true).value, null);
  assert.equal(holdVital(live, null, 1000, 'presage:3', true).value, null, 'a restarted capture never shows an old value');
  assert.equal(holdVital(live, null, 1000, 'presage:2', false).value, null);
  assert.equal(holdable(view()), true);
  assert.equal(holdable(view({ ageMs: 6000 })), false, 'no new estimates for over five seconds is stale, not a blip');
  assert.equal(holdable(view({ status: 'paused' })), false);
  assert.equal(holdable(view({ status: 'unavailable' })), false);
  assert.equal(holdable(view({ ageMs: null })), false);
});
