import test from 'node:test';
import assert from 'node:assert/strict';
import { Metrics, decodeMetrics, presage } from '@smartspectra/node-sdk/messages';
import { NativeMetricStream } from './nativeMetrics';
import { CORE_METRICS, REQUESTED_METRICS } from './metricPolicy';
import { expressionScores, fearScore, hrvScale, NOT_PROVIDED, Ring, stepBreathPhase, WAVE_WINDOW_MS, type PhaseState } from './signals';
import { signalCheck } from './signalCheck';
import { simulatedSignals, simulatedWaveforms } from './simulated';
import { SensorController } from './controller';
import { spectatorVitals } from '../integrations/spectate';
import { sanitizedTrace } from '../integrations/client';
import { createGame } from '../game/reducer';
import type { SensorView, SignalName } from './types';

const epoch = 1_800_000_000_000, us = (ms: number) => (epoch + ms) * 1000;
const E = presage.smartspectra.ExpressionType;
const decode = (data: Parameters<typeof Metrics.create>[0]) => decodeMetrics(Metrics.encode(Metrics.create(data)).finish());
const live = () => { const s = new NativeMetricStream(); s.processing(3); s.setValidation(0, 'Capture validated'); s.frame(true, us(0), 0); return s; };
const ALL: SignalName[] = ['pulse', 'breathing', 'chest', 'abdomen', 'hrv', 'blinking', 'talking', 'expressions', 'eda', 'arterial'];
type Opts = { stable?: boolean; hrvConfidence?: number; arterialConfidence?: number; eda?: (t: number) => number; face?: boolean; edaOn?: boolean; hrv?: { rmssd: number; sdnn: number; meanNn: number } };
/** One second of every signal, as the SDK would pack it: 10 Hz traces and face entries. */
function second(at: number, o: Opts = {}) {
  const stable = o.stable ?? true, ticks = Array.from({ length: 10 }, (_, i) => at - 900 + i * 100);
  const breath = (t: number) => Math.sin(2 * Math.PI * 0.25 * t / 1000);
  return {
    cardio: { pulseRate: [{ value: 72, stable, confidence: 90, timestamp: us(at) }], arterialPressureTrace: ticks.map(t => ({ value: Math.sin(t / 130), stable, confidence: o.arterialConfidence ?? 80, timestamp: us(t) })), hrv: [{ ...(o.hrv ?? { rmssd: 40, sdnn: 55, meanNn: 830 }), baevsky: 90, confidence: o.hrvConfidence ?? 70, stable, timestamp: us(at) }] },
    breathing: { rate: [{ value: 15, stable, confidence: 80, timestamp: us(at) }], upperTrace: ticks.map(t => ({ value: breath(t), stable, timestamp: us(t) })), lowerTrace: ticks.map(t => ({ value: 0.5 * breath(t), stable, timestamp: us(t) })) },
    ...(o.face === false ? {} : { face: { blinking: ticks.map(t => ({ detected: t % 4000 < 200, stable, timestamp: us(t) })), talking: [{ detected: false, stable, timestamp: us(at) }], expression: [{ stable, timestamp: us(at), scores: [{ type: E.FEAR, confidence: 40 }, { type: E.SURPRISE, confidence: 20 }, { type: E.NEUTRAL, confidence: 40 }, { type: E.UNSPECIFIED, confidence: 0 }] }] } }),
    ...(o.edaOn === false || at < 36_000 ? {} : { eda: { trace: ticks.map(t => ({ value: (o.eda ?? (time => 1 + 0.05 * Math.sin(time * 1.3)))(t), stable, timestamp: us(t) })) } }),
  };
}
function run(stream: NativeMetricStream, from: number, to: number, o: Opts = {}) { for (let at = from; at <= to; at += 1000) stream.ingest(decode(second(at, o)), at, epoch + at); }
const view = (over: Partial<SensorView> = {}): SensorView => ({ source: 'presage', status: 'calibrating', trend: 'UNKNOWN', quality: 'unknown', hint: '', baselineBpm: null, pulseBpm: null, ageMs: null, acceptedSeconds: 0, canContinueManual: true, sampleAtMs: null, captureSegment: 1, ...over });

