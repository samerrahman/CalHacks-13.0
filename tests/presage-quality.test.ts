import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeMetricStream } from '../src/sensing/nativeMetrics';
import { normalizePresage } from '../src/sensing/presageSample';
import { METRIC_POLICY, validationBlocksMetric } from '../src/sensing/metricPolicy';
import { Baseline } from '../src/sensing/baseline';
import { TrendTracker } from '../src/sensing/trend';
import { SensorController } from '../src/sensing/controller';
import type { SensorSample } from '../src/sensing/types';

const wall = 1_800_000_000_000;
const measurement = (time: number, confidence: number, bpm = 72, stable = true) => ({ value: bpm, confidence, stable, timestamp: (wall + time) * 1000 });
const stream = () => { const result = new NativeMetricStream(); result.processing(3); result.setValidation(0, 'Ready'); result.frame(true, wall * 1000, 0); return result; };

test('SDK metric-specific stable confidence floors replace the unrelated blanket eighty-percent filter', () => {
  assert.deepEqual([METRIC_POLICY.pulse.confidence, METRIC_POLICY.breathing.confidence], [40, 45]);
  for (const confidence of [40, 45, 60, 79, 100]) {
    const pulse = normalizePresage({ cardio: { pulseRate: [measurement(40_000, confidence)] } }, 40_000, wall + 40_000, 0, { code: 0, hint: '' });
    assert.equal(pulse.quality, 'accepted', `SDK-stable pulse at ${confidence}`);
  }
  for (const confidence of [0, 39.9, 101, NaN]) {
    assert.equal(normalizePresage({ cardio: { pulseRate: [measurement(40_000, confidence)] } }, 40_000, wall + 40_000, 0, { code: 0, hint: '' }).quality, 'rejected');
  }
  const sensor = stream();
  sensor.ingest({ breathing: { rate: [measurement(40_000, 45, 16)] } }, 40_000, wall + 40_000);
  assert.equal(sensor.view(40_000, 'live').breathing.eligible, true);
  sensor.ingest({ breathing: { rate: [measurement(41_000, 44.9, 16)] } }, 41_000, wall + 41_000);
  assert.equal(sensor.view(41_000, 'live').breathing.eligible, false);
  sensor.ingest({ breathing: { rate: [measurement(42_000, 95, 16, false)] } }, 42_000, wall + 42_000);
  assert.equal(sensor.view(42_000, 'live').breathing.eligible, false, 'confidence cannot override unstable SDK verdict');
});

test('chest-only warning blocks breathing without destroying a fresh stable pulse', () => {
  const sensor = stream();
  sensor.ingest({ cardio: { pulseRate: [measurement(40_000, 60)] }, breathing: { rate: [measurement(40_000, 65, 16)] } }, 40_000, wall + 40_000);
  sensor.setValidation(7, 'Place more chest in view');
  let view = sensor.view(40_100, 'live');
  assert.equal(view.pulse.eligible, true); assert.equal(view.breathing.eligible, false);
  assert.equal(view.validationCode, 7); assert.equal(view.validationHint, 'Place more chest in view');
  const sample = sensor.ingest({ cardio: { pulseRate: [measurement(41_000, 60)] } }, 41_000, wall + 41_000);
  assert.equal(sample?.quality, 'accepted'); assert.equal(sample?.validationCode, 7, 'original diagnostic code remains truthful');
  sensor.setValidation(0, 'Ready'); view = sensor.view(41_000, 'live');
  assert.equal(view.pulse.eligible, true); assert.equal(view.breathing.eligible, false, 'breathing requires a new accepted estimate');
  sensor.ingest({ breathing: { rate: [measurement(42_000, 65, 16)] } }, 42_000, wall + 42_000);
  assert.equal(sensor.view(42_000, 'live').breathing.eligible, true);
  for (const code of [null, 1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 15, 16, 17, 999]) {
    assert.equal(validationBlocksMetric(code, 'pulse'), true); assert.equal(validationBlocksMetric(code, 'breathing'), true);
  }
});

