import type { SensorSample } from './types';
/** Explicit development fixture; never selected as a live failure fallback. */
export function simulatedSample(nowMs: number, elevated = false): SensorSample {
  return { source: 'simulated', receivedMonotonicMs: nowMs, measuredMonotonicMs: nowMs, pulseBpm: elevated ? 84 : 72, quality: 'accepted', qualityReasons: ['SIMULATED development input — camera is off'], nativeConfidence: null, validationCode: null };
}
