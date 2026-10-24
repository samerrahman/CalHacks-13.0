import { config, createGame, dispatch, proximityAlarm, step } from '../src/game/reducer';
import { calmInhale, sectorsAt } from '../src/game/tasks';
import type { GameState } from '../src/game/state';

/** Seconds per action and error rate. These are reducer policies with perfect puzzle
 * knowledge and scripted reaction times; they are not a human playtest or browser proof. */
export type Pace = { fault: number; wire: number; digit: number; think: number; react: number; route: number; look: number; jitter: number; mistakes: number };
export const PACES = {
  perfect: { fault: .3, wire: .3, digit: .3, think: .2, react: .2, route: .5, look: .5, jitter: 0, mistakes: 0 },
  fast: { fault: .5, wire: 1.2, digit: .45, think: .6, react: .8, route: 3, look: 1.2, jitter: .04, mistakes: 0 },
  human: { fault: 1, wire: 2.2, digit: .7, think: 1.2, react: 1.5, route: 8, look: 2, jitter: .08, mistakes: .05 },
  slow: { fault: 1.6, wire: 3.4, digit: 1, think: 2, react: 2.5, route: 14, look: 3, jitter: .1, mistakes: .14 },
} satisfies Record<string, Pace>;

const SUBSETS = Array.from({ length: 15 }, (_, i) => i + 1);
export function playBalancedRun(seed: number, options: { pace?: keyof typeof PACES; elevated?: boolean } = {}): GameState & { alarmTimes: number[] } {
  const p: Pace = PACES[options.pace ?? 'perfect'];
  let state = createGame(seed), next = 0, inputs = 0, alarmAt = -1, readyAt = -1, nextTap = -1;
  const alarmTimes: number[] = [];
  const roll = () => p.mistakes > 0 && (Math.imul(seed * 7919 + inputs, 2654435761) >>> 0) / 4294967296 < p.mistakes;
  const wobble = () => (((Math.imul(seed * 104729 + inputs, 2246822519) >>> 0) / 4294967296) * 2 - 1) * p.jitter;
  if (options.elevated) state = dispatch(state, { type: 'sensor', source: 'simulated', quality: 'accepted', trend: 'ELEVATED' });
  while (state.status === 'playing' && state.time < config.line.deadlineSeconds + 1) {
    const alarm = proximityAlarm(state).active;
    if (alarm && alarmAt < 0) { alarmAt = state.time; alarmTimes.push(state.time); }
    if (!alarm) alarmAt = -1;
    if (state.equipment === 'blackout') state = dispatch(state, { type: 'restore', held: true });
    else if (state.equipment === 'on' && alarm && state.time - alarmAt >= p.react && state.shutdown.chargesRemaining > 0 && state.time >= state.shutdown.cooldownUntil && !state.creature.warning) state = dispatch(state, { type: 'quiet' });
    const t = state.tasks, stepName = t.step;
    // With no isolation available, a sensible player goes silent until the alarm clears.
    const freeze = alarm && state.equipment === 'on' && (state.shutdown.chargesRemaining === 0 || state.time < state.shutdown.cooldownUntil);
    if (state.equipment === 'on' && state.time >= next && !freeze) {
      const mistake = roll();
      if (stepName !== 'locate' && state.station !== 'terminal') state = dispatch(state, { type: 'station', station: 'terminal' });
      if (stepName === 'faults' && t.faults.active.length) {
        const wrong = [0, 1, 2, 3].find(i => !t.faults.active.includes(i))!;
        state = dispatch(state, { type: 'input', value: (mistake ? wrong : t.faults.active[0]) + 1 }); inputs++; next = state.time + p.fault;
      } else if (stepName === 'wires') {
        const from = t.wires.connections.indexOf(-1), to = t.wires.targetOrder.indexOf(from), panel = Math.floor(from / config.tasks.wirePanelSize);
        const wrong = t.wires.targetOrder.findIndex((cable, socket) => socket !== to && Math.floor(socket / config.tasks.wirePanelSize) === panel && !t.wires.connections.includes(socket) && cable !== from);
        state = dispatch(state, { type: 'wire', from, to: mistake && wrong >= 0 ? wrong : to }); inputs++; next = state.time + p.wire;
      } else if (stepName === 'routing') {
        if (readyAt < 0) readyAt = state.time + p.route;
        else if (state.time >= readyAt) {
          const r = t.routing, right = SUBSETS.find(bits => { const power = r.power.reduce((s, v, i) => bits & 1 << i ? s + v : s, 0), noise = r.noise.reduce((s, v, i) => bits & 1 << i ? s + v : s, 0); return power >= r.required && noise <= r.limit; })!;
          const want = mistake ? 15 : right;
          for (let i = 0; i < 4; i++) if (!!(want & 1 << i) !== r.on[i]) state = dispatch(state, { type: 'route', machine: i });
          state = dispatch(state, { type: 'engage' }); inputs++; readyAt = -1; next = state.time + .5;
        }
      } else if (stepName === 'locate') {
        if (state.station !== 'cameras') { state = dispatch(state, { type: 'station', station: 'cameras' }); next = state.time + p.look; }
        else if (state.time >= t.locate.lastMarkAt + config.tasks.locate.spacingSeconds) {
          const truth = sectorsAt(state.creature.linePosition)[0], sectors = ['NEAR', 'A', 'B', 'C'] as const;
          state = dispatch(state, { type: 'mark', sector: mistake ? sectors[(sectors.indexOf(truth) + 2) % 4] : truth }); inputs++; next = state.time + p.look;
        }
      } else if (stepName === 'pulse') {
        if (nextTap < 0 || t.pulse.lastTap === null) { state = dispatch(state, { type: 'tap' }); nextTap = state.time + t.pulse.periodSeconds * (1 + wobble()); inputs++; }
        else if (state.time >= nextTap) { state = dispatch(state, { type: 'tap' }); nextTap = state.time + t.pulse.periodSeconds * (1 + wobble()); inputs++; }
      } else if (stepName === 'calm') {
        const inhale = calmInhale({ ...state, time: state.time - p.react / 3 } as GameState);
        if (t.calm.holding !== inhale) state = dispatch(state, { type: 'breathe', holding: inhale });
      } else if (stepName === 'memory') {
        const memory = t.memory;
        if (memory.playing) readyAt = -1;
        else if (memory.needsReplay) state = dispatch(state, { type: 'replay' });
        else {
          if (readyAt < 0) readyAt = state.time + p.think;
          if (state.time >= readyAt) { const v = memory.sequence[memory.input.length]; state = dispatch(state, { type: 'input', value: mistake ? v % 4 + 1 : v }); inputs++; next = state.time + p.digit; }
        }
      } else if (stepName === 'transmit' || stepName === 'final') { state = dispatch(state, { type: 'transmit' }); readyAt = -1; nextTap = -1; }
    }
    if (stepName !== 'pulse') nextTap = -1;
    state = step(state, stepName === 'pulse' ? 1 / 30 : stepName === 'calm' ? .1 : .2);
  }
  return Object.assign(state, { alarmTimes });
}
