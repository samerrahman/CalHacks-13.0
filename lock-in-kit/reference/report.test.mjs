import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedBins, buildPulseReport } from './report.mjs';
const sample = (second, bpm = 70, extras = {}) => ({ capturedAtMs: second * 1000, gameMs: second * 1000, segment: 0, bpm, source: 'presage', accepted: true, ...extras });
const event = { id: 'run:e1', type: 'BLACKOUT', capturedAtMs: 15000, gameMs: 15000, segment: 0 };
const input = { recordingConsent: true, source: 'presage', baselineBpm: 70 };

test('report is unrecorded without separate consent and does not expose supplied samples', () => {
  const r = buildPulseReport({ ...input, recordingConsent: false, samples: [sample(1, 90)] });
  assert.equal(r.status, 'unrecorded'); assert.deepEqual(r.timeline, []); assert.equal(r.highestBpm, null);
});
test('recording excludes rejected, mixed-source and unsupported values and uses per-second medians', () => {
  const bins = acceptedBins([sample(1, 70), sample(1.3, 74), sample(2, 109, { accepted: false }), sample(3, 60, { source: 'simulated' }), sample(4, 180)], 'presage');
  assert.equal(bins.length, 1); assert.equal(bins[0].bpm, 72);
});
test('supported event increase and later return are descriptive and clusters remain explicit', () => {
  const samples = Array.from({ length: 76 }, (_, s) => sample(s, s >= 20 && s <= 30 ? 84 : 70));
  const r = buildPulseReport({ ...input, samples, events: [event, { ...event, id: 'run:e2', type: 'SCARE', capturedAtMs: 17000, gameMs: 17000 }] });
  assert.equal(r.highestBpm, 84); assert.equal(r.largestIncrease.deltaBpm, 14); assert.equal(r.largestIncrease.clustered, true);
  assert.deepEqual(r.largestIncrease.associatedEventIds, ['run:e1','run:e2']); assert.ok(r.recovery[0].observed); assert.match(r.note, /association/);
});
test('large gaps and new pause segments break timeline and cannot fabricate an event response', () => {
  const samples = [sample(1), sample(2), sample(25, 90), sample(26, 90), sample(27, 90, { segment: 1 })];
  const r = buildPulseReport({ ...input, samples, events: [event] });
  assert.equal(r.largestIncrease, null); assert.equal(r.timeline[2].breakBefore, true); assert.equal(r.timeline[3].breakBefore, false); assert.equal(r.timeline[4].breakBefore, true);
});
test('simulated recording is never labeled live and unavailable source has no statistics', () => {
  assert.equal(buildPulseReport({ ...input, source: 'simulated', samples: [sample(1, 80, { source: 'simulated' })] }).status, 'simulated');
  assert.equal(buildPulseReport({ ...input, source: 'manual', samples: [sample(1)] }).status, 'unrecorded');
});
