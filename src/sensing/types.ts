export type SensorMode = 'manual' | 'simulated' | 'presage';
export type Trend = 'UNKNOWN' | 'STEADY' | 'ELEVATED' | 'RECOVERED';
export type SensorSample = {
  source: 'presage' | 'simulated';
  receivedAtMs: number;
  measuredAtMs: number | null;
  pulseBpm: number | null;
  breathingBpm: number | null;
  quality: 'accepted' | 'rejected' | 'unknown';
  qualityReasons: string[];
  nativeConfidence: unknown;
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
};
export const FRESHNESS_MS = 5000;

export function acceptedPulse(sample: SensorSample | null, nowMs: number, allowSimulated = false): number | null {
  if (!sample || sample.quality !== 'accepted' || (sample.source !== 'presage' && !allowSimulated)) return null;
  const age = nowMs - sample.receivedAtMs;
  if (!Number.isFinite(age) || age < 0 || age > FRESHNESS_MS) return null;
  if (sample.measuredAtMs !== null && (nowMs - sample.measuredAtMs > FRESHNESS_MS || sample.measuredAtMs > nowMs + 1000)) return null;
  const pulse = sample.pulseBpm;
  return pulse !== null && Number.isFinite(pulse) && pulse >= 40 && pulse <= 110 ? pulse : null;
}
