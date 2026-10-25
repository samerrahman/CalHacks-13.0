import test from 'node:test';
import assert from 'node:assert/strict';
import { config, createGame, dispatch, step } from '../src/game/reducer';
import { movementProbabilities } from '../src/game/creature';
import { calmInhale, conduitConnected, energizedTiles, FAULT_SOUNDS, faultSounds, listeningTo, memoryRounds, pulseRequirement, sectorsAt, startStage, tileOpenings } from '../src/game/tasks';
import type { GameState } from '../src/game/state';

function at(which: GameState['tasks']['step'], seed = 17): GameState {
  const s = createGame(seed); s.time = 60; s.creature.nextMoveAt = 1000; s.blackout.nextAt = 1000;
  if (which === 'routing') { s.tasks.faults.completed = s.tasks.faults.required; s.tasks.step = 'wires'; s.tasks.wires.connections = s.tasks.wires.targetOrder.map(() => 0); s.tasks.wires.connections[0] = -1; return dispatch(s, { type: 'wire', from: 0, to: s.tasks.wires.targetOrder.indexOf(0) }); }
  if (which === 'locate') { startStage(s, 3); s.tasks.faults.completed = s.tasks.faults.required; s.tasks.step = 'wires'; s.tasks.wires.connections = s.tasks.wires.targetOrder.map(() => 0); s.tasks.wires.connections[0] = -1; return dispatch(s, { type: 'wire', from: 0, to: s.tasks.wires.targetOrder.indexOf(0) }); }
  startStage(s, which === 'pulse' ? 2 : 4);
  let state = s;
  for (let round = 0; round < memoryRounds(state).rounds; round++) {
    while (state.tasks.memory.playing) state = step(state, .2);
    for (const value of [...state.tasks.memory.sequence]) state = dispatch(state, { type: 'input', value });
  }
  return state;
}
function solve(state: GameState): GameState {
  state.tasks.routing.answer.forEach((want, tile) => { if (want >= 0) for (let k = (want - state.tasks.routing.turns[tile]! + 4) % 4; k > 0; k--) state = dispatch(state, { type: 'rotate', tile }); });
  return dispatch(state, { type: 'engage' });
}

test('every conduit board is solvable, starts broken, and its answer joins the inlet to the outlet', () => {
  assert.deepEqual([0, 1, 2, 3].map(t => tileOpenings(2, t)), [3, 6, 12, 9], 'a corner turns clockwise');
  for (let seed = 1; seed <= 40; seed++) {
    let state = at('routing', seed); assert.equal(state.tasks.step, 'routing');
    for (let round = 0; round < config.tasks.routing.rounds; round++) {
      assert.equal(conduitConnected(state.tasks.routing), false, `seed${seed}: starts broken`);
      state = solve(state);
    }
    assert.deepEqual(state.tasks.completedStages, [1]); assert.equal(state.tasks.stage, 2);
  }
});

test('rotating conduit tiles is quiet; engaging a broken conduit is a loud mistake; only the terminal works it', () => {
  let state = at('routing'); const pressure = state.pressure, events = state.eventSequence, turns = [...state.tasks.routing.turns];
  state = dispatch(state, { type: 'rotate', tile: 0 }); state = dispatch(state, { type: 'input', value: 2 });
  assert.equal(state.pressure, pressure); assert.equal(state.eventSequence, events); assert.equal(state.tasks.routing.turns[0], (turns[0]! + 1) % 4);
  assert.ok(energizedTiles(state.tasks.routing) instanceof Set);
  state = dispatch(state, { type: 'transmit' });
  if (!conduitConnected(state.tasks.routing)) { assert.equal(state.events.at(-1)?.detail, 'ROUTING'); assert.ok(state.pressure > pressure); }
  const elsewhere = dispatch(dispatch(state, { type: 'station', station: 'cameras' }), { type: 'rotate', tile: 1 });
  assert.equal(elsewhere.tasks.routing.turns[1], state.tasks.routing.turns[1]);
});