test('all ten standard metric names resolve to the installed SDK enum; no strict variants', () => {
  const codes: number[] = REQUESTED_METRICS.map(name => presage.smartspectra.MetricType[name]);
  assert.deepEqual(codes, [15, 2, 0, 1, 17, 12, 13, 14, 10, 16]);
  assert.equal(new Set(codes).size, 10); assert.ok(!codes.includes(18) && !codes.includes(19));
  assert.deepEqual(CORE_METRICS.map(name => presage.smartspectra.MetricType[name]), [15, 2]);
});

test('real protobuf packets: every signal parses to a coarse ok value after its warm-up', () => {
  const stream = live();
  run(stream, 1000, 100_000);
  const s = stream.signalView(100_000, 'live');
  for (const name of ALL) assert.equal(s.status[name].status, 'ok', `${name}: ${s.status[name].reason}`);
  assert.equal(s.breathingBpm, 15); assert.equal(s.breathPhase, 'in'); assert.equal(s.abdomenShare, 0.35);
  assert.deepEqual(s.hrv, { rmssdMs: 40, sdnnMs: 55 });
  assert.ok(s.blinksPerMinute! >= 14 && s.blinksPerMinute! <= 16, `blinks ${s.blinksPerMinute}`); assert.ok(s.lastBlinkAgeMs! >= 0 && s.lastBlinkAgeMs! < 4000);
  assert.equal(s.talking, false);
  assert.deepEqual(s.expressions, { fear: 0.4, surprise: 0.2, neutral: 0.4 }); assert.equal(s.fear, 0.45);
  assert.ok(s.edaRelative !== null && Math.abs(s.edaRelative) <= 1.5, `eda ${s.edaRelative}`);
  run(stream, 101_000, 102_000);
  assert.equal(stream.signalView(102_000, 'live').breathPhase, 'out', 'falling chest trace after the peak');
});

test('warm-up windows report seconds left; EDA waits 35 s and then its first accepted minute', () => {
  const stream = live();
  run(stream, 1000, 10_000);
  let s = stream.signalView(10_000, 'live');
  assert.equal(s.status.chest.status, 'warming'); assert.equal(s.status.chest.secondsLeft, 20); assert.equal(s.breathPhase, null);
  assert.equal(s.status.hrv.status, 'warming'); assert.equal(s.hrv, null);
  assert.equal(s.status.expressions.status, 'ok'); assert.equal(s.status.talking.status, 'ok');
  assert.equal(s.status.blinking.status, 'warming'); assert.equal(s.status.blinking.secondsLeft, 11); assert.equal(s.blinksPerMinute, null);
  assert.equal(s.status.eda.status, 'warming'); assert.equal(s.status.eda.secondsLeft, 25);
  run(stream, 11_000, 60_000);
  s = stream.signalView(60_000, 'live');
  assert.equal(s.status.eda.status, 'warming'); assert.equal(s.status.eda.reason, 'Collecting your first accepted minute'); assert.equal(s.status.eda.secondsLeft, 36, 'first EDA at 35.1 s; 24.9 s accepted by 60 s'); assert.equal(s.edaRelative, null);
  run(stream, 61_000, 100_000);
  run(stream, 101_000, 120_000, { eda: () => 1.1 });
  s = stream.signalView(120_000, 'live');
  assert.equal(s.status.eda.status, 'ok'); assert.ok(s.edaRelative! >= 2 && s.edaRelative! <= 3, `eda ${s.edaRelative}`);
});

