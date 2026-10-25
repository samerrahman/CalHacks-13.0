import assert from 'node:assert/strict';
import test from 'node:test';
import { readSpectatorFear, readVitals, SPECTATOR_FEAR_HOLD_MS, spectatorFearMemory, type VitalsMemory } from '../src/ui/vitalsHold';
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

test('the spectator FEAR falls back to heart rate and holds the last accepted pulse and trend through dropouts', () => {
  const m = spectatorFearMemory(), v = (extra: Partial<Parameters<typeof readSpectatorFear>[1]> = {}) => ({ source: 'presage', pulseBpm: 84, baselineBpm: 70, trend: 'STEADY' as const, ...extra });
  assert.deepEqual(readSpectatorFear(m, v({ trend: 'ELEVATED' }), 0), { fearPct: 56, label: 'SCARED', trend: 'ELEVATED', live: true, basis: 'heart rate' });
  assert.deepEqual(readSpectatorFear(m, v({ pulseBpm: null, trend: 'UNKNOWN' }), 500), { fearPct: 56, label: 'SCARED', trend: 'ELEVATED', live: false, basis: 'heart rate' }, 'a dropout keeps the last reading');
  assert.deepEqual(readSpectatorFear(m, v({ pulseBpm: 75, trend: 'RECOVERED' }), 1000), { fearPct: 20, label: 'CALM', trend: 'RECOVERED', live: true, basis: 'heart rate' });
  assert.equal(readSpectatorFear(m, v({ source: 'simulated', pulseBpm: null, trend: 'UNKNOWN' }), 1500).fearPct, null, 'switching source clears it');
  assert.deepEqual(readSpectatorFear(spectatorFearMemory(), v({ baselineBpm: null }), 0), { fearPct: null, label: 'CALIBRATING', trend: 'STEADY', live: true, basis: null }, 'no fear before the baseline exists');
});

test("the spectator FEAR shows the player's combined camera number while it keeps arriving", () => {
  const m = spectatorFearMemory(), v = (extra: Partial<Parameters<typeof readSpectatorFear>[1]> = {}) => ({ source: 'presage', pulseBpm: 72, baselineBpm: 72, trend: 'STEADY' as const, fearPct: 64, ...extra });
  assert.deepEqual(readSpectatorFear(m, v(), 0), { fearPct: 64, label: 'SCARED', trend: 'STEADY', live: true, basis: 'camera' }, 'the shared number wins over the calm heart rate');
  assert.deepEqual(readSpectatorFear(m, v({ fearPct: null, pulseBpm: null, trend: 'UNKNOWN' }), SPECTATOR_FEAR_HOLD_MS), { fearPct: 64, label: 'SCARED', trend: 'STEADY', live: false, basis: 'camera' }, 'held, marked not live, through a short dropout');
  assert.deepEqual(readSpectatorFear(m, v({ fearPct: null }), SPECTATOR_FEAR_HOLD_MS + 1), { fearPct: 0, label: 'CALM', trend: 'STEADY', live: true, basis: 'heart rate' }, 'once shared fear stops arriving, the live heart rate takes over instead of a frozen number');
  assert.equal(readSpectatorFear(m, v({ fearPct: 30 }), SPECTATOR_FEAR_HOLD_MS + 2).label, 'TENSE', 'and the camera number returns when it does');
  assert.equal(readSpectatorFear(spectatorFearMemory(), v({ baselineBpm: null, fearPct: 12 }), 0).fearPct, 12, 'needs no baseline');
  assert.equal(readSpectatorFear(m, v({ source: 'simulated', fearPct: null }), SPECTATOR_FEAR_HOLD_MS + 3).basis, 'heart rate', 'a new source starts over');
});
