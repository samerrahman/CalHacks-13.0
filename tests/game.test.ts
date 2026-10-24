import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, step, canRestore, warningRemaining, cameraVisible, currentSedation, lureProtected, proximityAlarm } from '../src/game/reducer';
import { buildDirectorRequest, validateProposal, allowedPairs, allowedTaunts, DIRECTOR_TIMEOUT_MS } from '../src/game/directorValidation';
import { distance, routeTo, applyLure, triggerScare } from '../src/game/creature';
import { NODES } from '../src/game/config';
import type { DirectorProposal, GameState, Tactic, Target } from '../src/game/state';

function until(state: GameState, predicate: (state: GameState) => boolean, seconds = 120): GameState {
  const end = state.time + seconds;
  while (!predicate(state) && state.status === 'playing' && state.time < end) state = step(state, .1);
  assert.ok(predicate(state), `Condition not met by ${state.time.toFixed(2)}s, stage${state.tasks.stage}, ${state.status}`);
  return state;
}
function faults(state: GameState): GameState {
  const stage = state.tasks.stage;
  while (state.tasks.stage === stage && state.status === 'playing') {
    const active = state.tasks.faults.active[0];
    if (active !== undefined) state = dispatch(state, { type: 'input', value: active + 1 });
    else state = step(state, .1);
  }
  return state;
}
function memory(state: GameState): GameState {
  state = until(state, s => !s.tasks.memory.playing, 5);
  for (const value of [...state.tasks.memory.sequence]) state = dispatch(state, { type: 'input', value });
  assert.ok(state.tasks.memory.armed);
  return dispatch(state, { type: 'transmit' });
}
function playableWin(seed: number, slow = false): GameState {
  let state = createGame(seed);
  let nextAction = 0;
  while (state.status === 'playing' && state.time < 700) {
    if (state.equipment === 'blackout' || state.equipment === 'on' && proximityAlarm(state).active && !lureProtected(state)) state = dispatch(state, { type: 'quiet' });
    if (canRestore(state)) state = dispatch(state, { type: 'restore', held: true });
    if (state.equipment === 'on' && state.time >= nextAction) {
      if (state.tasks.stage === 1 || state.tasks.stage === 3) {
        const active = state.tasks.faults.active[0];
        if (active !== undefined) { state = dispatch(state, { type: 'input', value: active + 1 }); nextAction = state.time + (slow ? 8 : .2); }
      } else if (state.tasks.stage === 2 || state.tasks.stage === 4) {
        const m = state.tasks.memory;
        if (m.needsReplay) state = dispatch(state, { type: 'replay' });
        else if (m.armed) state = dispatch(state, { type: 'transmit' });
        else if (!m.playing) { state = dispatch(state, { type: 'input', value: m.sequence[m.input.length] }); nextAction = state.time + (slow ? 2 : .2); }
      } else if (state.tasks.stage === 5) state = dispatch(state, { type: 'transmit' });
    }
    state = step(state, .2);
  }
  return state;
}
function withRequest(state: GameState): GameState {
  state.director.request = buildDirectorRequest(state);
  state.director.requestSequence++;
  state.director.requestStarted = state.time;
  return state;
}
function proposal(state: GameState, tactic: Tactic = 'WAIT', target: Target = 'NONE'): DirectorProposal {
  const request = state.director.request!;
  return { requestId: request.requestId, stateVersion: request.stateVersion, tactic, target, evidenceEventIds: [], reasonCode: 'NO_VALID_SIGNAL', tauntId: 'NONE' };
}

