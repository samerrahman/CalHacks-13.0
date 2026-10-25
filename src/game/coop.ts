import { calmInhale, faultSounds, sectorsAt, tileOpenings, wirePanel } from './tasks';
import type { GameState } from './state';

/** Co-op ("Keep Talking" style): the player loses the keys and a spectating friend reads them from a manual.
 * v2 covers faults, cables, conduit, memory, locate and calm hold; the heartbeat mask plays as in standard.
 * - faults: `sounds[machine]` indexes FAULT_SOUNDS for machines 1–4 of the live stage.
 * - wires: `sockets[cable]` is the socket code index (A, B, …) on the live panel; cables keep their panel symbols.
 * - routing: `tiles[i]` is the solved openings bitmask (N1 E2 S4 W8) of each route tile; 0 marks a tile off the route.
 * - memory: the live sequence (digits 1–4), how many the player has entered, and whether playback is still running.
 * - locate: the rings (0 near … 3 far, the radar's keys 1–4) where a mark lands now, and marks made of required.
 * - calm: the pacer's current half-breath (in or out), its length and how far into it, in tenths of a second, plus progress. */
export type CoopManual =
  | { kind: 'faults'; stage: number; sounds: number[] }
  | { kind: 'wires'; stage: number; panel: number; panels: number; sockets: number[] }
  | { kind: 'routing'; stage: number; size: number; start: number; end: number; tiles: number[] }
  | { kind: 'memory'; stage: number; sequence: number[]; entered: number; playing: boolean }
  | { kind: 'locate'; stage: number; rings: number[]; marks: number; required: number }
  | { kind: 'calm'; stage: number; inhale: boolean; halfTenths: number; elapsedTenths: number; progress: number; required: number };

const RINGS = ['NEAR', 'A', 'B', 'C'] as const;

/** Neutral code the player sees on socket `index` of a panel in co-op. */
export const socketCode = (index: number): string => String.fromCharCode(65 + index);

/** The key for the live task only, or null. Nothing at all outside co-op. Never part of the trace or any provider request. */
export function coopManual(state: GameState): CoopManual | null {
  if (state.mode !== 'coop' || state.status !== 'playing') return null;
  const t = state.tasks, stage = t.stage;
  if (t.step === 'faults' && (stage === 1 || stage === 3)) return { kind: 'faults', stage, sounds: faultSounds(state) };
  if (t.step === 'wires' && t.wires.connections.length) {
    const panel = wirePanel(t.wires);
    return { kind: 'wires', stage, panel: panel.index, panels: panel.count, sockets: Array.from({ length: panel.size }, (_, cable) => t.wires.targetOrder.indexOf(panel.start + cable) - panel.start) };
  }
  if (t.step === 'routing' && t.routing.size) {
    const r = t.routing;
    return { kind: 'routing', stage, size: r.size, start: r.start, end: r.end, tiles: r.answer.map((turns, tile) => turns < 0 ? 0 : tileOpenings(r.kinds[tile]!, turns)) };
  }
  if (t.step === 'memory' && (stage === 2 || stage === 4) && t.memory.sequence.length)
    return { kind: 'memory', stage, sequence: [...t.memory.sequence], entered: t.memory.input.length, playing: !!t.memory.playing };
  if (t.step === 'locate') {
    const c = state.creature, observed = new Set([...sectorsAt(c.linePosition), ...(c.sensorDistance === null ? [] : sectorsAt(c.sensorDistance))]);
    return { kind: 'locate', stage, rings: RINGS.flatMap((ring, i) => observed.has(ring) ? [i] : []), marks: t.locate.marks, required: t.locate.required };
  }
  if (t.step === 'calm') {
    const calm = t.calm, half = Math.round(calm.halfSeconds * 10), into = Math.round((state.time - calm.phaseStartedAt) * 10) % Math.max(1, half);
    return { kind: 'calm', stage, inhale: calmInhale(state), halfTenths: half, elapsedTenths: Math.max(0, into), progress: Math.floor(calm.progress), required: calm.required };
  }
  return null;
}
