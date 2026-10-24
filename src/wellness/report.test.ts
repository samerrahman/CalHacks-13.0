import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptNativeMetrics, METRICS, simulatedPulseObservation, type Metric, type SignalObservation, type SignalValue } from './signals';
import { WellnessSession } from './report';
import { COMPLETE_SIGNAL_FIXTURE_LABEL, completeNativePayloadFixture, completeSignalFixture } from './fixtures';
import { selectSuggestions } from './tips';

const values: Record<Metric, SignalValue> = {
  pulse: 72, breathingRate: 15, chestWave: true, abdomenWave: true,
  hrv: { rmssd: 42, meanNn: 850, sdnn: 55, baevsky: 1.2 },
  blink: true, talking: true, expression: { label: 'neutral', score: 88 },
  edaProxy: true, arterialWave: true,
};
const windows: Record<Metric, number> = {
  pulse: 12_000, breathingRate: 30_000, chestWave: 30_000, abdomenWave: 30_000,
  hrv: 60_000, blink: 0, talking: 0, expression: 0, edaProxy: 35_000, arterialWave: 12_000,
};
const confidence: Partial<Record<Metric, number>> = { pulse: 90, breathingRate: 75, hrv: 70, arterialWave: 70 };
function observation(metric: Metric, time = 70_000): SignalObservation {
  return { metric, source: 'presage', receivedAtMs: time, measuredAtMs: time, captureElapsedMs: time,
    validationOk: true, stable: true, confidence: confidence[metric] ?? null, value: values[metric] };
}
function withParent(session: WellnessSession, metric: Metric, time: number): void {
  if (metric === 'hrv' || metric === 'arterialWave') session.add(observation('pulse', time));
  if (metric === 'chestWave' || metric === 'abdomenWave') session.add(observation('breathingRate', time));
}

test('official Node/Electron payload fields project to ten bounded observations', () => {
  const wallMs = 1_761_000_000_000;
  const observations = adaptNativeMetrics(completeNativePayloadFixture(wallMs), 70_000, wallMs, 0, true);
  assert.deepEqual(observations.map(value => value.metric).sort(), [...METRICS].sort());
  assert.ok(observations.every(value => value.source === 'presage' && value.measuredAtMs === 70_000 && value.stable));
  assert.deepEqual(observations.find(value => value.metric === 'expression')?.value, { label: 'neutral', score: 88 });
  assert.equal(observations.find(value => value.metric === 'arterialWave')?.value, true);
  assert.equal(observations.find(value => value.metric === 'edaProxy')?.value, true);
});

for (const metric of METRICS) {
  test(`${metric}: warm-up, validation, stability, freshness and value gates`, () => {
    const early = Math.max(1, windows[metric] - 1);
    const warmup = new WellnessSession(); warmup.reset(0); withParent(warmup, metric, early);
    const before = observation(metric, early);
    assert.equal(warmup.add(before), windows[metric] === 0);
    for (const patch of [
      { validationOk: false }, { stable: false }, { measuredAtMs: 60_000 }, { value: null },
      ...(confidence[metric] === undefined ? [] : [{ confidence: 0 }]),
    ]) {
      const session = new WellnessSession(); session.reset(0); withParent(session, metric, 70_000);
      assert.equal(session.add({ ...observation(metric), ...patch }), false, JSON.stringify(patch));
      assert.equal(session.snapshot().metrics[metric].samples, 0);
    }
    const ready = new WellnessSession(); ready.reset(0); withParent(ready, metric, 70_000);
    assert.equal(ready.add(observation(metric)), true);
  });
}

test('incomplete pulse-only data leaves unsupported metrics unavailable', () => {
  const session = new WellnessSession(); session.reset(0);
  session.add(observation('pulse', 12_000));
  assert.equal(session.snapshot().metrics.pulse.available, false); // No session baseline yet.
  for (let time = 13_000; time <= 45_000; time += 1000) session.add(observation('pulse', time));
  const report = session.snapshot();
  assert.equal(report.source, 'presage');
  assert.equal(report.metrics.pulse.available, true);
  assert.ok(report.pulseBaselineBpm !== null);
  assert.ok(METRICS.filter(metric => metric !== 'pulse').every(metric => !report.metrics[metric].available));
});

test('today’s decoded pulse-only SDK payload feeds the report without other signals', () => {
  const session = new WellnessSession(); session.reset(0);
  const baseWallMs = 1_761_000_000_000;
  for (let time = 12_000; time <= 45_000; time += 1000) {
    const wallMs = baseWallMs + time;
    const observations = adaptNativeMetrics({ cardio: { pulseRate: [{ value: 73, stable: true, confidence: 90, timestamp: wallMs * 1000 }] } }, time, wallMs, 0, true);
    assert.equal(observations.length, 1);
    observations.forEach(value => session.add(value));
  }
  const report = session.snapshot();
  assert.equal(report.source, 'presage');
  assert.equal(report.metrics.pulse.available, true);
  assert.ok(METRICS.filter(metric => metric !== 'pulse').every(metric => !report.metrics[metric].available));
});

test('a new shift resets coverage, baseline, events and source', () => {
  const session = new WellnessSession(); session.reset(0);
  completeSignalFixture().forEach(value => session.add(value));
  assert.equal(session.snapshot().metrics.blink.events, 2);
  session.reset(100_000);
  const cleared = session.snapshot();
  assert.equal(cleared.source, 'none');
  assert.equal(cleared.pulseBaselineBpm, null);
  assert.ok(METRICS.every(metric => cleared.metrics[metric].samples === 0 && !cleared.metrics[metric].available));
  assert.equal(session.add(observation('pulse', 70_000)), false);
  session.finish();
  assert.equal(session.add(observation('pulse', 112_000)), false);
});

test('complete-signal fixture remains visibly simulated, while current development mode stays pulse-only', () => {
  assert.match(COMPLETE_SIGNAL_FIXTURE_LABEL, /SIMULATED/);
  const full = new WellnessSession(); full.reset(0);
  completeSignalFixture().forEach(value => full.add(value));
  const report = full.snapshot();
  assert.equal(report.source, 'simulated');
  assert.ok(METRICS.every(metric => report.metrics[metric].available), JSON.stringify(report.metrics));
  const current = new WellnessSession(); current.reset(0);
  for (let time = 0; time <= 45_000; time += 1000) current.add(simulatedPulseObservation(time, 0, 72, true));
  assert.equal(current.snapshot().source, 'simulated');
  assert.equal(current.snapshot().metrics.pulse.available, true);
  assert.ok(METRICS.filter(metric => metric !== 'pulse').every(metric => !current.snapshot().metrics[metric].available));
});

test('suggestions depend on the self-report only', () => {
  for (const choice of ['Calm', 'Mixed', 'Tense', null] as const) {
    const tips = selectSuggestions(choice);
    assert.ok(tips.length >= 1 && tips.length <= 2);
    assert.ok(tips.every(tip => !/diagnos|measured|stress level|fear level/i.test(tip)));
  }
  assert.notDeepEqual(selectSuggestions('Calm'), selectSuggestions('Tense'));
});