test('faults are found by ear: a shuffled sound key plays first, no fault spawns meanwhile, and nothing marks the answer', () => {
  let state = createGame(23); state.time = 30; state.creature.nextMoveAt = 1e6; state.blackout.nextAt = 1e6; startStage(state, 1);
  const key = faultSounds(state); assert.deepEqual([...key].sort(), [0, 1, 2, 3]);
  const keys = new Set([1, 2, 3, 4, 5, 6].map(seed => { const s = createGame(seed); startStage(s, 1); return faultSounds(s).join(); }));
  assert.ok(keys.size > 1, 'the key is shuffled between runs');
  const s3 = structuredClone(state); s3.tasks.stage = 3; assert.equal(faultSounds(s3).length, 4);
  assert.equal(listeningTo(state), 0); state = step(state, config.tasks.listen.secondsPerMachine); assert.equal(listeningTo(state), 1);
  state = step(state, config.tasks.listen.secondsPerMachine * 2.5); assert.equal(state.tasks.faults.active.length, 0, 'no fault spawns while the key plays');
  state = step(state, config.tasks.listen.secondsPerMachine + config.tasks.stage1.spawnIntervalSeconds); assert.equal(listeningTo(state), null); assert.equal(state.tasks.faults.active.length, 1);
  const machine = state.tasks.faults.active[0]!; assert.ok(FAULT_SOUNDS[key[machine]!]);
  const wrong = dispatch(state, { type: 'input', value: (machine + 1) % 4 + 1 }); assert.equal(wrong.events.at(-1)?.detail, 'FAULT');
  state = dispatch(state, { type: 'input', value: machine + 1 }); assert.equal(state.tasks.faults.completed, 1);
  state = dispatch(state, { type: 'listen' }); assert.equal(listeningTo(state), 0, 'L replays the key');
  assert.equal(dispatch(dispatch(state, { type: 'station', station: 'cameras' }), { type: 'listen' }).tasks.faults.listenFrom, state.tasks.faults.listenFrom);
});

test('locate marks need the monitor, the true or last-sampled sector, and spacing between marks', () => {
  let state = at('locate'); assert.equal(state.tasks.step, 'locate');
  assert.deepEqual(sectorsAt(3), ['NEAR']); assert.deepEqual(sectorsAt(7), ['A']); assert.deepEqual(sectorsAt(14), ['A', 'B']); assert.deepEqual(sectorsAt(22), ['B', 'C']); assert.deepEqual(sectorsAt(24), ['C']);
  state.creature.linePosition = 16; state.creature.sensorDistance = 12;
  assert.equal(dispatch(state, { type: 'mark', sector: 'B' }).tasks.locate.marks, 0, 'marking needs the security monitor');
  state = dispatch(state, { type: 'station', station: 'cameras' });
  const wrong = dispatch(state, { type: 'mark', sector: 'C' }); assert.equal(wrong.events.at(-1)?.detail, 'LOCATE'); assert.equal(wrong.tasks.locate.marks, 0);
  state = dispatch(state, { type: 'input', value: 3 }); assert.equal(state.tasks.locate.marks, 1, 'key 3 marks CAM B');
  assert.equal(dispatch(state, { type: 'mark', sector: 'A' }).tasks.locate.marks, 1, 'marker recharges between marks');
  for (let mark = 2; mark <= config.tasks.locate.marks; mark++) {
    state = step(state, config.tasks.locate.spacingSeconds); state.creature.linePosition = 16; state.creature.sensorDistance = 12; state.creature.sensorSampleAt = state.time;
    state = dispatch(state, { type: 'mark', sector: 'A' }); if (mark < config.tasks.locate.marks) assert.equal(state.tasks.locate.marks, mark, 'the last detector reading also counts');
  }
  assert.deepEqual(state.tasks.completedStages, [3]); assert.equal(state.tasks.stage, 4);
});

