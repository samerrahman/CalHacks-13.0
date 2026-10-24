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
