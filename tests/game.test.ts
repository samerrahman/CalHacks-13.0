import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, step, canRestore, proximityAlarm, config } from '../src/game/reducer';
import { buildDirectorRequest, validateProposal, allowedPairs, allowedTaunts, DIRECTOR_TIMEOUT_MS } from '../src/game/directorValidation';
import { applyLure, commitIfEligible, contextualTaunt, movementProbabilities, projectCreature, restoreEquipment, triggerScare } from '../src/game/creature';
import { emit, type DirectorProposal, type GameState, type Tactic, type Target } from '../src/game/state';
import { startStage } from '../src/game/tasks';
import { playBalancedRun } from './balance-helpers';
/** Seeds the perfect-information policy wins under the current tuning; it is not guaranteed for every seed. */
const WINNING_SEEDS = [1, 2, 5, 6, 17, 18];

function at(position: number, time = 50): GameState {
  const state = createGame(17); state.time = time; state.creature.linePosition = position; state.creature.nextMoveAt = time + 2.5;
  state.creature.lastAudibleAt = time; state.creature.lastAudibleStrength = 1; state.creature.nearSince = position <= 7 ? time - 3 : null; state.creature.alarmLatched = position <= 7;
  projectCreature(state); return state;
}
function request(state: GameState): GameState { state.director.request = buildDirectorRequest(state); state.director.requestSequence++; return state; }
function proposal(state: GameState, tactic: Tactic = 'WAIT', target: Target = 'NONE'): DirectorProposal {
  const req = state.director.request!;
  return { requestId: req.requestId, stateVersion: req.stateVersion, tactic, target, evidenceEventIds: [], reasonCode: 'NO_VALID_SIGNAL', tauntId: tactic === 'TAUNT' ? allowedTaunts(state).find(id => id !== 'NONE')! : 'NONE' };
}

test('seeded line position and fixed-step clock are deterministic across frame sizes', () => {
  let small = createGame(17); for (let i = 0; i < 900; i++) small = step(small, 1 / 30);
  const large = step(createGame(17), 30);
  assert.deepEqual({ ...small, accumulator: 0 }, { ...large, accumulator: 0 });
  assert.equal(large.creature.distance, large.creature.linePosition);
  assert.ok(Number.isInteger(large.creature.linePosition));
});

test('initial25 seconds are nonlethal and the first discrete step occurs at27.5', () => {
  let state = step(createGame(17), 27.49);
  assert.equal(state.creature.linePosition, 18); assert.equal(state.creature.warning, null);
  assert.equal(state.events.some(e => e.type === 'MONSTER_STEP'), false);
  state = step(state, .02); assert.equal(state.events.filter(e => e.type === 'MONSTER_STEP').length, 1);
});

test('all natural steps are integers in bounds, at most3 and separated by2.5seconds', () => {
  for (let seed = 1; seed <= 12; seed++) {
    let state = createGame(seed), last = 0;
    while (state.status === 'playing' && state.time < 160) {
      state = step(state, 1);
      for (const event of state.events.filter(e => e.seq > last && e.type === 'MONSTER_STEP')) {
        const match = /^from=(\d+) to=(\d+) step=(-?\d+)$/.exec(event.detail)!;
        const [from, to, delta] = match.slice(1).map(Number);
        assert.equal(to - from, delta); assert.ok(Math.abs(delta) <= 3 && to >= 0 && to <= 24);
      }
      last = state.eventSequence;
    }
    const moves = state.events.filter(e => e.type === 'MONSTER_STEP');
    for (let i = 1; i < moves.length; i++) assert.ok(moves[i].time - moves[i - 1].time >= 2.499);
  }
});