test('signals a key or session never provides become unavailable, distinct from capture off', () => {
  const stream = live();
  for (let at = 1000; at <= 60_000; at += 1000) stream.ingest(decode({ cardio: { pulseRate: [{ value: 72, stable: true, confidence: 90, timestamp: us(at) }] } }), at, epoch + at);
  let s = stream.signalView(40_000, 'live');
  assert.equal(s.status.eda.status, 'warming', 'EDA still inside its 35 s + grace window');
  s = stream.signalView(60_000, 'live');
  for (const name of ['breathing', 'chest', 'abdomen', 'hrv', 'blinking', 'talking', 'expressions', 'eda', 'arterial'] as SignalName[]) {
    assert.equal(s.status[name].status, 'unavailable', name); assert.equal(s.status[name].reason, NOT_PROVIDED);
  }
  assert.equal(s.status.pulse.status, 'ok');
  assert.equal(s.breathingBpm, null); assert.equal(s.expressions, null); assert.equal(s.fear, null); assert.equal(s.hrv, null);
  const off = stream.signalView(60_000, 'off');
  for (const name of ALL) { assert.equal(off.status[name].status, 'unavailable'); assert.equal(off.status[name].reason, 'Capture is off'); }
  const fresh = new NativeMetricStream(); fresh.processing(2);
  assert.equal(fresh.signalView(0, 'live').status.expressions.status, 'warming');
});

test('SDK quality gates: unstable, below-floor, unit and expression checks reject without fabricating values', () => {
  let stream = live(); run(stream, 1000, 40_000, { stable: false });
  let s = stream.signalView(40_000, 'live');
  for (const name of ['breathing', 'chest', 'abdomen', 'hrv', 'blinking', 'talking', 'expressions', 'arterial'] as SignalName[]) assert.equal(s.status[name].status, 'rejected', name);
  assert.equal(s.status.expressions.reason, 'Expression estimate is not stable');
  assert.equal(s.expressions, null); assert.equal(s.fear, null); assert.equal(s.talking, null); assert.equal(s.breathPhase, null);
  stream = live(); run(stream, 1000, 40_000, { hrvConfidence: 49, arterialConfidence: 39 });
  s = stream.signalView(40_000, 'live');
  assert.equal(s.status.hrv.reason, 'HRV confidence below SDK threshold (50/100)'); assert.equal(s.hrv, null);
  assert.equal(s.status.arterial.reason, 'Confidence below SDK threshold (40/100)');
  stream = live(); run(stream, 1000, 40_000, { hrv: { rmssd: 0.04, sdnn: 0.06, meanNn: 0.83 } });
  assert.deepEqual(stream.signalView(40_000, 'live').hrv, { rmssdMs: 40, sdnnMs: 60 }, 'seconds converted via mean NN');
  stream = live(); run(stream, 1000, 40_000, { hrv: { rmssd: 40, sdnn: 55, meanNn: 50 } });
  assert.equal(stream.signalView(40_000, 'live').status.hrv.reason, 'HRV interval units not recognized');
  assert.deepEqual([hrvScale(830), hrvScale(0.83), hrvScale(undefined), hrvScale(50)], [1, 1000, 1, null]);
});

test('validation: face/motion codes block face signals, chest code 7 only the traces; recovery needs a fresh estimate', () => {
  const stream = live(); run(stream, 1000, 40_000);
  stream.setValidation(12, 'Hold still');
  let s = stream.signalView(40_100, 'live');
  for (const name of ['chest', 'abdomen', 'hrv', 'blinking', 'talking', 'expressions', 'arterial'] as SignalName[]) { assert.equal(s.status[name].status, 'rejected', name); assert.equal(s.status[name].reason, 'Hold still'); }
  assert.equal(s.fear, null);
  stream.setValidation(7, 'Chest not visible');
  s = stream.signalView(40_200, 'live');
  assert.equal(s.status.chest.status, 'rejected'); assert.equal(s.status.abdomen.reason, 'Chest not visible');
  assert.equal(s.status.expressions.reason, 'Waiting for a fresh estimate after capture validation', 'code 12 recovery still needs a new estimate');
  run(stream, 41_000, 41_000);
  s = stream.signalView(41_000, 'live');
  assert.equal(s.status.expressions.status, 'ok'); assert.equal(s.fear, 0.45); assert.equal(s.status.hrv.status, 'ok');
  assert.equal(s.status.chest.status, 'rejected'); assert.equal(s.breathPhase, null);
  stream.setValidation(0, 'Capture validated');
  assert.equal(stream.signalView(41_100, 'live').status.chest.reason, 'Waiting for a fresh estimate after capture validation');
  run(stream, 42_000, 52_000);
  assert.equal(stream.signalView(52_000, 'live').status.chest.status, 'ok');
  const points = stream.waveforms(52_000).chest;
  assert.ok(points.some(p => !p.ok) && points.some(p => p.ok), 'points received under validation are kept but flagged');
});