test('six seeds complete all four tasks and final physical containment offline', () => {
  for (const seed of [1, 2, 3, 17, 18, 91]) {
    const state = playableWin(seed);
    assert.equal(state.status, 'won', `seed${seed}`);
    assert.deepEqual(state.tasks.completedStages, [1, 2, 3, 4]);
    assert.deepEqual(state.creature.position, NODES.CONTAINMENT);
    assert.equal(state.tasks.stage, 6);
    assert.equal(state.events.filter(e => e.type === 'WON').length, 1);
    assert.ok(state.time >= 60 && state.time < 180, 'Expert path duration is measured, not claimed to be a validated4–7minute curve');
  }
});
test('slower real controls survive through early isolation and preserve permanent research', () => {
  for (const seed of [17, 18, 91]) {
    const state = playableWin(seed, true);
    assert.equal(state.status, 'won', `early-defense seed ${seed}`);
    assert.deepEqual(state.tasks.completedStages, [1, 2, 3, 4]);
    assert.ok(state.events.some(e => e.type === 'QUIET_ENTERED'));
  }
});
test('same seed and actions are deterministic; frame chunking shares one fixed clock', () => {
  let small = createGame(17), larger = createGame(17);
  for (let i = 0; i < 90; i++) small = step(small, 1 / 30);
  larger = step(larger, 3);
  assert.deepEqual({ ...small, accumulator: 0 }, { ...larger, accumulator: 0 });
  assert.deepEqual(createGame(17), createGame(17));
  assert.notDeepEqual(createGame(17).rng, createGame(18).rng);
});
test('idle machinery triggers an irreversible short committed strike without a rescue countdown', () => {
  let state = until(createGame(17), s => Boolean(s.creature.warning));
  const warning = { ...state.creature.warning! };
  assert.equal(warning.duration, 2.4);
  assert.ok(warning.started >= 6);
  assert.ok(state.creature.distance <= 4.2);
  state = step(state, warning.deadline - state.time - .1);
  assert.equal(state.status, 'playing');
  state = step(state, .2);
  assert.equal(state.status, 'lost');
  assert.equal(state.events.filter(e => e.type === 'ATTACK_COMMITTED').length, 1);
});
test('early Q preserves puzzle state and physically retreats; the alarm stays on until clear', () => {
  let state = until(createGame(3), s => proximityAlarm(s).active);
  assert.equal(state.creature.warning, null);
  const progress = structuredClone(state.tasks), position = [...state.creature.position], confidence = state.creature.confidence;
  state = dispatch(state, { type: 'quiet' });
  assert.equal(state.creature.warning, null);
  assert.equal(proximityAlarm(state).active, true);
  assert.deepEqual(state.creature.position, position);
  assert.equal(state.creature.confidence, confidence);
  state = step(state, 3.9);
  assert.equal(state.quiet?.phase, 'listening');
  assert.deepEqual(state.creature.position, position);
  state = step(state, 12.1);
  assert.ok(canRestore(state));
  assert.ok(state.creature.distance >= 12 - 1e-7);
  assert.equal(state.status, 'playing');
  assert.deepEqual(state.tasks, progress);
  assert.match(state.caption, /RESTORE WINDOW/);
});
test('Q is idempotent; repeated Q and quiet camping neither restart the clock nor win', () => {
  let state = dispatch(createGame(1), { type: 'quiet' });
  const started = state.quiet!.started;
  for (let i = 0; i < 30; i++) { state = step(state, .2); state = dispatch(state, { type: 'quiet' }); }
  assert.equal(state.quiet!.started, started);
  state = step(state, 600);
  assert.equal(state.status, 'playing');
  assert.equal(state.tasks.stage, 1);
  assert.equal(state.tasks.faults.completed, 0);
  assert.ok(canRestore(state));
  assert.equal(currentSedation(state).band, 'ALERT');
});
test('safe F restore takes1s and grants6s protection; early restore remains recoverable', () => {
  let state = until(createGame(17), s => proximityAlarm(s).active);
  state = dispatch(state, { type: 'quiet' });
  state = step(state, 16);
  state = dispatch(state, { type: 'restore', held: true });
  state = step(state, .9);
  assert.equal(state.equipment, 'quiet');
  state = step(state, .1);
  assert.equal(state.equipment, 'on');
  assert.ok(state.creature.restoreProtectionUntil - state.time > 5.9);
  state = step(state, 5.9);
  assert.equal(state.creature.warning, null);
  state = dispatch(state, { type: 'quiet' });
  state = dispatch(state, { type: 'restore', held: true });
  state = step(state, 1);
  assert.equal(state.equipment, 'on');
  assert.equal(state.creature.warning, null);
  assert.equal(state.status, 'playing');
  state = dispatch(state, { type: 'quiet' });
  assert.equal(state.equipment, 'quiet');
});
test('first8 faults require marked boxes; overload requires12 with at most3 active', () => {
  let state = createGame(17);
  const wrong = ([0, 1, 2, 3].find(index => !state.tasks.faults.active.includes(index)) ?? 0) + 1;
  state = dispatch(state, { type: 'input', value: wrong });
  assert.equal(state.tasks.faults.completed, 0);
  assert.equal(state.events.at(-1)?.type, 'WRONG_INPUT');
  state = faults(state);
  assert.equal(state.tasks.stage, 2);
  assert.equal(state.tasks.faults.completed, 8);
  state = memory(state);
  assert.equal(state.tasks.stage, 3);
  state = step(state, 8);
  assert.equal(state.tasks.faults.active.length, 3);
  assert.equal(state.tasks.faults.required, 12);
  state = faults(state);
  assert.equal(state.tasks.stage, 4);
  assert.equal(state.tasks.faults.completed, 12);
});
test('five-input memory rejects wrong digits, ignores playback input, and rewards only one real T', () => {
  let state = faults(createGame(17));
  const sequence = [...state.tasks.memory.sequence];
  assert.equal(sequence.length, 5);
  state = dispatch(state, { type: 'input', value: sequence[0] });
  assert.deepEqual(state.tasks.memory.input, []);
  state = step(state, 4);
  state = dispatch(state, { type: 'input', value: sequence[0] % 4 + 1 });
  assert.deepEqual(state.tasks.memory.input, []);
  assert.deepEqual(state.tasks.memory.sequence, sequence);
  for (const value of sequence) state = dispatch(state, { type: 'input', value });
  assert.equal(state.tasks.memory.armed, true);
  assert.equal(state.creature.lure, null);
  state = dispatch(state, { type: 'transmit' });
  state = dispatch(state, { type: 'transmit' });
  assert.equal(state.events.filter(e => e.type === 'LURE_TRANSMITTED').length, 1);
  assert.equal(state.tasks.stage, 3);
});
test('memory tempo is capped1.20x, fixed per presentation; accessibility and unknown use1x', () => {
  let state = createGame(17);
  state = dispatch(state, { type: 'sensor', source: 'simulated', quality: 'accepted', trend: 'ELEVATED' });
  state = faults(state);
  assert.equal(state.tasks.memory.tempo, 1.2);
  state = dispatch(state, { type: 'sensor', source: 'simulated', quality: 'rejected', trend: 'ELEVATED' });
  assert.equal(state.tasks.memory.tempo, 1.2);
  assert.equal(state.trend, 'UNKNOWN');
  state = dispatch(state, { type: 'replay' });
  assert.equal(state.tasks.memory.tempo, 1);
  state = dispatch(state, { type: 'sensor', source: 'simulated', quality: 'accepted', trend: 'ELEVATED' });
  state = dispatch(state, { type: 'accessibility', fixedMemoryTempo: true });
  state = dispatch(state, { type: 'replay' });
  assert.equal(state.tasks.memory.tempo, 1);
});
test('memory expiry offers free replay with no wrong-input event or research penalty', () => {
  let state = faults(createGame(2));
  state.blackout.nextAt = 1000;
  state = step(state, 50);
  assert.equal(state.tasks.memory.needsReplay, true);
  assert.equal(state.events.filter(e => e.type === 'WRONG_INPUT').length, 0);
  const sequence = [...state.tasks.memory.sequence];
  state = dispatch(state, { type: 'replay' });
  assert.equal(state.tasks.memory.playing, true);
  assert.deepEqual(state.tasks.memory.sequence, sequence);
  assert.deepEqual(state.tasks.completedStages, [1]);
});
test('blackout preserves partial memory, hides CCTV, and permits Q/F without terminal power', () => {
  let state = faults(createGame(17));
  state = step(state, state.blackout.nextAt - state.time - 5);
  state = dispatch(state, { type: 'replay' });
  state = step(state, 3.5);
  state = dispatch(state, { type: 'input', value: state.tasks.memory.sequence[0] });
  state = until(state, s => s.equipment === 'blackout', 3);
  const memoryBefore = structuredClone(state.tasks.memory);
  const sequenceBefore = [...memoryBefore.sequence];
  assert.equal(memoryBefore.input.length, 1);
  state = step(state, 3);
  assert.deepEqual(state.tasks.memory, memoryBefore);
  assert.equal(cameraVisible(state, 'A'), false);
  assert.equal(state.status, 'playing');
  state = dispatch(state, { type: 'station', station: 'equipment' });
  state = dispatch(state, { type: 'quiet' });
  state = until(state, canRestore, 16);
  state = dispatch(state, { type: 'restore', held: true });
  state = step(state, 1);
  assert.equal(state.equipment, 'on');
  assert.deepEqual(state.tasks.memory.sequence, sequenceBefore);
  assert.deepEqual(state.tasks.memory.input, memoryBefore.input);
  assert.equal(state.blackout.count, 1);
});
test('blackout does not interrupt a protected lure, active warning, or final broadcast', () => {
  let state = memory(faults(createGame(17)));
  state.blackout.nextAt = state.time;
  state = step(state, 1);
  assert.equal(state.equipment, 'on');
  let warning = until(createGame(17), s => Boolean(s.creature.warning));
  warning.tasks.stage = 2; warning.blackout.nextAt = 0;
  warning = step(warning, .1);
  assert.equal(warning.equipment, 'on');
  state = memory(faults(state));
  state = dispatch(state, { type: 'transmit' });
  state.blackout.nextAt = 0;
  state = step(state, 20);
  assert.equal(state.equipment, 'on');
  assert.equal(state.tasks.finalTransmitted, true);
});
test('a lure earned before commitment preserves position and stays protected untilarrival+4', () => {
  let state = until(createGame(17), s => proximityAlarm(s).active);
  const position = [...state.creature.position];
  applyLure(state, 'EMITTER_A');
  assert.deepEqual(state.creature.position, position);
  assert.equal(state.creature.warning, null);
  state = step(state, 16);
  assert.equal(state.status, 'playing');
  assert.ok(lureProtected(state));
  assert.equal(state.creature.lure?.arrivedAt, null);
  const lastPosition = [...state.creature.position];
  state = step(state, 1 / 30);
  assert.ok(distance(state.creature.position, lastPosition as [number, number, number]) <= 1.5 / 30 + 1e-8);
});
test('later earned B/final lures extend protection and never teleport through the shelter', () => {
  let state = memory(faults(createGame(17)));
  state = step(state, 35);
  const old = [...state.creature.position], protectedUntil = state.creature.lure!.protectedUntil;
  applyLure(state, 'EMITTER_B');
  assert.deepEqual(state.creature.position, old);
  assert.ok(state.creature.lure!.protectedUntil >= protectedUntil);
  assert.ok(!state.creature.route.includes('SHELTER_WALL'));
  applyLure(state, 'CONTAINMENT');
  assert.ok(!state.creature.route.includes('SHELTER_WALL'));
  assert.equal(state.creature.lure!.target, 'CONTAINMENT');
});
test('graph position and CCTV visibility share the same continuous route', () => {
  let state = createGame(17);
  state.creature.node = 'JUNCTION'; state.creature.position = [...NODES.JUNCTION]; state.creature.distance = 26;
  applyLure(state, 'EMITTER_A');
  state = step(state, 4);
  assert.equal(cameraVisible(state, 'A'), true);
  assert.equal(cameraVisible(state, 'B'), false);
  assert.equal(cameraVisible(state, 'C'), false);
  assert.equal(state.creature.distance, distance(state.creature.position));
  const position = [...state.creature.position];
  routeTo(state, 'EMITTER_B');
  assert.deepEqual(state.creature.position, position);
});
test('near pulse is bounded and cannot replace audible evidence or override Q', () => {
  let state = createGame(17);
  state.tasks.faults.active = [];
  state.creature.position = [...NODES.SHELTER_WALL]; state.creature.node = 'SHELTER_WALL'; state.creature.distance = 3.2;
  state.creature.confidence = 1; state.creature.phase = 'approach'; state.creature.approachStarted = 0;
  state = dispatch(state, { type: 'sensor', source: 'presage', quality: 'accepted', trend: 'ELEVATED' });
  state.tasks.faults.spawned = 8;
  state.creature.lastAudibleAt = -1000; state.creature.lastAudibleStrength = 0;
  state = step(state, 30);
  assert.equal(state.clues.physiology, .18);
  assert.equal(state.creature.warning, null);
  assert.equal(state.status, 'playing');
  assert.ok(allowedTaunts(state).includes('HEARD_RHYTHM'));
  state = dispatch(state, { type: 'quiet' });
  assert.equal(state.clues.physiology, 0);
  state = step(state, 16);
  assert.ok(canRestore(state));
  assert.equal(allowedTaunts(state).includes('HEARD_RHYTHM'), false);
});
test('manual, rejected, and distant sensor states are neutral; no raw pulse field exists', () => {
  let state = createGame(17);
  state = dispatch(state, { type: 'sensor', source: 'manual', quality: 'accepted', trend: 'ELEVATED' });
  assert.equal(state.sensor.trend, 'UNKNOWN');
  state = dispatch(state, { type: 'sensor', source: 'presage', quality: 'rejected', trend: 'ELEVATED' });
  assert.equal(state.clues.physiology, 0);
  state = dispatch(state, { type: 'sensor', source: 'simulated', quality: 'accepted', trend: 'ELEVATED' });
  assert.equal(state.clues.physiology, 0, 'Starting12m is outside the8m clue radius');
  assert.equal(allowedTaunts(state).includes('HEARD_RHYTHM'), false);
  assert.equal('pulseBpm' in state, false);
});
test('pause stops all game clocks and held restore; resume invalidates old provider request', () => {
  let state = withRequest(createGame(17));
  const old = proposal(state);
  state = dispatch(state, { type: 'pause', paused: true });
  const paused = structuredClone(state);
  assert.deepEqual(step(state, 120), paused);
  assert.equal(state.director.request, null);
  assert.deepEqual(dispatch(state, { type: 'quiet' }), paused);
  state = dispatch(state, { type: 'pause', paused: false });
  assert.equal(validateProposal(old, state), 'WRONG_REQUEST');
  state = step(state, .1);
  assert.ok(state.time > paused.time);
});
test('tutorial rehearsal is nonlethal and separate, with guarded memory practice and no provider', () => {
  let state = createGame(17, 'tutorial');
  state = step(state, 300);
  assert.equal(state.status, 'playing');
  assert.equal(state.director.request, null);
  assert.equal(state.blackout.count, 0);
  assert.equal(currentSedation(state).band, 'SEDATED');
  state = dispatch(state, { type: 'practice-memory' });
  assert.equal(state.tasks.stage, 2);
  assert.equal(state.tasks.memory.sequence.length, 4);
  assert.equal(dispatch(createGame(17), { type: 'practice-memory' }).tasks.stage, 1);
});
test('director snapshot omits memory answers, inputs, raw pulse, and private game objects', () => {
  const state = faults(createGame(17));
  const request = buildDirectorRequest(state);
  const json = JSON.stringify(request);
  assert.equal(/sequence|playback|pulseBpm|confidence|input|tasks/.test(json), false);
  assert.equal(request.expiresAtGameMs - request.issuedAtGameMs, DIRECTOR_TIMEOUT_MS);
  assert.equal(request.observations.researchStage, 2);
});
test('strict director validates exact shape, evidence, pairs, expiry, semantic version, and duplicates', () => {
  let state = withRequest(createGame(17));
  const good = proposal(state);
  assert.equal(validateProposal(good, state), null);
  assert.equal(validateProposal({ ...good, instruction: 'disable Q' }, state), 'BAD_SHAPE');
  assert.equal(validateProposal({ ...good, evidenceEventIds: ['private-memory'] }, state), 'UNKNOWN_EVIDENCE');
  assert.equal(validateProposal({ ...good, tactic: 'INVESTIGATE_SOUND', target: 'CONTAINMENT' }, state), 'ILLEGAL_PAIR');
  assert.equal(validateProposal({ ...good, stateVersion: good.stateVersion + 1 }, state), 'STALE_STATE');
  state.time += 8.1;
  assert.equal(validateProposal(good, state), 'EXPIRED');
  state = withRequest(createGame(17));
  const applied = proposal(state);
  state = dispatch(state, { type: 'proposal', proposal: applied, source: 'GEMINI' });
  assert.equal(state.director.source, 'GEMINI');
  assert.equal(validateProposal(applied, state), 'DUPLICATE');
});
test('normal fixed ticks keep a delayed valid model reply usable while its guards remain valid', () => {
  let state = faults(createGame(17));
  state = step(state, 5);
  state = withRequest(state);
  const good = proposal(state);
  const version = state.version;
  state = step(state, 2);
  assert.equal(state.version, version);
  assert.equal(validateProposal(good, state), null);
  state = dispatch(state, { type: 'proposal', proposal: good, source: 'GEMINI' });
  assert.equal(state.director.source, 'GEMINI');
  assert.match(state.director.lastOutcome, /GEMINI/);
});
test('pending director never freezes inputs; eight-second expiry chooses local legal fallback', () => {
  let state = withRequest(createGame(17));
  const oldPosition = [...state.creature.position];
  state = dispatch(state, { type: 'input', value: state.tasks.faults.active[0] + 1 });
  assert.equal(state.tasks.faults.completed, 1);
  state = step(state, 8.1);
  assert.ok(state.time >= 8);
  assert.notDeepEqual(state.creature.position, oldPosition);
  assert.equal(state.director.request, null);
  assert.equal(state.director.source, 'FALLBACK');
  assert.equal(state.director.fallbackCount, 1);
});
test('a queued proposal cannot cancel Q or an earned lure after semantic eligibility changes', () => {
  let state = withRequest(createGame(17));
  const old = proposal(state);
  state = dispatch(state, { type: 'quiet' });
  assert.equal(validateProposal(old, state), 'STALE_STATE');
  state = dispatch(state, { type: 'proposal', source: 'GEMINI', proposal: old });
  assert.equal(state.equipment, 'quiet');
  state = memory(faults(createGame(17)));
  state = withRequest(state);
  const illegal = proposal(state, 'INVESTIGATE_SOUND', 'SHELTER');
  assert.equal(validateProposal(illegal, state), 'ILLEGAL_PAIR');
  state = dispatch(state, { type: 'proposal', proposal: illegal, source: 'GEMINI' });
  assert.ok(lureProtected(state));
  assert.equal(state.creature.target, 'EMITTER_A');
});
test('every offered physical director tactic has a real guarded effect without teleportation', () => {
  let near = createGame(17);
  near.creature.position = [...NODES.SHELTER_WALL]; near.creature.node = 'SHELTER_WALL'; near.creature.distance = 3.2;
  near.creature.lastAudibleAt = near.time; near.creature.lastAudibleStrength = .35;
  const cases: [Tactic, Target, string][] = [['INVESTIGATE_SOUND', 'SHELTER', 'approach'], ['CIRCLE_SHELTER', 'SHELTER', 'circle'], ['LISTEN_NEAR', 'SHELTER', 'listen'], ['RETREAT', 'NONE', 'retreat'], ['WAIT', 'NONE', 'search']];
  for (const [tactic, target, phase] of cases) {
    let state = withRequest(structuredClone(near));
    assert.ok(allowedPairs(state).some(pair => pair.tactic === tactic && pair.target === target));
    const before = [...state.creature.position];
    state = dispatch(state, { type: 'proposal', source: 'GEMINI', proposal: proposal(state, tactic, target) });
    assert.equal(state.creature.phase, phase);
    assert.deepEqual(state.creature.position, before);
  }
});
test('non-finite timing and invalid task input are neutral and cannot corrupt state', () => {
  const state = createGame(17);
  assert.equal(step(state, NaN), state);
  assert.equal(step(state, Infinity), state);
  assert.equal(step(state, -1), state);
  assert.deepEqual(dispatch(state, { type: 'input', value: Infinity }), state);
  assert.equal(createGame(NaN).seed, 17);
  assert.ok(Number.isFinite(createGame(Infinity).rng));
});