test('near warning always precedes a committed natural approach by at least one movement interval', () => {
  let observed = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const state = step(createGame(seed), 300);
    const attack = state.events.find(e => e.type === 'ATTACK_COMMITTED');
    if (!attack) continue;
    observed++;
    const alarm = state.events.filter(e => e.type === 'PROXIMITY_ALARM' && e.time <= attack.time).at(-1)!;
    assert.ok(alarm && attack.time - alarm.time >= 2.499);
  }
  assert.ok(observed > 0);
});

test('early isolation spends one of5 charges without moving, auto-restores after12seconds and enters cooldown', () => {
  let state = at(7); state.creature.nextMoveAt = 100;
  const task = structuredClone(state.tasks);
  state = dispatch(state, { type: 'quiet' });
  assert.equal(state.creature.linePosition, 7); assert.equal(state.shutdown.chargesRemaining, config.shutdown.charges - 1); assert.equal(state.shutdown.used, 1);
  assert.equal(state.creature.nextMoveAt, 100); assert.equal(state.events.some(e => e.type === 'MONSTER_STEP'), false);
  const end = state.shutdown.activeUntil;
  state = dispatch(state, { type: 'quiet' }); assert.equal(state.shutdown.activeUntil, end); assert.equal(state.shutdown.chargesRemaining, config.shutdown.charges - 1);
  state = step(state, config.shutdown.durationSeconds); assert.equal(state.equipment, 'on'); assert.deepEqual(state.tasks, task);
  assert.ok(state.shutdown.cooldownUntil >= 50 + config.shutdown.durationSeconds + config.shutdown.cooldownSeconds - 1e-6);
  state = dispatch(state, { type: 'quiet' }); assert.equal(state.equipment, 'on'); assert.equal(state.shutdown.chargesRemaining, config.shutdown.charges - 1);
  assert.equal(state.events.at(-1)?.type, 'QUIET_COOLDOWN');
});

test('exhausted isolation cannot stop the equipment or provide another backstep', () => {
  let state = at(5); state.shutdown.chargesRemaining = 0;
  const before = state.creature.linePosition;
  state = dispatch(state, { type: 'quiet' });
  assert.equal(state.equipment, 'on'); assert.equal(state.creature.linePosition, before); assert.equal(state.events.at(-1)?.type, 'QUIET_EXHAUSTED');
});

test('Q and the final lure cannot reverse a committed strike, including dispatch boundary', () => {
  let state = at(1);
  state = dispatch(state, { type: 'quiet' }); assert.ok(state.creature.warning);
  assert.equal(state.creature.linePosition, 1); assert.equal(applyLure(state, 'CONTAINMENT'), false);
  state = step(state, 2.5); assert.equal(state.status, 'lost'); assert.equal(state.scare?.kind, 'breach');
});

test('idle running equipment draws an attack, the deadline still ends a quiet run, and tutorial remains nonlethal', () => {
  let camping = createGame(1); camping.tasks.faults.active = []; camping.tasks.faults.spawned = camping.tasks.faults.required;
  camping = step(camping, config.line.deadlineSeconds); assert.equal(camping.status, 'lost');
  assert.match(camping.lossReason ?? '', /reached the shelter/, 'doing nothing with the equipment on is not safe');
  let state = createGame(1); startStage(state, 5); state.creature.lastAudibleAt = -1000;
  state = step(state, config.line.deadlineSeconds); assert.equal(state.status, 'lost'); assert.ok(state.events.some(e => e.type === 'TIMEOUT'));
  assert.equal(state.lossReason, 'The 12-minute protocol window expired.');
  let practice = dispatch(createGame(1, 'tutorial'), { type: 'quiet' }); practice = step(practice, 600);
  assert.equal(practice.status, 'playing'); assert.equal(practice.creature.linePosition, 18); assert.equal(canRestore(practice), true); assert.equal(practice.shutdown.chargesRemaining, config.shutdown.charges);
});