test('freshness: chest phase stales after 3 s, face after 5 s, HRV after 10 s', () => {
  const stream = live(); run(stream, 1000, 40_000);
  assert.equal(stream.signalView(43_500, 'live').status.chest.status, 'stale');
  let s = stream.signalView(45_500, 'live');
  assert.equal(s.status.expressions.status, 'stale'); assert.equal(s.expressions, null); assert.equal(s.status.hrv.status, 'ok');
  s = stream.signalView(50_500, 'live');
  assert.equal(s.status.hrv.status, 'stale'); assert.equal(s.hrv, null);
});

test('waveforms: bounded rings, 20 s window, duplicates and older timestamps ignored', () => {
  const ring = new Ring<number>(3); [1, 2, 3, 4, 5].forEach(n => ring.push(n));
  assert.deepEqual(ring.toArray(), [3, 4, 5]); assert.equal(ring.last(), 5); assert.equal(ring.size, 3);
  const stream = live(); run(stream, 1000, 200_000);
  const waves = stream.waveforms(200_000);
  for (const name of ['chest', 'abdomen', 'arterial', 'eda'] as const) {
    assert.ok(waves[name].length > 150 && waves[name].length <= WAVE_WINDOW_MS / 100 + 1, `${name} ${waves[name].length}`);
    assert.ok(waves[name].every(p => p.t >= 200_000 - WAVE_WINDOW_MS && p.t <= 200_000));
    assert.ok(waves[name].every((p, i, all) => !i || p.t > all[i - 1]!.t));
  }
  const before = stream.waveforms(200_000).chest.length;
  stream.ingest(decode(second(200_000)), 200_100, epoch + 200_100);
  stream.ingest(decode(second(150_000)), 200_200, epoch + 200_200);
  assert.equal(stream.waveforms(200_000).chest.length, before);
  assert.equal(waves.simulated, false);
});

test('breath phase hysteresis ignores wobble smaller than 20% of the recent range', () => {
  let state: PhaseState = { phase: null, high: null, low: null };
  const feed = (values: number[]) => values.map(v => (state = stepBreathPhase(state, v, 2)).phase);
  assert.deepEqual(feed([0, 0.2, 0.5]), [null, null, 'in']);
  assert.deepEqual(feed([0.9, 0.7, 0.85, 0.6, 1.0]), ['in', 'in', 'in', 'in', 'in'], 'dips under 0.4 from the peak do not flip');
  assert.deepEqual(feed([0.7, 0.65, 0.2, 0.4, 0.3, 0.75]), ['in', 'in', 'out', 'out', 'out', 'in']);
  assert.equal(stepBreathPhase(state, 1, 0).phase, null, 'flat trace has no phase');
});

test('fear comes from FEAR plus a quarter of SURPRISE, clamped, only from stable scores', () => {
  assert.equal(fearScore({ fear: 0.4, surprise: 0.2 }), 0.45);
  assert.equal(fearScore({ fear: 0.9, surprise: 1 }), 1);
  assert.equal(fearScore({ fear: 0 }), 0);
  assert.equal(fearScore({ neutral: 1, surprise: 1 }), null); assert.equal(fearScore(null), null);
  assert.deepEqual(expressionScores([{ type: E.UNSPECIFIED, confidence: 50 }, { type: E.HAPPY, confidence: 101 }, { type: E.SAD, confidence: 12.4 }, { type: 99, confidence: 40 }]), { sad: 0.12 });
  assert.equal(expressionScores([]), null);
});

