import test from 'node:test';
import assert from 'node:assert/strict';
import { config, createGame, dispatch, step } from '../src/game/reducer';
import { movementProbabilities } from '../src/game/creature';
import { buildDirectorRequest } from '../src/game/directorValidation';
import { coopManual, decoysLeft, doorKeyFor } from '../src/game/coop';
import { coopBook } from '../src/game/book';
import { startStage } from '../src/game/tasks';
import type { GameState } from '../src/game/state';

const outward = (state: GameState) => movementProbabilities(state).filter(row => row.step > 0).reduce((sum, row) => sum + row.probability, 0);
function atDoor(mode: GameState['mode'] = 'coop', seed = 17): GameState {
  const state = createGame(seed, mode); state.time = 200; state.creature.nextMoveAt = 1e9; state.blackout.nextAt = 1e9;
  state.tasks.completedStages = [1, 2, 3, 4]; startStage(state, 5);
  return state;
}

test('door key is four digits 1–4 from the seed alone and never shifts the run RNG', () => {
  for (const seed of [0, 17, 18, 999_999]) {
    const key = doorKeyFor(seed);
    assert.equal(key.length, config.coop.doorKeyLength);
    assert.ok(key.every(d => Number.isInteger(d) && d >= 1 && d <= 4));
    assert.deepEqual(doorKeyFor(seed), key, 'deterministic');
  }
  assert.notDeepEqual(doorKeyFor(17), doorKeyFor(18));
  assert.equal(createGame(17, 'coop').rng, createGame(17, 'standard').rng);
});

test('co-op basement door needs the friend\'s key; wrong digits are loud and start over', () => {
  let state = atDoor();
  const key = state.coop.doorKey;
  assert.deepEqual(key, coopBook(state.seed).door, 'the friend\'s book has the key');
  state = dispatch(state, { type: 'transmit' });
  assert.equal(state.tasks.finalTransmitted, false, 'T does nothing before the key');
  const wrong = key[0] === 4 ? 1 : key[0]! + 1;
  state = dispatch(state, { type: 'input', value: wrong });
  assert.equal(state.events.at(-1)?.type, 'WRONG_INPUT'); assert.deepEqual(state.coop.doorInput, []);
  for (const digit of key) state = dispatch(state, { type: 'input', value: digit });
  assert.equal(state.coop.doorUnlocked, true); assert.ok(state.events.some(e => e.type === 'DOOR_UNLOCKED'));
  state = dispatch(state, { type: 'transmit' });
  assert.equal(state.tasks.finalTransmitted, true);
});

test('solo runs, and a run whose friend stopped sharing, never need the door key', () => {
  let solo = atDoor('standard');
  assert.equal(coopManual(solo), null);
  solo = dispatch(solo, { type: 'transmit' }); assert.equal(solo.tasks.finalTransmitted, true);
  let left: GameState = { ...atDoor('coop'), mode: 'standard' };
  left = dispatch(left, { type: 'transmit' }); assert.equal(left.tasks.finalTransmitted, true);
});

test('friend warning is information only, rate limited, and co-op only', () => {
  let state = createGame(17, 'coop'); state.time = 60;
  const before = structuredClone(state);
  state = dispatch(state, { type: 'friend', signal: 'warn' });
  assert.equal(state.events.at(-1)?.type, 'FRIEND_WARNING'); assert.equal(state.coop.warnings, 1);
  assert.equal(state.creature.linePosition, before.creature.linePosition); assert.equal(outward(state), outward(dispatch(before, { type: 'station', station: 'terminal' })), 'no movement effect');
  assert.equal(dispatch(state, { type: 'friend', signal: 'warn' }).coop.warnings, 1, 'cooldown');
  assert.equal(dispatch(step(state, config.coop.warnCooldownSeconds + .1), { type: 'friend', signal: 'warn' }).coop.warnings, 2);
  assert.equal(dispatch(createGame(17), { type: 'friend', signal: 'warn' }).events.some(e => e.type === 'FRIEND_WARNING'), false);
  const paused = dispatch(createGame(17, 'coop'), { type: 'pause', paused: true });
  assert.equal(dispatch(paused, { type: 'friend', signal: 'warn' }).coop.warnings, 0, 'game time frozen');
});

test('remote decoy pulls it away briefly, has limited charges and a cooldown, and is refused once an attack commits', () => {
  let state = createGame(17, 'coop'); state.time = 60;
  const base = outward(state);
  state = dispatch(state, { type: 'friend', signal: 'decoy' });
  assert.equal(state.events.at(-1)?.type, 'FRIEND_DECOY'); assert.equal(decoysLeft(state), config.coop.decoy.charges - 1);
  assert.ok(outward(state) > base, 'more likely to drift away from the wall');
  assert.equal(dispatch(state, { type: 'friend', signal: 'decoy' }).coop.decoysUsed, 1, 'cooldown');
  for (let i = 1; i < config.coop.decoy.charges + 2; i++) { state.time += config.coop.decoy.cooldownSeconds + 1; state = dispatch(state, { type: 'friend', signal: 'decoy' }); }
  assert.equal(state.coop.decoysUsed, config.coop.decoy.charges, 'never more than the charges');
  const committed = createGame(17, 'coop'); committed.time = 60; committed.creature.warning = { started: 59, deadline: 62, duration: 3 };
  assert.equal(dispatch(committed, { type: 'friend', signal: 'decoy' }).coop.decoysUsed, 0);
  assert.equal(dispatch(createGame(17), { type: 'friend', signal: 'decoy' }).coop.decoysUsed, 0, 'solo ignores it');
});

test('the door key and friend counters never reach the director request', () => {
  const state = dispatch(atDoor(), { type: 'friend', signal: 'warn' });
  const text = JSON.stringify(buildDirectorRequest(state));
  for (const key of ['doorKey', 'doorInput', 'warnedAt', 'decoysUsed', 'doorUnlocked']) assert.equal(text.includes(key), false, key);
});
