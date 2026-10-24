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
  diagnostics?: SensorDiagnostics;
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
