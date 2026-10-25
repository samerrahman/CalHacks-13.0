export type SensorMode = 'manual' | 'simulated' | 'presage';
export type Trend = 'UNKNOWN' | 'STEADY' | 'ELEVATED' | 'RECOVERED';
/** Local diagnostics only. These are never director inputs or shared trace fields. */
export type SensorDiagnosticMetric = {
  bpm: number | null;
  confidence: number | null;
  stable: boolean | null;
  ageMs: number | null;
  eligible: boolean;
  state: 'waiting' | 'warming-up' | 'accepted' | 'rejected' | 'stale';
  reasons: string[];
  requiredConfidence?: number;
  receivedAgeMs?: number | null;
  updateIntervalMs?: number | null;
  sampleCount?: number;
};
export type SensorDiagnostics = {
  captureState: 'off' | 'acquiring' | 'live';
  processingStatus: 'uninitialized' | 'idle' | 'starting' | 'running' | 'stopping' | 'error';
  validationCode: number | null;
  validationHint: string;
  warmupRemainingSeconds: number;
  breathingWarmupRemainingSeconds: number;
  metricsPackets: number;
  pulseSamples: number;
  breathingSamples: number;
  framesSentThrough: number;
  framesRejected: number;
  frameRate: number | null;
  lastMetricAgeMs: number | null;
  pulse: SensorDiagnosticMetric;
  breathing: SensorDiagnosticMetric;
  blocker: string | null;
  lastFrameAgeMs?: number | null;
};
export type SensorSample = {
  source: 'presage' | 'simulated';
  receivedMonotonicMs: number;
  measuredMonotonicMs: number | null;
  pulseBpm: number | null;
  quality: 'accepted' | 'rejected' | 'unknown';
  qualityReasons: string[];
  nativeConfidence: unknown;
  validationCode: number | string | null;
};
export type SignalName = 'pulse' | 'breathing' | 'chest' | 'abdomen' | 'hrv' | 'blinking' | 'talking' | 'expressions' | 'eda' | 'arterial';
export type SignalStatus = 'ok' | 'warming' | 'unavailable' | 'rejected' | 'stale';
export type SignalState = { status: SignalStatus; reason: string; secondsLeft?: number };
export type ExpressionName = 'angry' | 'contempt' | 'disgust' | 'fear' | 'happy' | 'neutral' | 'sad' | 'surprise';
/** Coarse local camera estimates for game use, not medical readings. Every
 * value is null unless its signal's status is 'ok' (fear and lastBlinkAgeMs
 * may still be null when ok). Never part of traces, provider projections,
 * spectator vitals or SpacetimeDB. Waveforms stay in SensorController.waveforms(). */
export type SensorSignals = {
  breathingBpm: number | null;
  breathPhase: 'in' | 'out' | null;
  /** Abdomen share of chest + abdomen breathing movement, 0..1. */
  abdomenShare: number | null;
  hrv: { rmssdMs: number; sdnnMs: number } | null;
  blinksPerMinute: number | null;
  lastBlinkAgeMs: number | null;
  talking: boolean | null;
  /** Stable expression scores, 0..1 per expression. */
  expressions: Partial<Record<ExpressionName, number>> | null;
  /** FEAR score boosted by a quarter of SURPRISE, 0..1. */
  fear: number | null;
  /** Recent EDA proxy versus the player's first accepted minute, in that minute's spreads, -3..3. */
  edaRelative: number | null;
  status: Record<SignalName, SignalState>;
};
export type SensorView = {
  source: SensorMode;
  status: 'manual' | 'starting' | 'calibrating' | 'ready' | 'unavailable' | 'paused';
  trend: Trend;
  quality: SensorSample['quality'];
  hint: string;
  baselineBpm: number | null;
  pulseBpm: number | null;
  ageMs: number | null;
  acceptedSeconds: number;
  canContinueManual: boolean;
  /** Local measurement clock only; excluded from remote trace and providers. */
  sampleAtMs: number | null;
  captureSegment: number;
  /** Accepted, fresh breathing estimate (breaths/min); null when unavailable. Local only. */
  breathingRpm?: number | null;
  /** Local measurement clock of `breathingRpm`; excluded from remote trace and providers. */
  breathingAtMs?: number | null;
  /** Frozen personal resting breathing rate; null until enough accepted breathing. */
  restingBreathingRpm?: number | null;
  diagnostics?: SensorDiagnostics;
  /** Local only, like diagnostics. Present for presage and simulated sources. */
  signals?: SensorSignals;
};
export const FRESHNESS_MS = 5000;

export function acceptedPulse(sample: SensorSample | null, nowMs: number, allowSimulated = false): number | null {
  if (!sample || sample.quality !== 'accepted' || !(sample.source === 'presage' || allowSimulated && sample.source === 'simulated')) return null;
  const age = nowMs - sample.receivedMonotonicMs;
  if (!Number.isFinite(age) || age < 0 || age > FRESHNESS_MS) return null;
  if (sample.measuredMonotonicMs === null || !Number.isFinite(sample.measuredMonotonicMs) || sample.measuredMonotonicMs < 0 || nowMs - sample.measuredMonotonicMs > FRESHNESS_MS || sample.measuredMonotonicMs > nowMs + 1000) return null;
  const pulse = sample.pulseBpm;
  return pulse !== null && Number.isFinite(pulse) && pulse >= 40 && pulse <= 110 ? pulse : null;
}
