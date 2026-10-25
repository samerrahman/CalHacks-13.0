import test from 'node:test';
import assert from 'node:assert/strict';
import { Metrics, decodeMetrics } from '@smartspectra/node-sdk/messages';
import { NativeMetricStream } from '../src/sensing/nativeMetrics';
import { Baseline } from '../src/sensing/baseline';
import { acceptedPulse } from '../src/sensing/types';
import { normalizePresage } from '../src/sensing/presageSample';
import { sanitizeSensorError } from '../src/sensing/sensorError';

const epoch = 1_800_000_000_000;
const value = (time: number, bpm = 72) => ({ value: bpm, stable: true, confidence: 94, timestamp: (epoch + time) * 1000 });
const native = () => { const stream = new NativeMetricStream(); stream.processing(3); stream.validation = { code: 0, hint: 'Capture validated' }; stream.frame(true, epoch * 1000, 0); return stream; };
const decode = (data: Parameters<typeof Metrics.create>[0]) => decodeMetrics(Metrics.encode(Metrics.create(data)).finish());

test('real protobuf shape: interleaved empty and breathing-only packets preserve 30 usable pulse seconds', () => {
  const stream = native(), baseline = new Baseline();
  for (let now = 12_000; now <= 42_000; now += 1000) {
    const pulse = stream.ingest(decode({ cardio: { pulseRate: [value(now)] } }), now, epoch + now);
    assert.ok(pulse); baseline.add(pulse, now);
    assert.equal(stream.ingest(decode({}), now + 100, epoch + now + 100), null);
    assert.equal(stream.ingest(decode({ breathing: { rate: [value(now + 200, 15)] } }), now + 200, epoch + now + 200), null);
  }
  assert.equal(baseline.acceptedMs, 30_000); assert.equal(baseline.value, 72);
  assert.equal(stream.view(42_200, 'live').pulse.eligible, true);
  assert.equal(stream.view(42_200, 'live').breathing.bpm, 15);
  assert.equal(stream.metricsPackets, 93); assert.equal(stream.pulseSamples, 31); assert.equal(stream.breathingSamples, 31);
});

test('duplicates, out-of-order and empty packets do not refresh measurement age or calibration', () => {
  const stream = native();
  const sample = stream.ingest({ cardio: { pulseRate: [value(12_000)] } }, 12_000, epoch + 12_000);
  assert.ok(sample); assert.equal(acceptedPulse(sample, 12_000), 72);
  assert.equal(stream.ingest({ cardio: { pulseRate: [value(12_000)] } }, 16_000, epoch + 16_000), null);
  assert.equal(stream.ingest({ cardio: { pulseRate: [value(11_000)] } }, 17_000, epoch + 17_000), null);
  stream.ingest({}, 18_000, epoch + 18_000);
  const diagnostics = stream.view(18_000, 'live');
  assert.equal(diagnostics.pulseSamples, 1); assert.equal(diagnostics.pulse.ageMs, 6000); assert.equal(diagnostics.pulse.state, 'stale');
  assert.equal(acceptedPulse(sample, 18_000), null);
});

test('NoData stays unknown while a real degraded pulse remains rejected', () => {
  const stream = native();
  assert.equal(normalizePresage({}, 20_000, epoch + 20_000, 0, { code: 0, hint: '' }).quality, 'unknown');
  stream.ingest({ cardio: { pulseRate: [{ ...value(20_000), stable: false, confidence: 31 }] } }, 20_000, epoch + 20_000);
  const view = stream.view(20_000, 'live');
  assert.equal(view.pulse.bpm, 72, 'actual unaccepted estimate can be labeled by UI');
  assert.equal(view.pulse.confidence, 31); assert.equal(view.pulse.stable, false);
  assert.equal(view.pulse.eligible, false); assert.equal(view.pulse.state, 'rejected');
  stream.validation = { code: 5, hint: 'More light needed' };
  assert.equal(stream.view(20_000, 'live').blocker, 'More light needed');
});

test('warmups begin at real sent-frame event; raw values remain hidden until their analysis windows', () => {
  const stream = new NativeMetricStream(); stream.processing(3); stream.validation = { code: 0, hint: '' };
  stream.ingest({ cardio: { pulseRate: [value(50_000)] }, breathing: { rate: [value(50_000, 15)] } }, 50_000, epoch + 50_000);
  assert.equal(stream.view(50_000, 'live').pulse.bpm, null);
  assert.equal(stream.view(50_000, 'live').warmupRemainingSeconds, 12);
  stream.frame(false, (epoch + 50_000) * 1000, 50_000);
  assert.equal(stream.firstFrameAt, null);
  for (let index = 0; index <= 30; index++) stream.frame(true, (epoch + 51_000 + index * 1000 / 30) * 1000, 51_000 + index * 1000 / 30);
  assert.ok(Math.abs(stream.view(52_000, 'live').frameRate! - 30) < .001);
  assert.equal(stream.framesSentThrough, 31); assert.equal(stream.framesRejected, 1);
  stream.ingest({ cardio: { pulseRate: [value(63_000)] }, breathing: { rate: [value(63_000, 15)] } }, 63_000, epoch + 63_000);
  assert.equal(stream.view(63_000, 'live').pulse.bpm, 72); assert.equal(stream.view(63_000, 'live').breathing.bpm, null);
  assert.equal(stream.view(63_000, 'live').frameRate, null, 'old frames do not imply current FPS');
  assert.equal(stream.view(63_000, 'off').pulse.bpm, null, 'stopping capture clears visible estimate');
});

test('epoch microseconds map to monotonic age without silently allowing six-second stale data', () => {
  const stream = native();
  const good = stream.ingest({ cardio: { pulseRate: [value(17_000)] } }, 20_000, epoch + 20_000);
  assert.equal(good?.measuredMonotonicMs, 17_000); assert.equal(good?.quality, 'accepted');
  const stale = stream.ingest({ cardio: { pulseRate: [value(18_000)] } }, 24_000, epoch + 24_000);
  assert.equal(stale?.quality, 'rejected'); assert.equal(stream.view(24_000, 'live').pulse.ageMs, 6000);
});

test('quality recovery does not relabel the old rejected reading as accepted before a new estimate arrives', () => {
  const stream = native();
  stream.ingest({ cardio: { pulseRate: [value(20_000)] } }, 20_000, epoch + 20_000);
  assert.equal(stream.view(20_000, 'live').pulse.eligible, true);
  stream.setValidation(5, 'More light needed');
  stream.setValidation(0, 'Capture validated');
  assert.equal(stream.view(20_500, 'live').pulse.eligible, false);
  stream.ingest({ cardio: { pulseRate: [value(21_000)] } }, 21_000, epoch + 21_000);
  assert.equal(stream.view(21_000, 'live').pulse.eligible, true);
});

test('SDK error keeps actionable model-delivery failure while redacting credentials and query tokens', () => {
  const sanitized = sanitizeSensorError('Model delivery failed: https://models.example/path?token=abc API_KEY=test-secret Bearer xyz\nretry later', 'test-secret');
  assert.match(sanitized, /Model delivery failed/); assert.match(sanitized, /models.example\/path/);
  for (const secret of ['test-secret', 'token=abc', 'xyz']) assert.ok(!sanitized.includes(secret));
  assert.ok(!sanitized.includes('\n'));
});