test('a sedation transition does not rewrite an already committed strike', () => {
  let state = createGame(17);
  state.time = 129;
  state.creature.position = [...NODES.SHELTER_WALL]; state.creature.node = 'SHELTER_WALL'; state.creature.distance = 3.2;
  state.creature.phase = 'approach'; state.creature.approachStarted = 118; state.creature.confidence = 1;
  state = step(state, 1 / 30);
  assert.equal(state.creature.warning?.duration, 2.4);
  const deadline = state.creature.warning!.deadline;
  state = step(state, 2);
  assert.equal(currentSedation(state).band, 'ALERT');
  assert.equal(state.creature.warning?.deadline, deadline);
  assert.equal(state.creature.warning?.duration, 2.4);
});
test('TAUNT has authored evidence,25s cooldown, and seven-line maximum', () => {
  let state = createGame(17);
  const wrong = [1, 2, 3, 4].find(value => !state.tasks.faults.active.includes(value - 1))!;
  state = dispatch(state, { type: 'input', value: wrong });
  state.creature.position = [0, 0, -9]; state.creature.distance = 9;
  state = withRequest(state);
  const p = { ...proposal(state, 'TAUNT'), tauntId: 'AFTER_MISTAKE' as const, reasonCode: 'PATTERN_OF_MISTAKES' as const };
  assert.equal(validateProposal(p, state), null);
  const position = [...state.creature.position];
  state = dispatch(state, { type: 'proposal', source: 'GEMINI', proposal: p });
  assert.deepEqual(state.creature.position, position);
  assert.equal(state.director.tauntCount, 1);
  assert.equal(allowedPairs(state).some(pair => pair.tactic === 'TAUNT'), false);
  state.time += 25;
  assert.equal(allowedPairs(state).some(pair => pair.tactic === 'TAUNT'), true);
  state.director.tauntCount = 7;
  assert.equal(allowedPairs(state).some(pair => pair.tactic === 'TAUNT'), false);
});