test('blinks count once per blink for per-frame and event-only streams', () => {
  const count = (entries: (at: number) => { detected: boolean; stable: boolean; timestamp: number }[]) => {
    const stream = live();
    for (let at = 1000; at <= 31_000; at += 1000) stream.ingest(decode({ face: { blinking: entries(at) } }), at, epoch + at);
    return stream.signalView(31_000, 'live');
  };
  const frames = count(at => Array.from({ length: 30 }, (_, i) => at - 1000 + (i + 1) * 33.3).map(t => ({ detected: t % 3000 >= 1500 && t % 3000 < 1650, stable: true, timestamp: Math.round(us(t)) })));
  assert.equal(frames.status.blinking.status, 'ok'); assert.ok(frames.blinksPerMinute! >= 19 && frames.blinksPerMinute! <= 21, `per-frame ${frames.blinksPerMinute}`);
  const events = count(at => at % 3000 === 0 ? [{ detected: true, stable: true, timestamp: us(at) }] : [{ detected: false, stable: true, timestamp: us(at) }]);
  assert.equal(events.blinksPerMinute, 20); assert.equal(events.lastBlinkAgeMs, 1000);
});

test('signalCheck: desktop, camera, starting, adjust, warming, ok and failed states', () => {
  const stream = live(), diag = (now: number) => stream.view(now, 'live');
  assert.equal(signalCheck(view(), false).state, 'needs-desktop');
  assert.equal(signalCheck(view({ source: 'manual', status: 'manual' })).state, 'needs-camera');
  assert.equal(signalCheck(view({ status: 'paused' })).title, 'Camera paused');
  const failed = signalCheck(view({ status: 'unavailable', hint: 'Sensor error 5: Model download failed https://models.example/x?token=abc · capture stopped' }));
  assert.equal(failed.state, 'failed'); assert.match(failed.detail, /Model download failed/); assert.ok(!failed.detail.includes('token=abc'));
  assert.equal(signalCheck(view({ status: 'starting', diagnostics: new NativeMetricStream().view(0, 'acquiring') })).state, 'starting');
  const unvalidated = new NativeMetricStream(); unvalidated.processing(3); unvalidated.frame(true, us(0), 0);
  assert.equal(signalCheck(view({ diagnostics: unvalidated.view(100, 'live') })).detail, 'Waiting for capture validation.');
  const noFrames = new NativeMetricStream(); noFrames.processing(3);
  assert.equal(signalCheck(view({ diagnostics: noFrames.view(100, 'live') })).detail, 'Waiting for the first camera frame.');
  for (const [code, issue] of [[1, 'no-face'], [5, 'too-dark'], [12, 'motion'], [7, 'chest'], [999, 'unknown']] as const) {
    stream.setValidation(code, 'SDK hint');
    const check = signalCheck(view({ diagnostics: diag(5000) }));
    assert.equal(check.state, 'adjust'); assert.equal(check.issue, issue); assert.equal(check.validationCode, code);
  }
  stream.setValidation(0, 'Capture validated');
  const warming = signalCheck(view({ diagnostics: diag(5000) }));
  assert.equal(warming.state, 'warming'); assert.equal(warming.secondsLeft, 7);
  assert.equal(signalCheck(view({ diagnostics: diag(13_000) })).secondsLeft, 0, 'warm-up done, no accepted pulse yet');
  const accepted = signalCheck(view({ diagnostics: diag(13_000), quality: 'accepted', pulseBpm: 72, acceptedSeconds: 1 }));
  assert.equal(accepted.state, 'ok'); assert.equal(accepted.calibrated, false); assert.equal(accepted.baselineSeconds, 1);
  assert.equal(signalCheck(view({ diagnostics: diag(13_000), quality: 'accepted', pulseBpm: 72, acceptedSeconds: 29, baselineBpm: 72 })).calibrated, false, 'never calibrated before 30 usable seconds');
  assert.equal(signalCheck(view({ diagnostics: diag(13_000), quality: 'accepted', pulseBpm: 72, acceptedSeconds: 30, baselineBpm: 72 })).calibrated, true);
  const simulated = signalCheck(view({ source: 'simulated', status: 'calibrating' }), false);
  assert.equal(simulated.state, 'ok'); assert.equal(simulated.simulated, true); assert.match(simulated.title, /SIMULATED/);
});