test('heartbeat mask locks on matched intervals; an accepted elevated trend demands more, manual data is neutral', () => {
  let state = at('pulse'); assert.equal(state.tasks.step, 'pulse'); assert.equal(state.tasks.memory.armed, false);
  const period = state.tasks.pulse.periodSeconds; assert.ok(period >= 60 / config.tasks.pulse.maximumBpm - 1e-9 && period <= 60 / config.tasks.pulse.minimumBpm + 1e-9);
  assert.deepEqual(pulseRequirement(state), { beats: config.tasks.pulse.beats, tolerance: config.tasks.pulse.tolerance });
  state = dispatch(state, { type: 'tap' }); state = step(state, period * .5); state = dispatch(state, { type: 'tap' });
  assert.equal(state.tasks.pulse.streak, 0, 'double-time taps do not count');
  const elevated = dispatch(state, { type: 'sensor', source: 'presage', quality: 'accepted', trend: 'ELEVATED' });
  assert.deepEqual(pulseRequirement(elevated), { beats: config.tasks.pulse.elevatedBeats, tolerance: config.tasks.pulse.elevatedTolerance });
  assert.deepEqual(pulseRequirement(dispatch(state, { type: 'sensor', source: 'manual', quality: 'accepted', trend: 'ELEVATED' })), { beats: config.tasks.pulse.beats, tolerance: config.tasks.pulse.tolerance });
  for (let beat = 0; beat < config.tasks.pulse.beats; beat++) { state = step(state, period); state = dispatch(state, { type: 'input', value: 1 }); }
  assert.equal(state.tasks.step, 'transmit'); assert.equal(state.tasks.memory.armed, true);
  state = dispatch(state, { type: 'transmit' }); assert.equal(state.tasks.stage, 3);
});

test('calm hold follows the breathing pacer; live data speeds or slows it but never blocks it', () => {
  const run = (sensor?: { trend: 'STEADY' | 'ELEVATED' }, follow = true) => {
    let state = at('calm'); assert.equal(state.tasks.step, 'calm');
    if (sensor) state = dispatch(state, { type: 'sensor', source: 'simulated', quality: 'accepted', trend: sensor.trend });
    let seconds = 0;
    while (state.tasks.step === 'calm' && seconds < 80) { state = dispatch(state, { type: 'breathe', holding: follow ? calmInhale(state) : !calmInhale(state) }); state = step(state, .1); seconds += .1; }
    return { state, seconds };
  };
  const neutral = run(), steady = run({ trend: 'STEADY' }), elevated = run({ trend: 'ELEVATED' }), wrong = run(undefined, false);
  assert.equal(neutral.state.tasks.step, 'transmit'); assert.ok(Math.abs(neutral.seconds - config.tasks.calm.seconds) < 1);
  assert.ok(steady.seconds < neutral.seconds, 'a steady accepted pulse helps');
  assert.equal(elevated.state.tasks.step, 'transmit'); assert.ok(elevated.seconds > neutral.seconds * 1.4, 'an elevated pulse slows it');
  assert.equal(wrong.state.tasks.step, 'calm', 'breathing against the pacer never completes');
  let paused = at('calm'); paused = dispatch(paused, { type: 'breathe', holding: true }); paused = dispatch(paused, { type: 'quiet' }); paused = step(paused, 3);
  assert.equal(paused.tasks.calm.progress, 0, 'isolation pauses the calm hold');
});

test('memory grows one cue per matched round before the thinking task', () => {
  let state = createGame(5); startStage(state, 2);
  const { first, last, rounds } = memoryRounds(state); assert.equal(rounds, last - first + 1);
  for (let length = first; length <= last; length++) {
    while (state.tasks.memory.playing) state = step(state, .2);
    assert.equal(state.tasks.memory.sequence.length, length); assert.equal(state.tasks.step, 'memory');
    for (const value of [...state.tasks.memory.sequence]) state = dispatch(state, { type: 'input', value });
  }
  assert.equal(state.tasks.step, 'pulse');
});

test('correct work raises exposure, silence cools it, isolation cools fastest and a lost trail drifts outward', () => {
  let state = createGame(8); state.time = 60; state.creature.nextMoveAt = 1000; state.blackout.nextAt = 1000;
  for (let i = 0; i < 6; i++) { while (!state.tasks.faults.active.length) state = step(state, .1); state = dispatch(state, { type: 'input', value: state.tasks.faults.active[0] + 1 }); }
  const working = state.pressure; assert.ok(working > 5);
  state.tasks.faults.active = []; state.tasks.faults.spawned = state.tasks.faults.required;
  const idle = step(state, 5), isolated = step(dispatch(state, { type: 'quiet' }), 5);
  assert.ok(idle.pressure < working && isolated.pressure < idle.pressure);
  const heard = structuredClone(idle); heard.creature.lastAudibleAt = heard.time;
  const lost = structuredClone(idle); lost.creature.lastAudibleAt = lost.time - config.lineBias.lostTrailSeconds - 1;
  const away = (s: GameState) => movementProbabilities(s).filter(p => p.step > 0).reduce((total, p) => total + p.probability, 0);
  assert.ok(away(lost) > away(heard));
});