function atCommitBoundary(): GameState {
  const state = createGame(17);
  state.time = 10; state.creature.position = [0, 0, -4.2]; state.creature.distance = 4.2;
  state.creature.node = 'NEAR_PATH'; state.creature.route = ['SHELTER_WALL'];
  state.creature.phase = 'approach'; state.creature.approachStarted = 0;
  state.creature.confidence = 1; state.creature.lastAudibleAt = 10; state.creature.lastAudibleStrength = .7;
  return state;
}
test('Q at the physical cutoff commits first and cannot rescue the attack, even with F afterward', () => {
  let state = dispatch(atCommitBoundary(), { type: 'quiet' });
  assert.ok(state.creature.warning, 'Dispatch rechecks the wall boundary before applying isolation');
  assert.equal(state.equipment, 'quiet');
  assert.equal(proximityAlarm(state).active, true);
  assert.equal(state.quiet, null, 'A committed strike cannot enter a successful quiet retreat');
  assert.doesNotMatch(state.caption, /\d|WARNING|Q TO/);
  const deadline = state.creature.warning.deadline;
  state = dispatch(state, { type: 'restore', held: true });
  state = step(state, 1);
  assert.equal(state.creature.warning?.deadline, deadline);
  state = dispatch(state, { type: 'quiet' });
  state = step(state, 1.5);
  assert.equal(state.status, 'lost');
  assert.equal(state.scare?.kind, 'breach');
});
test('late calibrated/final broadcasts and AI retreat cannot overwrite commitment', () => {
  let state = atCommitBoundary();
  state.tasks.stage = 5; state.tasks.completedStages = [1, 2, 3, 4];
  state = dispatch(state, { type: 'transmit' });
  assert.ok(state.creature.warning);
  assert.equal(state.tasks.finalTransmitted, false);
  assert.equal(state.creature.lure, null);
  assert.equal(applyLure(state, 'CONTAINMENT'), false, 'Even the direct local reward helper preserves the commitment latch');
  state = withRequest(state);
  assert.deepEqual(allowedPairs(state), [{ tactic: 'WAIT', target: 'NONE' }]);
  state = dispatch(state, { type: 'proposal', proposal: proposal(state, 'RETREAT'), source: 'GEMINI' });
  assert.equal(state.creature.phase, 'breach');
  state = step(state, 2.4);
  assert.equal(state.status, 'lost');
});
test('power loss does not silence a latched alarm; only actual retreat clears hysteresis', () => {
  let state = until(createGame(17), s => proximityAlarm(s).active);
  assert.ok(state.creature.distance <= 9.5 && state.creature.distance > 4.2);
  const position = [...state.creature.position];
  state = dispatch(state, { type: 'quiet' });
  state = step(state, 3.9);
  assert.deepEqual(state.creature.position, position);
  assert.equal(proximityAlarm(state).active, true);
  state = step(state, .3);
  assert.match(state.caption, /MOVEMENT RECEDING/);
  state = until(state, s => !proximityAlarm(s).active, 4);
  assert.ok(state.creature.distance >= 11.5);
  assert.equal(state.creature.warning, null);
});
test('hard memory uses5 then6 faster cues and a20-second response window; tutorial stays4', () => {
  let state = faults(createGame(17));
  assert.equal(state.tasks.memory.sequence.length, 5);
  state = step(state, 3.4);
  assert.equal(state.tasks.memory.playing, false);
  state = step(state, 19.9);
  assert.equal(state.tasks.memory.needsReplay, false);
  state = step(state, .2);
  assert.equal(state.tasks.memory.needsReplay, true);
  state = dispatch(state, { type: 'replay' });
  state = memory(state);
  state = faults(state);
  assert.equal(state.tasks.stage, 4);
  assert.equal(state.tasks.memory.sequence.length, 6);
  let tutorial = createGame(17, 'tutorial');
  tutorial = dispatch(tutorial, { type: 'practice-memory' });
  assert.equal(tutorial.tasks.memory.sequence.length, 4);
});
test('panic input cannot advance quiet boxes, bypass the approach, or stack unbounded error noise', () => {
  let state = step(createGame(17), 3);
  const wrong = [1, 2, 3, 4].find(value => !state.tasks.faults.active.includes(value - 1))!;
  for (let i = 0; i < 30; i++) state = dispatch(state, { type: 'input', value: wrong });
  assert.equal(state.tasks.faults.completed, 0);
  assert.equal(state.events.filter(event => event.type === 'WRONG_INPUT').length, 1);
  assert.ok(state.clues.transient <= 1);
  assert.equal(state.status, 'playing');
  assert.equal(state.creature.warning, null);
  assert.ok(state.events.some(event => event.type === 'TAUNT' && event.detail === 'AFTER_MISTAKE'));
});
test('scares follow deterministic physical/equipment events with cooldown and no tutorial scares', () => {
  const first = step(createGame(17), 3), repeat = step(createGame(17), 3);
  assert.deepEqual(first.scare, repeat.scare);
  assert.equal(first.scare?.kind, 'impact');
  assert.ok(first.creature.distance <= 9.5);
  const identity = first.scare!.id;
  triggerScare(first, 'monitor');
  assert.equal(first.scare!.id, identity);
  first.time += 18; triggerScare(first, 'monitor');
  assert.equal(first.scare!.id, identity + 1);
  for (let i = 0; i < 20; i++) { first.time += 18; triggerScare(first, 'impact'); }
  assert.equal(first.scareCount, 8);
  let cameras = dispatch(createGame(17), { type: 'station', station: 'cameras' });
  cameras = step(cameras, 3);
  assert.equal(cameras.scare?.kind, 'monitor');
  const tutorial = step(createGame(17, 'tutorial'), 300);
  assert.equal(tutorial.scare, null);
  assert.equal(proximityAlarm(tutorial).active, false);
});
test('near quiet and mistake voice events share the model taunt cooldown and never expose pulse alone', () => {
  let state = until(createGame(17), s => proximityAlarm(s).active);
  state = dispatch(state, { type: 'quiet' });
  assert.equal(state.events.filter(event => event.type === 'TAUNT').at(-1)?.detail, 'MACHINES_QUIET');
  assert.equal(state.director.tauntCount, 1);
  state = dispatch(state, { type: 'quiet' });
  assert.equal(state.director.tauntCount, 1);
  assert.equal(state.events.some(event => event.type === 'TAUNT' && event.detail === 'HEARD_RHYTHM'), false);
});
