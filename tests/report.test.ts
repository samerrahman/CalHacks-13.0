import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedBins, buildPulseReport, type PulseSample, type PulseEvent, type ReportInput } from '../src/report/analysis';
const sample = (second: number, bpm = 70, extras: Partial<PulseSample> = {}): PulseSample => ({ capturedAtMs: second * 1000, gameMs: second * 1000, segment: 0, bpm, source: 'presage', accepted: true, ...extras });
const event: PulseEvent = { id: 'run:e1', type: 'BLACKOUT', capturedAtMs: 15000, gameMs: 15000, segment: 0 };
const input: ReportInput = { recordingConsent: true, source: 'presage', baselineBpm: 70 };
const supported = () => Array.from({ length: 76 }, (_, second) => sample(second, second >= 20 && second <= 30 ? 84 : 70));

test('no report consent returns no pulse values, markers, or derived statistics', () => {
  const report = buildPulseReport({ ...input, recordingConsent: false, samples: supported(), events: [event] });
  assert.deepEqual(report, { status: 'unrecorded', timeline: [], markers: [], baselineBpm: null, highestBpm: null, largestIncrease: null, recovery: [] });
});
test('quality, supported range and exact source gate bins; maxima use one-second medians', () => {
  const samples = [sample(1, 70), sample(1.1, 100), sample(1.3, 72), sample(2, 109, { accepted: false }), sample(3, 105, { source: 'simulated' }), sample(4, 180), sample(5, NaN)];
  const bins = acceptedBins(samples, 'presage');
  assert.equal(bins.length, 1);
  assert.equal(bins[0].bpm, 72);
  assert.equal(buildPulseReport({ ...input, samples }).highestBpm, 72);
  assert.equal(acceptedBins(samples.map(row => ({ ...row, source: 'manual' })), 'manual').length, 0);
});
test('supported observed increase and return retain overlapping event ambiguity', () => {
  const second: PulseEvent = { ...event, id: 'run:e2', type: 'SCARE', capturedAtMs: 17000, gameMs: 17000 };
  const report = buildPulseReport({ ...input, samples: supported(), events: [event, second] });
  assert.equal(report.status, 'recorded-live');
  assert.equal(report.highestBpm, 84);
  assert.equal(report.largestIncrease?.deltaBpm, 14);
  assert.equal(report.largestIncrease?.clustered, true);
  assert.deepEqual(report.largestIncrease?.associatedEventIds, ['run:e1', 'run:e2']);
  assert.deepEqual(report.recovery[0], { eventId: event.id, elapsedSeconds: 28, observed: true });
  assert.match(report.note ?? '', /association only/);
});
test('missing data at either interval edge cannot fabricate a supported event response', () => {
  // Five dense pre-event bins ending six seconds before the event do not cover the window.
  const missingPreTail = supported().filter(row => row.capturedAtMs <= 9000 || row.capturedAtMs >= 15000);
  assert.equal(buildPulseReport({ ...input, samples: missingPreTail, events: [event] }).largestIncrease, null);
  // Ten dense post-event bins followed by eleven missing seconds are also insufficient.
  const missingPostTail = supported().filter(row => row.capturedAtMs < 30000 || row.capturedAtMs > 40000);
  assert.equal(buildPulseReport({ ...input, samples: missingPostTail, events: [event] }).largestIncrease, null);
});
test('internal gaps and capture/pause segments break lines and block comparisons across the gap', () => {
  const sparse = [sample(1), sample(2), sample(25, 90), sample(26, 90), sample(27, 90, { segment: 1 })];
  const report = buildPulseReport({ ...input, samples: sparse, events: [event] });
  assert.equal(report.largestIncrease, null);
  assert.deepEqual(report.timeline.map(row => row.breakBefore), [true, false, true, false, true]);
  const split = supported().map(row => ({ ...row, segment: row.capturedAtMs < 18000 ? 0 : 1 }));
  assert.equal(buildPulseReport({ ...input, samples: split, events: [event] }).largestIncrease, null);
});
test('steady pulse cannot be described as a return from an unobserved excursion', () => {
  const samples = Array.from({ length: 76 }, (_, second) => sample(second, 70));
  const report = buildPulseReport({ ...input, samples, events: [event] });
  assert.equal(report.largestIncrease, null);
  assert.deepEqual(report.recovery, []);
});
test('recovery requires12s below baseline+4 and never crosses a pause or60s horizon', () => {
  const atThreshold = supported().map(row => row.capturedAtMs >= 31000 ? { ...row, bpm: 74 } : row);
  assert.equal(buildPulseReport({ ...input, samples: atThreshold, events: [event] }).recovery[0].observed, false);
  const split = supported().map(row => ({ ...row, segment: row.capturedAtMs >= 41000 ? 1 : 0 }));
  const paused = buildPulseReport({ ...input, samples: split, events: [event] });
  assert.equal(paused.largestIncrease?.deltaBpm, 14);
  assert.equal(paused.recovery[0].observed, false);
  const late = Array.from({ length: 101 }, (_, second) => sample(second, second >= 20 && second <= 70 ? 84 : 70));
  const report = buildPulseReport({ ...input, samples: late, events: [event] });
  assert.equal(report.recovery[0].elapsedSeconds, null);
});
test('insufficient peak density is excluded even when overall before/after counts suffice', () => {
  const samples = supported().filter(row => row.capturedAtMs < 20000 || row.capturedAtMs > 40000 || (row.capturedAtMs / 1000) % 2 === 0);
  const report = buildPulseReport({ ...input, samples, events: [event] });
  assert.equal(report.largestIncrease, null, 'Alternating one-second bins never support four bins in a five-second peak window');
});
test('simulated recording is visibly distinct, absent/manual never exposes live statistics', () => {
  const report = buildPulseReport({ ...input, source: 'simulated', samples: supported().map(row => ({ ...row, source: 'simulated' })), events: [event] });
  assert.equal(report.status, 'simulated');
  assert.equal(report.largestIncrease?.deltaBpm, 14);
  assert.equal(buildPulseReport({ ...input, source: 'manual', samples: supported() }).status, 'unrecorded');
  assert.equal(buildPulseReport({ ...input, samples: [] }).highestBpm, null);
});
test('invalid and duplicate marker identities cannot create chart points or artificial clusters', () => {
  const report = buildPulseReport({ ...input, samples: supported(), events: [event, { ...event }, { ...event, id: 'bad-time', capturedAtMs: -1 }, { ...event, id: 'bad-segment', segment: -1 }, { ...event, id: 'bad-game', gameMs: Infinity }, { ...event, id: 'unrelated', type: 'DIRECTOR_APPLIED' }] });
  assert.deepEqual(report.markers, [event]);
  assert.equal(report.largestIncrease?.clustered, false);
});
test('missing or invalid baseline preserves observed event comparisons but cannot invent recovery', () => {
  const report = buildPulseReport({ ...input, baselineBpm: NaN, samples: supported(), events: [event] });
  assert.equal(report.baselineBpm, null);
  assert.equal(report.largestIncrease?.deltaBpm, 14);
  assert.deepEqual(report.recovery, []);
});
