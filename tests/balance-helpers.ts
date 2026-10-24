import { canRestore, createGame, dispatch, proximityAlarm, step } from '../src/game/reducer';
import type { GameState } from '../src/game/state';
/** Perfect-information reducer test policy; this is not a human playtest or browser proof. */
export function playBalancedRun(seed: number, options: { slow?: boolean; elevated?: boolean; mistakes?: boolean; novice?: boolean } = {}): GameState {
  let state = createGame(seed), nextAction = 0;
  const mistakesMade = new Set<string>();
  if (options.elevated) state = dispatch(state, { type: 'sensor', source: 'simulated', quality: 'accepted', trend: 'ELEVATED' });
  while (state.status === 'playing' && state.time < 301) {
    if (state.equipment === 'blackout') state = dispatch(state, { type: 'restore', held: true });
    else if (state.equipment === 'on' && proximityAlarm(state).active && state.creature.linePosition <= 7 && state.shutdown.chargesRemaining > 0 && state.time >= state.shutdown.cooldownUntil) state = dispatch(state, { type: 'quiet' });
    if (state.equipment === 'on' && state.time >= nextAction) {
      const stage = state.tasks.stage;
      if (stage === 1 || stage === 3) {
        const faults = state.tasks.faults;
        if (faults.completed < faults.required && faults.active.length) {
          const wrong = [0, 1, 2, 3].find(i => !faults.active.includes(i));
          const mistakeKey = `${stage}:${options.novice ? faults.completed : 0}`;
          if ((options.mistakes || options.novice) && (!options.novice || faults.completed % 3 === 0) && !mistakesMade.has(mistakeKey) && wrong !== undefined) {
            state = dispatch(state, { type: 'input', value: wrong + 1 }); mistakesMade.add(mistakeKey);
          } else state = dispatch(state, { type: 'input', value: faults.active[0] + 1 });
          nextAction = state.time + (options.novice ? 3.5 : options.slow ? 2.5 : .3);
        } else if (faults.completed === faults.required) {
          const from = state.tasks.wires.connections.indexOf(-1);
          if (from >= 0) state = dispatch(state, { type: 'wire', from, to: state.tasks.wires.targetOrder.indexOf(from) });
          nextAction = state.time + (options.novice ? 2.5 : options.slow ? 1.5 : .3);
        }
      } else if (stage === 2 || stage === 4) {
        const memory = state.tasks.memory;
        if (memory.needsReplay) state = dispatch(state, { type: 'replay' });
        else if (memory.armed) state = dispatch(state, { type: 'transmit' });
        else if (!memory.playing) { state = dispatch(state, { type: 'input', value: memory.sequence[memory.input.length] }); nextAction = state.time + (options.novice ? 1.5 : options.slow ? 1 : .3); }
      } else if (stage === 5) state = dispatch(state, { type: 'transmit' });
    }
    state = step(state, .25);
  }
  return state;
}
