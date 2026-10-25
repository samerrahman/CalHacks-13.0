import type { SensorSample, SensorSignals, SignalName } from './types';
import { fearScore, WAVE_WINDOW_MS, type SensorWaveforms, type WavePoint } from './signals';
/** Explicit development fixture; never selected as a live failure fallback. */
export function simulatedSample(nowMs: number, elevated = false): SensorSample {
  return { source: 'simulated', receivedMonotonicMs: nowMs, measuredMonotonicMs: nowMs, pulseBpm: elevated ? 84 : 72, quality: 'accepted', qualityReasons: ['SIMULATED development input — camera is off'], nativeConfidence: null, validationCode: null };
}
const SIMULATED = 'SIMULATED development input — camera is off';
const NAMES: SignalName[] = ['pulse', 'breathing', 'chest', 'abdomen', 'hrv', 'blinking', 'talking', 'expressions', 'eda', 'arterial'];
const breathHz = (elevated: boolean) => (elevated ? 19 : 14) / 60;
/** Plausible, deterministic SIMULATED values for every signal so the browser
 * build can show them. Not derived from any camera. Inactive input (paused,
 * starting) reports every signal unavailable. */
export function simulatedSignals(nowMs: number, elevated = false, active = true): SensorSignals {
  if (!active) return { breathingBpm: null, breathPhase: null, abdomenShare: null, hrv: null, blinksPerMinute: null, lastBlinkAgeMs: null, talking: null, expressions: null, fear: null, edaRelative: null,
    status: Object.fromEntries(NAMES.map(name => [name, { status: 'unavailable', reason: 'SIMULATED input is not running' }])) as SensorSignals['status'] };
  const t = nowMs / 1000, blinkPeriod = 60_000 / (elevated ? 26 : 15);
  const expressions = elevated ? { neutral: 0.38, fear: 0.34, surprise: 0.16, sad: 0.05, angry: 0.03, disgust: 0.02, happy: 0.01, contempt: 0.01 } : { neutral: 0.78, happy: 0.06, sad: 0.04, surprise: 0.04, fear: 0.03, angry: 0.02, disgust: 0.02, contempt: 0.01 };
  return {
    breathingBpm: elevated ? 19 : 14, breathPhase: Math.cos(2 * Math.PI * breathHz(elevated) * t) >= 0 ? 'in' : 'out', abdomenShare: elevated ? 0.35 : 0.55,
    hrv: elevated ? { rmssdMs: 24, sdnnMs: 38 } : { rmssdMs: 42, sdnnMs: 58 }, blinksPerMinute: elevated ? 26 : 15, lastBlinkAgeMs: Math.round((nowMs % blinkPeriod) / 100) * 100,
    talking: false, expressions, fear: fearScore(expressions), edaRelative: Math.round(((elevated ? 1.4 : 0.1) + 0.1 * Math.sin(t / 7)) * 10) / 10,
    status: Object.fromEntries(NAMES.map(name => [name, { status: 'ok', reason: SIMULATED }])) as SensorSignals['status'],
  };
}
/** SIMULATED 15 Hz traces for the last WAVE_WINDOW_MS. */
export function simulatedWaveforms(nowMs: number, elevated = false): SensorWaveforms {
  const chest: WavePoint[] = [], abdomen: WavePoint[] = [], arterial: WavePoint[] = [], eda: WavePoint[] = [];
  const breath = 2 * Math.PI * breathHz(elevated), beat = 2 * Math.PI * (elevated ? 84 : 72) / 60, share = elevated ? 0.35 : 0.55;
  for (let i = Math.ceil((nowMs - WAVE_WINDOW_MS) * 15 / 1000); i <= Math.floor(nowMs * 15 / 1000); i++) {
    const at = i * 1000 / 15, s = at / 1000, phase = beat * s;
    chest.push({ t: at, v: (1 - share) * Math.sin(breath * s), ok: true });
    abdomen.push({ t: at, v: share * Math.sin(breath * s - 0.4), ok: true });
    arterial.push({ t: at, v: Math.sin(phase) + 0.45 * Math.sin(2 * phase - 0.9) + 0.15 * Math.sin(3 * phase - 1.6), ok: true });
    eda.push({ t: at, v: (elevated ? 1.2 : 0.4) + 0.08 * Math.sin(s / 9) + 0.25 * Math.max(0, Math.sin(s / 3.1)) ** 8, ok: true });
  }
  return { simulated: true, nowMs, chest, abdomen, arterial, eda };
}