test('SIMULATED mode labels and fills every signal and waveform; manual has none', async () => {
  const calm = simulatedSignals(10_000), scared = simulatedSignals(10_000, true);
  for (const name of ALL) { assert.equal(calm.status[name].status, 'ok'); assert.match(calm.status[name].reason, /SIMULATED/); }
  assert.ok(calm.breathingBpm! >= 10 && calm.breathingBpm! <= 20); assert.ok(calm.abdomenShare! > 0 && calm.abdomenShare! < 1);
  assert.ok(['in', 'out'].includes(calm.breathPhase!)); assert.ok(calm.hrv!.rmssdMs > scared.hrv!.rmssdMs);
  assert.ok(scared.fear! > calm.fear!); assert.ok(scared.edaRelative! > calm.edaRelative!);
  const paused = simulatedSignals(10_000, false, false);
  for (const name of ALL) assert.equal(paused.status[name].status, 'unavailable');
  assert.equal(paused.fear, null); assert.equal(paused.breathingBpm, null);
  const waves = simulatedWaveforms(30_000);
  assert.equal(waves.simulated, true);
  for (const name of ['chest', 'abdomen', 'arterial', 'eda'] as const) assert.ok(waves[name].length >= 290 && waves[name].every(p => p.t >= 10_000 && p.t <= 30_000 && Number.isFinite(p.v)));
  const controller = new SensorController();
  try {
    assert.equal(controller.view().signals, undefined); assert.equal(controller.waveforms(), null);
    await controller.start('simulated');
    assert.ok(controller.view().signals); assert.equal(controller.waveforms()?.simulated, true);
    assert.equal(controller.view().signals!.status.pulse.status, 'ok');
  } finally { await controller.dispose(); }
});

test('signals never reach the sanitized trace or spectator vitals, apart from one fear number and whole-number summaries', () => {
  const stream = live(); run(stream, 1000, 100_000);
  const sensor = view({ source: 'presage', status: 'ready', quality: 'accepted', pulseBpm: 80, baselineBpm: 72, sampleAtMs: 1, diagnostics: stream.view(100_000, 'live'), signals: stream.signalView(100_000, 'live') });
  // User decision 2026-10-25: spectators get one 0-100 fear integer and whole-number summaries made on
  // this device (breathing rate, the strongest expression, blink rate, HRV RMSSD), never the signals themselves.
  const { fearPct, signals, ...vitals } = spectatorVitals(sensor)!;
  assert.ok(fearPct === null || Number.isInteger(fearPct) && fearPct >= 0 && fearPct <= 100, 'one bounded integer');
  assert.ok(signals === null || Object.keys(signals).sort().join() === 'blinksPerMinute,breathingRpm,emotion,emotionPct,hrvMs' && [signals.breathingRpm, signals.emotionPct, signals.blinksPerMinute, signals.hrvMs].every(v => v === null || Number.isInteger(v)), 'only whole-number summaries');
  const shared = JSON.stringify([sanitizedTrace(createGame(17), sensor), vitals]);
  for (const word of ['signals', 'fear', 'breath', 'abdomen', 'hrv', 'rmssd', 'blink', 'talking', 'expression', 'eda', 'arterial', 'waveform']) assert.ok(!shared.toLowerCase().includes(word), word);
});
