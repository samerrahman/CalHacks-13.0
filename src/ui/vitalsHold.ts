import type { SensorView, Trend } from '../sensing/types';

/** Display-only memory for the vitals readouts. Presage estimates drop out often (framing, motion,
 * stale packets, the warm-up after every pause), and a blank readout looks broken. So the readouts
 * keep showing the last accepted pulse and breathing and simply stop updating until a fresh estimate
 * arrives; before any pulse reading, the calibrated baseline stands in. The game itself still gets a
 * neutral reading whenever the estimate is missing or rejected. One memory is shared by every
 * monitor (setup panel, in-game corner, camera dialog), so values carry across screens and pauses;
 * it clears only when the source changes (camera stopped, simulated fixture). */
export type VitalsMemory = { source: SensorView['source'] | null; pulse: number | null; breathing: number | null; trend: Trend };
export type VitalsReadout = { pulse: number | null; breathing: number | null; trend: Trend; pulseLive: boolean; breathingLive: boolean };

export const sharedVitals: VitalsMemory = { source: null, pulse: null, breathing: null, trend: 'UNKNOWN' };

const finite = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value);

export function livePulse(sensor: SensorView): number | null {
  return sensor.source !== 'manual' && sensor.quality === 'accepted' && ['calibrating', 'ready'].includes(sensor.status) && finite(sensor.pulseBpm) ? sensor.pulseBpm : null;
}
export function liveBreathing(sensor: SensorView): number | null {
  const breathing = sensor.diagnostics?.breathing;
  return sensor.source !== 'manual' && breathing?.eligible && finite(breathing.bpm) ? breathing.bpm : null;
}

export function readVitals(memory: VitalsMemory, sensor: SensorView): VitalsReadout {
  if (memory.source !== sensor.source) Object.assign(memory, { source: sensor.source, pulse: null, breathing: null, trend: 'UNKNOWN' });
  if (sensor.source === 'manual') return { pulse: null, breathing: null, trend: 'UNKNOWN', pulseLive: false, breathingLive: false };
  const pulse = livePulse(sensor), breathing = liveBreathing(sensor);
  if (pulse !== null) memory.pulse = pulse;
  if (breathing !== null) memory.breathing = breathing;
  if (pulse !== null && sensor.trend !== 'UNKNOWN') memory.trend = sensor.trend;
  return { pulse: memory.pulse ?? sensor.baselineBpm, breathing: memory.breathing, trend: memory.trend, pulseLive: pulse !== null, breathingLive: breathing !== null };
}

/** Fear / startle for the readouts. Presage's live fear expression score (0..1) when there is one;
 * otherwise the last live score, held like pulse and breathing; otherwise an estimate from how far
 * the pulse sits above baseline (and whether it is staying up). Display only, never game input. */
export type EmotionLabel = 'FEAR / STARTLE' | 'TENSE' | 'CALM' | 'CALIBRATING';
export type EmotionReadout = { fearPct: number | null; label: EmotionLabel; live: boolean };
export type EmotionMemory = { source: SensorView['source'] | null; fearPct: number | null };
export const sharedEmotion: EmotionMemory = { source: null, fearPct: null };

export const emotionLabel = (fearPct: number): EmotionLabel => fearPct >= 50 ? 'FEAR / STARTLE' : fearPct >= 25 ? 'TENSE' : 'CALM';
/** Arousal estimate from heart rate alone: +25 BPM over baseline reads as full fear; a sustained rise at least tense. */
export function fearFromPulse(pulse: number | null, baseline: number | null, trend: Trend): number | null {
  const elevated = trend === 'ELEVATED' ? 55 : 0;
  if (pulse === null || baseline === null) return elevated || null;
  return Math.max(elevated, Math.round(Math.max(0, Math.min(1, (pulse - baseline) / 25)) * 100));
}