test('blackout can always be restored without an isolation charge', () => {
  let state = at(12); state.equipment = 'blackout'; state.shutdown.chargesRemaining = 0;
  state = dispatch(state, { type: 'restore', held: true }); state = step(state, 1.1);
  assert.equal(state.equipment, 'on'); assert.equal(state.shutdown.chargesRemaining, 0); assert.equal(state.shutdown.cooldownUntil, 0);
});

test('blackout recovery neither creates nor extends an isolation cooldown', () => {
  for (const priorCooldown of [0, 60]) {
    let state = at(7); state.creature.nextMoveAt = 100; state.equipment = 'blackout'; state.shutdown.cooldownUntil = priorCooldown;
    state = dispatch(state, { type: 'restore', held: true }); state = step(state, 1.1);
    assert.equal(state.shutdown.cooldownUntil, priorCooldown);
    if (priorCooldown === 0) { state = dispatch(state, { type: 'quiet' }); assert.equal(state.equipment, 'quiet'); }
  }
});

test('quiet only biases the next scheduled step and cannot create an out-of-turn position change', () => {
  let state = dispatch(at(7), { type: 'quiet' }); const next = state.creature.nextMoveAt;
  const before = structuredClone(state.creature.position);
  state = step(state, 2.49); assert.deepEqual(state.creature.position, before); assert.equal(state.creature.linePosition, 7);
  assert.equal(state.events.some(event => event.type === 'MONSTER_STEP'), false);
  state = step(state, .02);
  const movement = state.events.filter(event => event.type === 'MONSTER_STEP');
  assert.equal(movement.length, 1); assert.ok(Math.abs(movement[0].time - next) < .001);
  assert.ok(Math.abs(state.creature.linePosition - 7) <= 3);
});

test('early F or a direct restore call cannot bypass the isolation restore window', () => {
  let state = dispatch(at(7), { type: 'quiet' });
  state = dispatch(state, { type: 'restore', held: true }); assert.equal(state.restoreHeld, false);
  restoreEquipment(state); assert.equal(state.equipment, 'quiet');
  state = step(state, 8); assert.equal(canRestore(state), true);
  state = dispatch(state, { type: 'restore', held: true }); state = step(state, 1.1); assert.equal(state.equipment, 'on');
});

test('danger uses bounded accepted coarse physiology and work noise, never raw pulse', () => {
  const base = createGame(4);
  const elevated = dispatch(base, { type: 'sensor', source: 'presage', quality: 'accepted', trend: 'ELEVATED' });
  assert.equal(elevated.danger - base.danger, config.danger.physiologyMaximum);
  assert.equal(dispatch(base, { type: 'sensor', source: 'presage', quality: 'rejected', trend: 'ELEVATED' }).danger, base.danger);
  assert.equal(dispatch(base, { type: 'sensor', source: 'manual', quality: 'accepted', trend: 'ELEVATED' }).danger, base.danger);
  let state = base;
  for (let i = 0; i < 20; i++) { const wrong = [1, 2, 3, 4].find(value => !state.tasks.faults.active.includes(value - 1))!; state = dispatch(state, { type: 'input', value: wrong }); state = step(state, .3); }
  assert.ok(state.pressure <= config.danger.pressureMaximum && state.danger <= 100);
  let quietState = createGame(4); const before = quietState.pressure;
  quietState = dispatch(quietState, { type: 'input', value: quietState.tasks.faults.active[0] + 1 }); assert.equal(quietState.pressure, before + config.danger.workPressure, 'correct work is loud');
});

test('physiology alone cannot commit an attack without audible evidence', () => {
  let state = at(1); state.creature.lastAudibleAt = -1000; state.creature.lastAudibleStrength = 0; state.tasks.faults.active = []; state.tasks.faults.spawned = state.tasks.faults.required;
  state.tasks.step = 'final'; // no research equipment running, so the room itself is silent
  state = dispatch(state, { type: 'sensor', source: 'presage', quality: 'accepted', trend: 'ELEVATED' });
  commitIfEligible(state); assert.equal(state.creature.warning, null);
});

