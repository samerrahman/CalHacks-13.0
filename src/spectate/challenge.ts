import { createGame, dispatch } from '../game/reducer';
import { startStage } from '../game/tasks';
import type { GameState } from '../game/state';

/** A practice copy of one of the player's own puzzles, run only on this page. Solving it arms a decoy. */
export type Challenge = { kind: 'conduit' | 'memory'; state: GameState };
export function challengeSeed(seed: number, index: number): number { return ((Math.imul((seed >>> 0) + 1, 31) + index * 7919 + 101) >>> 0) % 999_983; }
export function newChallenge(seed: number, index: number): Challenge {
  let state = createGame(challengeSeed(seed, index), 'tutorial');
  state.creature.nextMoveAt = 1e9; state.blackout.nextAt = 1e9;
  if (index % 2 === 1) { startStage(state, 2); return { kind: 'memory', state }; }
  // Reach the conduit the way the player does: the last cable of a patched panel opens it.
  state.tasks.faults.completed = state.tasks.faults.required; state.tasks.step = 'wires';
  state.tasks.wires.connections = state.tasks.wires.targetOrder.map(() => 0); state.tasks.wires.connections[0] = -1;
  state = dispatch(state, { type: 'wire', from: 0, to: state.tasks.wires.targetOrder.indexOf(0) });
  return { kind: 'conduit', state };
}
/** Conduit: engaged with the inlet joined to the outlet. Memory: the whole sequence repeated. */
export function challengeSolved(c: Challenge): boolean {
  return c.kind === 'conduit' ? c.state.tasks.completedStages.includes(1) : c.state.tasks.step === 'transmit' && c.state.tasks.memory.armed;
}