export function readEmotion(sensor: SensorView, memory: EmotionMemory = sharedEmotion): EmotionReadout {
  if (memory.source !== sensor.source) Object.assign(memory, { source: sensor.source, fearPct: null });
  if (sensor.source === 'manual') return { fearPct: null, label: 'CALIBRATING', live: false };
  const fear = sensor.signals?.fear;
  if (finite(fear)) {
    memory.fearPct = Math.round(Math.max(0, Math.min(1, fear)) * 100);
    return { fearPct: memory.fearPct, label: emotionLabel(memory.fearPct), live: true };
  }
  if (memory.fearPct !== null) return { fearPct: memory.fearPct, label: emotionLabel(memory.fearPct), live: false };
  const held = sharedVitals.source === sensor.source ? sharedVitals.pulse : null;
  const estimate = fearFromPulse(livePulse(sensor) ?? held, sensor.baselineBpm, sensor.trend);
  return estimate === null ? { fearPct: null, label: 'CALIBRATING', live: false } : { fearPct: estimate, label: emotionLabel(estimate), live: false };
}

/** The spectator's single FEAR readout. The player's device sends one combined fear percentage
 * from its camera estimates (face, heart rate, breathing, skin response; `spectatorFear` in
 * src/integrations/spectate.ts). An older player build sends only heart rate, so FEAR is then
 * estimated from the pulse against the frozen baseline and the trend. Accepted readings arrive
 * between frequent dropouts, so the last shared fear is held for up to SPECTATOR_FEAR_HOLD_MS
 * (marked not live) and the last pulse and trend until the next accepted one. Once shared fear stops
 * arriving for longer (an older module, the player's back-off, a re-enabled share still
 * calibrating) the page falls back to the heart-rate estimate rather than freezing the last number.
 * Switching source (camera ↔ simulated) clears everything; SpectateView also clears it whenever
 * vitals are not shared. */
export type SpectatorFearLabel = 'SCARED' | 'TENSE' | 'CALM' | 'CALIBRATING';
export type SpectatorFear = { fearPct: number | null; label: SpectatorFearLabel; trend: Trend; live: boolean; basis: 'camera' | 'heart rate' | null };
export type SpectatorFearMemory = { source: string | null; fear: number | null; fearAtMs: number; pulse: number | null; trend: Trend };
export const SPECTATOR_FEAR_HOLD_MS = 8000;
export const spectatorFearMemory = (): SpectatorFearMemory => ({ source: null, fear: null, fearAtMs: -Infinity, pulse: null, trend: 'UNKNOWN' });
const SPECTATOR_LABEL: Record<Exclude<EmotionLabel, 'CALIBRATING'>, SpectatorFearLabel> = { 'FEAR / STARTLE': 'SCARED', TENSE: 'TENSE', CALM: 'CALM' };
const spectatorLabel = (fearPct: number | null): SpectatorFearLabel => fearPct === null ? 'CALIBRATING' : SPECTATOR_LABEL[emotionLabel(fearPct) as Exclude<EmotionLabel, 'CALIBRATING'>];

/** `nowMs`: the spectator page's own clock (performance.now), never a remote one. */
export function readSpectatorFear(memory: SpectatorFearMemory, vitals: { source: string; pulseBpm: number | null; baselineBpm: number | null; trend: Trend; fearPct?: number | null }, nowMs: number): SpectatorFear {
  if (memory.source !== vitals.source) Object.assign(memory, spectatorFearMemory(), { source: vitals.source });
  const pulseLive = finite(vitals.pulseBpm), fearLive = finite(vitals.fearPct);
  if (pulseLive) { memory.pulse = vitals.pulseBpm; if (vitals.trend !== 'UNKNOWN') memory.trend = vitals.trend; }
  if (fearLive) { memory.fear = Math.round(Math.max(0, Math.min(100, vitals.fearPct!))); memory.fearAtMs = nowMs; }
  else if (memory.fear !== null && nowMs - memory.fearAtMs > SPECTATOR_FEAR_HOLD_MS) memory.fear = null;
  if (memory.fear !== null) return { fearPct: memory.fear, label: spectatorLabel(memory.fear), trend: memory.trend, live: fearLive, basis: 'camera' };
  const fearPct = fearFromPulse(memory.pulse, vitals.baselineBpm, memory.trend);
  return { fearPct, label: spectatorLabel(fearPct), trend: memory.trend, live: pulseLive, basis: fearPct === null ? null : 'heart rate' };
}
