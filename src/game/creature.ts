import { emit, type GameState, type Side } from './state';
import { MARA_DIALOGUE } from './dialogue';

export function canProbe(state: GameState, side: Side): boolean {
  return state.status === 'playing' && state.blackoutRemaining === null && state.creature.phase === 'dormant'
    && state.time >= state.creature.recoveryUntil && state.time >= state.safeUntil[side]
    && (state.creature.lastSide === side || state.time - state.creature.dormantSince >= 8)
    && state.creature.attacks.filter(at => state.time - at < 60).length < 3;
}

export function startProbe(state: GameState, side: Side): boolean {
  if (!canProbe(state, side)) return false;
  state.creature.phase = 'approach'; state.creature.side = side; state.creature.phaseStarted = state.time;
  state.creature.attacks.push(state.time); state.version++;
  state.notice = `${side.toUpperCase()} corridor: measured footsteps. Approach takes at least eight seconds.`;
  emit(state, 'APPROACH', `Footsteps and silhouette in the ${side} corridor. Minimum approach: 8 seconds.`);
  return true;
}

export function retreat(state: GameState, reason: string): void {
  const c = state.creature;
  c.lastSide = c.side ?? c.lastSide;
  c.phase = 'retreat'; c.phaseStarted = state.time;
  c.recoveryUntil = Math.max(c.recoveryUntil, state.time + (state.trend === 'ELEVATED' ? 20 : 12));
  state.version++;
  emit(state, 'RETREAT', `${reason} Recovery granted until ${c.recoveryUntil.toFixed(1)} seconds.`);
}

export function sweep(state: GameState, side: Side): void {
  if (state.time + 1e-8 < state.sweepReadyAt) { state.notice = `Floodlight recharges in ${Math.ceil(state.sweepReadyAt - state.time)} seconds.`; return; }
  if (state.energy < 8) { state.notice = 'Floodlight needs 8 energy. Open both shutters to recharge.'; return; }
  state.energy = Math.max(0, state.energy - 8);
  state.sweepReadyAt = state.time + 12;
  state.safeUntil[side] = state.time + 12;
  const occupied = state.creature.side === side && ['approach', 'threshold'].includes(state.creature.phase);
  if (occupied) retreat(state, `Floodlight repelled the creature from ${side}.`);
  state.notice = `${side.toUpperCase()} sweep ${occupied ? 'repelled the creature' : 'confirmed clear'}. −8 energy. ${MARA_DIALOGUE.sweep}`;
  state.version++;
  emit(state, 'SWEEP', `${side} confirmed clear until ${state.safeUntil[side].toFixed(1)} seconds; 8 energy spent.`);
}

export function tickCreature(state: GameState): void {
  const c = state.creature;
  if (c.phase === 'approach' && state.time - c.phaseStarted >= 8 - 1e-8) {
    if (state.blackoutRemaining !== null || (c.side && state.time < state.safeUntil[c.side])) return;
    c.phase = 'threshold'; c.phaseStarted = state.time; state.version++;
    state.notice = `${c.side?.toUpperCase()} THRESHOLD — six seconds to close that shutter or sweep.`;
    emit(state, 'THRESHOLD', `${c.side} threshold warning. At least 6 seconds remain to defend.`);
  } else if (c.phase === 'threshold' && state.time - c.phaseStarted >= 6 - 1e-8) {
    if (state.blackoutRemaining !== null) return;
    if (!c.side || state.time < state.safeUntil[c.side] || state.time < c.recoveryUntil) { retreat(state, 'Protected corridor.'); return; }
    if (!state.doors[c.side]) { retreat(state, `${c.side} shutter blocked entry.`); state.notice = `Shutter held. ${MARA_DIALOGUE.recover}`; return; }
    state.status = 'lost'; state.holding = false;
    state.lossReason = `The ${c.side} shutter stayed open through the full six-second threshold warning.`;
    emit(state, 'SHIFT_LOST', 'Creature entered after its approach and threshold warning.');
  } else if (c.phase === 'retreat' && state.time - c.phaseStarted >= 2 - 1e-8) {
    c.phase = 'recover'; c.phaseStarted = state.time; c.side = null; c.dormantSince = state.time; state.version++;
  } else if (c.phase === 'recover' && state.time >= c.recoveryUntil - 1e-8) {
    c.phase = 'dormant'; c.phaseStarted = state.time; state.version++;
  }
}
