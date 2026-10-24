import assert from 'node:assert/strict';
import test from 'node:test';
import { readVitals, type VitalsMemory } from '../src/ui/vitalsHold';
import type { SensorDiagnostics, SensorView } from '../src/sensing/types';

const memory = (): VitalsMemory => ({ source: null, pulse: null, breathing: null, trend: 'UNKNOWN' });
const breathing = (bpm: number | null, eligible: boolean): Partial<SensorView> => ({ diagnostics: { breathing: { bpm, eligible } } as unknown as SensorDiagnostics });
const view = (extra: Partial<SensorView> = {}): SensorView => ({ source: 'presage', status: 'ready', trend: 'STEADY', quality: 'accepted', hint: '', baselineBpm: 70, pulseBpm: 84, ageMs: 400, acceptedSeconds: 30, canContinueManual: true, sampleAtMs: 1, captureSegment: 2, ...extra });
const dropped: Partial<SensorView> = { quality: 'rejected', pulseBpm: null, trend: 'UNKNOWN', sampleAtMs: null };

test('when the estimate drops out the readout keeps the last accepted pulse and breathing', () => {
  const m = memory();
  assert.deepEqual(readVitals(m, view(breathing(16, true))), { pulse: 84, breathing: 16, trend: 'STEADY', pulseLive: true, breathingLive: true });
  assert.deepEqual(readVitals(m, view({ ...dropped, ...breathing(9, false) })), { pulse: 84, breathing: 16, trend: 'STEADY', pulseLive: false, breathingLive: false });
  for (const extra of [{ ageMs: 60_000 }, { status: 'paused' }, { status: 'starting' }, { captureSegment: 3 }, { status: 'unavailable' }] as Partial<SensorView>[])
    assert.deepEqual([readVitals(m, view({ ...dropped, ...extra })).pulse, readVitals(m, view({ ...dropped, ...extra })).breathing], [84, 16], `kept through ${JSON.stringify(extra)}`);
  assert.deepEqual(readVitals(m, view({ pulseBpm: 79, ...breathing(14, true) })), { pulse: 79, breathing: 14, trend: 'STEADY', pulseLive: true, breathingLive: true });
});

test('before any reading the calibrated baseline stands in for pulse; nothing is invented for breathing', () => {
  assert.deepEqual(readVitals(memory(), view(dropped)), { pulse: 70, breathing: null, trend: 'UNKNOWN', pulseLive: false, breathingLive: false });
  assert.equal(readVitals(memory(), view({ ...dropped, baselineBpm: null, status: 'calibrating' })).pulse, null);
});

test('rejected or uncalibrated samples never update the memory, and changing source clears it', () => {
  const m = memory();
  readVitals(m, view());
  assert.equal(readVitals(m, view({ quality: 'rejected', pulseBpm: 101 })).pulse, 84);
  assert.equal(readVitals(m, view({ status: 'starting', pulseBpm: 99 })).pulse, 84);
  assert.equal(readVitals(m, view({ source: 'manual', status: 'manual' })).pulse, null);
  assert.equal(readVitals(m, view(dropped)).pulse, 70, 'a new camera session starts from the baseline, not the old reading');
  readVitals(m, view({ source: 'simulated', pulseBpm: 90 }));
  assert.equal(readVitals(m, view(dropped)).pulse, 70);
});