test('pause freezes deadline, movement, shutdown duration and pending requests', () => {
  let state = dispatch(createGame(2), { type: 'quiet' }); state = request(state);
  state = dispatch(state, { type: 'pause', paused: true }); const snapshot = structuredClone(state);
  assert.deepEqual(step(state, 100), snapshot); assert.equal(state.director.request, null);
  assert.deepEqual(dispatch(state, { type: 'wire', from: 0, to: 1 }), state);
});

test('distance detector samples every4seconds and turns off immediately with the equipment', () => {
  let state = at(11); state.creature.sensorDistance = 18; state.creature.sensorSampleAt = 49; state.creature.nextMoveAt = 100;
  state = step(state, 2); assert.equal(state.creature.sensorDistance, 18);
  state = step(state, 1); assert.equal(state.creature.sensorDistance, 11);
  state = dispatch(state, { type: 'quiet' }); assert.equal(state.creature.sensorDistance, null);
  state = step(state, config.shutdown.durationSeconds); assert.equal(state.creature.sensorDistance, state.creature.linePosition);
});

test('memory starts at3/4 inputs, locks each tempo, uses16seconds and preserves progress in isolation', () => {
  let state = createGame(3); startStage(state, 2); assert.equal(state.tasks.memory.sequence.length, config.tasks.stage2.firstInputs);
  const tempo = state.tasks.memory.tempo;
  state = dispatch(state, { type: 'sensor', source: 'presage', quality: 'accepted', trend: 'ELEVATED' }); assert.equal(state.tasks.memory.tempo, tempo);
  state = step(state, 3.1); const before = structuredClone(state.tasks.memory);
  state = dispatch(state, { type: 'quiet' }); state = step(state, 7.9); assert.deepEqual(state.tasks.memory, before);
  state = step(state, 10); assert.ok(state.tasks.memory.responseElapsed < 16);
  startStage(state, 4); assert.equal(state.tasks.memory.sequence.length, config.tasks.stage4.firstInputs); assert.ok(state.tasks.memory.tempo <= 1.2);
});

test('director only changes bounded temporary biases, never position or movement clock', () => {
  const base = at(5); emit(base, 'WRONG_INPUT', 'FAULT');
  for (const pair of allowedPairs(base)) {
    const state = request(structuredClone(base)); const before = { position: state.creature.linePosition, next: state.creature.nextMoveAt, time: state.time };
    const accepted = dispatch(state, { type: 'proposal', proposal: proposal(state, pair.tactic, pair.target), source: 'GEMINI' });
    assert.equal(accepted.director.source, 'GEMINI');
    assert.deepEqual({ position: accepted.creature.linePosition, next: accepted.creature.nextMoveAt, time: accepted.time }, before);
    assert.ok(Math.abs(accepted.creature.tacticBias) <= .15);
  }
});

test('director request excludes private memory, wires, pulse values and report samples', () => {
  const state = createGame(17); const wire = [...state.tasks.wires.targetOrder]; startStage(state, 2);
  const payload = buildDirectorRequest(state); const text = JSON.stringify(payload);
  for (const key of ['sequence', 'targetOrder', 'connections', 'pulseBpm', 'baselineBpm', 'samples', 'routing', 'periodSeconds', 'calm', 'locate']) assert.equal(text.includes(`"${key}"`), false);
  assert.equal(payload.observations.linePosition, 18); assert.equal(payload.observations.lineLength, 24);
  assert.equal(payload.observations.quietChargesRemaining, config.shutdown.charges); assert.equal(wire.length, config.tasks.stage1.wires);
});

