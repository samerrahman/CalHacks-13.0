import { faultSounds, tileOpenings, wirePanel } from './tasks';
import type { GameState } from './state';

/** Co-op ("Keep Talking" style): the player loses the keys and a spectating friend reads them from a manual.
 * v1 covers the three key-based tasks; memory, heartbeat mask, locate and calm hold play as in standard.
 * - faults: `sounds[machine]` indexes FAULT_SOUNDS for machines 1–4 of the live stage.
 * - wires: `sockets[cable]` is the socket code index (A, B, …) on the live panel; cables keep their panel symbols.
 * - routing: `tiles[i]` is the solved openings bitmask (N1 E2 S4 W8) of each route tile; 0 marks a tile off the route. */
export type CoopManual =
  | { kind: 'faults'; stage: number; sounds: number[] }
  | { kind: 'wires'; stage: number; panel: number; panels: number; sockets: number[] }
  | { kind: 'routing'; stage: number; size: number; start: number; end: number; tiles: number[] };

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
  return null;
}
