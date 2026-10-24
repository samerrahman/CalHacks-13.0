import type { SensorSample } from './types';

/** Narrow SDK payload adapter. Shape and epoch-microsecond timestamps verified
 * against @smartspectra/node-sdk 3.4.0 generated MeasurementWithConfidence types.
 * Confidence is documented 0..100, retained unchanged. >=80 is conservative
 * game tuning, not a provider accuracy guarantee or fear classification. */
export type NativeMeasurement = { value?: number | null; stable?: boolean | null; confidence?: number | null; timestamp?: number | { toNumber(): number } | null };
export type NativeMetrics = { cardio?: { pulseRate?: NativeMeasurement[] | null } | null; breathing?: { rate?: NativeMeasurement[] | null } | null };
export function measurementTimestamp(pulse: NativeMeasurement | undefined): number | null {
  const stamp = typeof pulse?.timestamp === 'number' ? pulse.timestamp : pulse?.timestamp?.toNumber() ?? null;
  return stamp !== null && Number.isFinite(stamp) && stamp > 0 ? stamp : null;
}
export function normalizePresage(metrics: NativeMetrics, receiveMs: number, wallMs: number, warmupStartedMs: number, validation: { code: number | null; hint: string }): SensorSample {
  const pulse = metrics.cardio?.pulseRate?.at(-1);
  const stamp = measurementTimestamp(pulse);
  // SDK protobuf timestamp is Unix microseconds. Map age to the receiving app's
  // monotonic clock; never directly compare an epoch with performance.now().
  const measuredMonotonicMs = stamp !== null && Number.isFinite(stamp) && stamp > 0 ? receiveMs - (wallMs - stamp / 1000) : null;
  const reasons: string[] = [];
  if (!pulse || typeof pulse.value !== 'number' || !Number.isFinite(pulse.value)) reasons.push('Waiting for pulse estimate');
  else if (pulse.value < 40 || pulse.value > 110) reasons.push('Outside supported pulse range (40–110 BPM)');
  if (receiveMs - warmupStartedMs < 12_000) reasons.push('Warming up: pulse uses a 12-second average');
  if (validation.code !== 0) reasons.push(validation.hint || 'Capture quality has not been validated');
  if (pulse?.stable !== true) reasons.push('Capture is not stable');
  if (typeof pulse?.confidence !== 'number' || !Number.isFinite(pulse.confidence) || pulse.confidence < 80 || pulse.confidence > 100) reasons.push('Confidence below game acceptance threshold');
  if (measuredMonotonicMs === null || receiveMs - measuredMonotonicMs > 5000 || measuredMonotonicMs > receiveMs + 1000) reasons.push('Missing or stale measurement timestamp');
  return { source: 'presage', receivedMonotonicMs: receiveMs, measuredMonotonicMs, pulseBpm: pulse?.value ?? null, quality: !pulse ? 'unknown' : reasons.length ? 'rejected' : 'accepted', qualityReasons: !pulse ? ['Waiting for pulse estimate'] : reasons, nativeConfidence: pulse?.confidence ?? null, validationCode: validation.code };
}
