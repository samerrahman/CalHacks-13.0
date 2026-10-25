/** Spectator readout of the creature's distance: about 5 m per line unit (0..120 m on the
 * 24-unit line) plus a smooth, deterministic drift of up to 2 m, so the number does not look
 * stepped. Display only: the game never reads it, and the drift never crosses the wall. */
export const METRES_PER_UNIT = 5;
export const DRIFT_METRES = 2;
export type CreatureDistance = { metres: number; atWall: boolean; label: string };

/** Phase in [0, 2π) from the run seed, so each run drifts differently but every viewer agrees. */
function phase(seed: number): number {
  const h = Math.imul((Number.isFinite(seed) ? Math.trunc(seed) : 0) ^ 0x9e3779b9, 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296 * Math.PI * 2;
}

/** `seconds` is run time; two incommensurate slow waves (≈7.6 s and ≈4.8 s) bounded to ±1. */
export function creatureDistance(linePosition: number, seconds: number, seed = 0): CreatureDistance {
  const units = Number.isFinite(linePosition) ? Math.max(0, linePosition) : 0;
  if (units <= 0) return { metres: 0, atWall: true, label: 'at the wall' };
  const t = Number.isFinite(seconds) ? seconds : 0, p = phase(seed);
  const drift = .62 * Math.sin(t * .83 + p) + .38 * Math.sin(t * 1.31 + p * 1.7 + 1.3);
  // The drift shrinks inside the first unit so a fractional position can never read below zero.
  const metres = Math.max(0, units * METRES_PER_UNIT + drift * DRIFT_METRES * Math.min(1, units));
  return { metres, atWall: false, label: `${Math.max(1, Math.round(metres))} m` };
}