test('independent stream cadence distinguishes missing breathing from rejected or stale breathing', () => {
  const sensor = stream();
  sensor.ingest({ cardio: { pulseRate: [measurement(40_000, 60)] } }, 40_000, wall + 40_000);
  let view = sensor.view(40_000, 'live');
  assert.equal(view.breathing.sampleCount, 0); assert.equal(view.breathing.state, 'waiting');
  sensor.ingest({ breathing: { rate: [measurement(40_500, 20, 16)] } }, 40_600, wall + 40_600);
  view = sensor.view(40_700, 'live');
  assert.equal(view.breathing.sampleCount, 1); assert.equal(view.breathing.state, 'rejected');
  assert.equal(view.breathing.ageMs, 200); assert.equal(view.breathing.receivedAgeMs, 100);
  assert.equal(view.breathing.requiredConfidence, 45);
  sensor.ingest({ breathing: { rate: [measurement(41_500, 65, 16)] } }, 41_600, wall + 41_600);
  assert.equal(sensor.view(41_600, 'live').breathing.updateIntervalMs, 1000);
  sensor.ingest({ cardio: { pulseRate: [measurement(47_000, 60)] } }, 47_000, wall + 47_000);
  view = sensor.view(47_000, 'live');
  assert.equal(view.pulse.state, 'accepted'); assert.equal(view.breathing.state, 'stale');
  assert.equal(view.breathing.ageMs, 5500, 'fresh pulse cannot refresh breathing clock');
});

test('SDK-stable readings sustain calibration and gameplay trend even when chest tracking alone is lost', () => {
  const sensor = stream(), baseline = new Baseline(), trend = new TrendTracker();
  for (let now = 12_000; now <= 42_000; now += 1000) {
    sensor.setValidation(now % 2000 ? 7 : 0, 'Chest not visible');
    const sample = sensor.ingest({ cardio: { pulseRate: [measurement(now, 60)] } }, now, wall + now)!;
    baseline.add(sample, now); trend.add(sample);
  }
  assert.equal(baseline.value, 72); assert.equal(trend.classify(baseline.value, 42_000), 'STEADY');
  for (let now = 43_000; now <= 63_000; now += 1000) {
    const sample = sensor.ingest({ cardio: { pulseRate: [measurement(now, 60, 84)] } }, now, wall + now)!;
    trend.add(sample);
  }
  assert.equal(trend.classify(baseline.value, 63_000), 'ELEVATED');
  assert.equal(trend.classify(baseline.value, 69_000), 'UNKNOWN', 'true freshness loss still removes gameplay influence');
});

test('brief validation warning hides current input immediately but preserves history until a fresh accepted metric', async t => {
  let now = 30_000; t.mock.method(performance, 'now', () => now);
  const controller = new SensorController();
  const state = controller as unknown as { mode: 'presage'; status: 'ready'; baseline: Baseline; trends: TrendTracker; native: NativeMetricStream; sample: SensorSample; applyValidation(code: number, hint: string): void; accept(sample: SensorSample): void };
  const pulse = (time: number): SensorSample => ({ source: 'presage', receivedMonotonicMs: time, measuredMonotonicMs: time, pulseBpm: 84, nativeConfidence: 60, quality: 'accepted', qualityReasons: [], validationCode: 0 });
  try {
    state.mode = 'presage'; state.status = 'ready'; state.baseline.value = 72; state.native = stream();
    for (let time = 18_000; time <= 30_000; time += 1000) state.trends.add(pulse(time));
    state.sample = pulse(now);
    assert.equal(controller.view().trend, 'ELEVATED');
    state.applyValidation(5, 'More light needed');
    assert.equal(controller.view().pulseBpm, null); assert.equal(controller.view().trend, 'UNKNOWN');
    state.applyValidation(0, 'Ready');
    assert.equal(controller.view().trend, 'UNKNOWN', 'validation OK alone cannot resurrect the old pulse');
    now = 31_000; state.accept(pulse(now));
    assert.equal(controller.view().trend, 'ELEVATED', 'fresh accepted measurement can use retained historical evidence');
    now = 32_000; state.accept({ ...pulse(now), quality: 'rejected', qualityReasons: ['Capture is not stable'] });
    now = 33_000; state.accept(pulse(now));
    assert.equal(controller.view().trend, 'UNKNOWN', 'an actual rejected metric still interrupts sustained trend');
  } finally { await controller.dispose(); }
});
