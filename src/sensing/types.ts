export type SensorMode = 'manual' | 'simulated' | 'presage';
export type Trend = 'UNKNOWN' | 'STEADY' | 'ELEVATED' | 'RECOVERED';
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