test('unknown fields, illegal pairs, stale versions and duplicate model responses are rejected', () => {
  let state = request(at(5));
  assert.equal(validateProposal({ ...proposal(state), position: 0 }, state), 'BAD_SHAPE');
  assert.equal(validateProposal(proposal(state, 'FOLLOW_LURE', 'CONTAINMENT'), state), 'ILLEGAL_PAIR');
  const old = proposal(state); state.version++; assert.equal(validateProposal(old, state), 'STALE_STATE');
  state = request(at(5)); const good = proposal(state); state = dispatch(state, { type: 'proposal', proposal: good, source: 'GEMINI' });
  assert.equal(validateProposal(good, state), 'DUPLICATE');
});

test('pending eight-second director calls do not block puzzle input or deterministic fallback', () => {
  let state = request(createGame(9)); const before = state.tasks.faults.completed;
  state = dispatch(state, { type: 'input', value: state.tasks.faults.active[0] + 1 }); assert.equal(state.tasks.faults.completed, before + 1);
  state = step(state, DIRECTOR_TIMEOUT_MS / 1000 + .1); assert.ok(state.director.fallbackCount > 0);
});

test('movement probabilities sum to1 and danger increases approach probability without unbounded steps', () => {
  const state = createGame(4); state.danger = 0; const low = movementProbabilities(state); state.danger = 100; const high = movementProbabilities(state);
  assert.ok(Math.abs(low.reduce((sum, item) => sum + item.probability, 0) - 1) < 1e-12);
  assert.ok(high.filter(item => item.step < 0).reduce((sum, item) => sum + item.probability, 0) > low.filter(item => item.step < 0).reduce((sum, item) => sum + item.probability, 0));
  assert.deepEqual(low.map(item => item.step), [-3, -2, -1, 0, 1, 2, 3]);
});

test('final lure moves through bounded local steps and seals only at the far endpoint', () => {
  let state = at(8); applyLure(state, 'CONTAINMENT'); assert.equal(state.creature.linePosition, 8);
  state = step(state, 100); assert.equal(state.status, 'won'); assert.equal(state.creature.linePosition, 24); assert.equal(state.tasks.stage, 6);
  assert.ok(state.events.some(e => e.type === 'LURE_ARRIVED'));
});

test('scares remain bounded and disabled in practice', () => {
  const state = createGame(1); for (let i = 0; i < 20; i++) { state.time = i * 20; triggerScare(state, 'monitor'); }
  assert.equal(state.scareCount, 8); triggerScare(state, 'breach'); assert.equal(state.scare?.kind, 'breach');
  const practice = createGame(1, 'tutorial'); triggerScare(practice, 'breach'); assert.equal(practice.scare, null);
});

test('grace blocks contextual taunts, scares and threatening director tactics', () => {
  const state = at(5, 10); emit(state, 'WRONG_INPUT', 'FAULT');
  assert.equal(contextualTaunt(state, 'AFTER_MISTAKE'), false); triggerScare(state, 'impact'); assert.equal(state.scare, null);
  assert.deepEqual(allowedPairs(state), [{ tactic: 'WAIT', target: 'NONE' }]); assert.deepEqual(allowedTaunts(state), ['NONE']);
});

test('authored taunts require context and enforce cooldown and run cap', () => {
  const state = at(5); assert.equal(contextualTaunt(state, 'AFTER_MISTAKE'), false);
  for (let i = 0; i < 8; i++) {
    state.time = 50 + i * 26; emit(state, 'WRONG_INPUT', 'WIRE');
    assert.equal(contextualTaunt(state, 'AFTER_MISTAKE'), i < 7);
    assert.equal(contextualTaunt(state, 'AFTER_MISTAKE'), false);
  }
  assert.equal(state.director.tauntCount, 7);
});

test('multiple seeds complete every wire board and thinking task, all research and final containment offline', () => {
  for (const seed of WINNING_SEEDS) {
    const state = playBalancedRun(seed); assert.equal(state.status, 'won', `seed${seed}`);
    assert.deepEqual(state.tasks.completedStages, [1, 2, 3, 4]); assert.equal(state.creature.linePosition, 24); assert.ok(state.time <= config.line.deadlineSeconds);
  }
});
