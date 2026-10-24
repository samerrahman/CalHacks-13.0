import { FRESHNESS_MS, type SensorView } from '../sensing/types';

/** Display-only hold for the vitals readouts. A framing, motion or stability
 * warning still withholds the reading from the game immediately; the player
 * just keeps seeing the last accepted value, marked as held, instead of a
 * blank that looks like lost calibration. The baseline is never touched.
 * Only rejected-but-arriving estimates are bridged: once the stream itself
 * goes stale, or capture stops/restarts, the readout clears. */
export const VITALS_HOLD_MS = 15_000;
export type HeldVital = { value: number; at: number; key: string };
export type VitalReadout = { held: HeldVital | null; value: number | null; heldMs: number | null };

export function holdable(sensor: SensorView): boolean {
  return ['starting', 'calibrating', 'ready'].includes(sensor.status) && sensor.ageMs !== null && sensor.ageMs <= FRESHNESS_MS;
}

/** `key` identifies one capture (source + segment); a new capture never shows an old value. */
export function holdVital(previous: HeldVital | null, live: number | null, now: number, key: string, bridge: boolean): VitalReadout {
  if (live !== null && Number.isFinite(live)) return { held: { value: live, at: now, key }, value: live, heldMs: null };
  const age = previous ? now - previous.at : NaN;
  if (bridge && previous && previous.key === key && age >= 0 && age <= VITALS_HOLD_MS) return { held: previous, value: previous.value, heldMs: age };
  return { held: null, value: null, heldMs: null };
}
