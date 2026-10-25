import { config } from './config';
import { calmInhale, faultSounds, mistake, sectorsAt, tileOpenings, wirePanel } from './tasks';
import { emit, type GameState } from './state';

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
  | { kind: 'calm'; stage: number; inhale: boolean; halfTenths: number; elapsedTenths: number; progress: number; required: number }
  /** Two-key door: the digits (1–4) the player must enter before the basement door motor starts. */
  | { kind: 'door'; stage: 5; key: number[] };

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
  if (t.step === 'final' && stage === 5 && doorNeedsKey(state)) return { kind: 'door', stage: 5, key: [...state.coop.doorKey] };
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

/** The basement door key for a run: four digits 1–4 from the seed alone, so it never shifts the run's random stream. */
export function doorKeyFor(seed: number): number[] {
  let h = (Math.imul((seed >>> 0) ^ 0x2c1b3c6d, 2654435761) >>> 0) || 1;
  return Array.from({ length: config.coop.doorKeyLength }, () => { h = (Math.imul(h ^ (h >>> 15), 2246822519) + 0x165667b1) >>> 0; return 1 + (h >>> 7) % 4; });
}
/** In co-op the final broadcast waits for the friend's key. Solo (and a run whose friend stopped sharing) never does. */
export function doorNeedsKey(state: GameState): boolean {
  return state.mode === 'coop' && !state.coop.doorUnlocked && !state.tasks.finalTransmitted;
}
/** Number keys at the final terminal enter the friend's key. A wrong digit is a loud mistake and starts over. */
export function enterDoorKey(state: GameState, value: number): void {
  if (!doorNeedsKey(state) || state.tasks.stage !== 5 || state.tasks.step !== 'final') return;
  const coop = state.coop, key = coop.doorKey;
  if (value !== key[coop.doorInput.length]) {
    coop.doorInput = [];
    mistake(state, 'DOOR', 'Wrong door key. The lock buzzed loudly. Ask your friend to read it again, from the first digit.');
    return;
  }
  coop.doorInput.push(value);
  if (coop.doorInput.length < key.length) { state.notice = `${coop.doorInput.length} / ${key.length} key digits accepted.`; return; }
  coop.doorUnlocked = true; state.version++;
  emit(state, 'DOOR_UNLOCKED');
  state.notice = 'Your friend’s key turned. Press T to send the last decoy heartbeat and start the door motor.';
}
/** Remaining remote decoys for the friend's page and the player's HUD. */
export function decoysLeft(state: Pick<GameState, 'coop'>): number { return Math.max(0, config.coop.decoy.charges - state.coop.decoysUsed); }
/** A friend's warning lamp (information only) or remote decoy (a brief outward pull). Revalidated here:
 * co-op only, cooldowns, limited charges, never once an attack has committed or the final broadcast is live. */
export function friendSignal(state: GameState, signal: 'warn' | 'decoy'): void {
  if (state.mode !== 'coop' || state.status !== 'playing') return;
  const coop = state.coop, settings = config.coop;
  if (signal === 'warn') {
    if (state.time - coop.warnedAt < settings.warnCooldownSeconds) return;
    coop.warnedAt = state.time; coop.warnings++;
    emit(state, 'FRIEND_WARNING');
    return;
  }
  if (signal !== 'decoy' || coop.decoysUsed >= settings.decoy.charges || state.time - coop.lastDecoyAt < settings.decoy.cooldownSeconds
    || state.creature.warning || state.tasks.finalTransmitted) return;
  coop.decoysUsed++; coop.lastDecoyAt = state.time; coop.decoyUntil = state.time + settings.decoy.durationSeconds;
  emit(state, 'FRIEND_DECOY', String(coop.decoysUsed));
}
