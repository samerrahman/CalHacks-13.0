import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, step } from '../src/game/reducer';
import { canProbe, startProbe } from '../src/game/creature';
import { allowedTactics, buildDirectorRequest, DIRECTOR_RESPONSE_BUDGET_SECONDS, validateProposal } from '../src/game/directorValidation';
import { issueCall, makeOrder } from '../src/game/verification';
import type { DirectorProposal, GameState } from '../src/game/state';
import { MARA_DIALOGUE } from '../src/game/dialogue';

function tune(state: GameState): GameState {
  for (let i = 0; i < 3; i++) state = dispatch(state, { type: 'dial', index: i, value: state.tasks.targets[i] });
  return state;
}

function reachCartridge(seed = 17): GameState { return step(tune(createGame(seed, 'shift')), 20); }

function win(seed: number, mode: 'shift' | 'demo'): GameState {
  let state = step(tune(createGame(seed, mode)), 20);
  assert.equal(state.tasks.stage, 2);
  state = dispatch(state, { type: 'station', station: 'left' });
  state = dispatch(state, { type: 'sweep', side: 'left' });
  state = dispatch(state, { type: 'door', side: 'left', open: true });
  state = dispatch(state, { type: 'door', side: 'right', open: false });
  state = dispatch(state, { type: 'interact', held: true });
  state = step(state, 1.1);
  assert.equal(state.call?.origin, 'mimic');
  state = dispatch(state, { type: 'inspect' });
  state = dispatch(state, { type: 'authenticate' });
  state = dispatch(state, { type: 'reject' });
  assert.equal(state.fakeRejected, 1);
  state = step(state, 1.9);
  assert.equal(state.tasks.hasCartridge, true);
  state = dispatch(state, { type: 'station', station: 'relay' });
  state = dispatch(state, { type: 'interact', held: true });
  state = step(state, 1);
  assert.equal(state.tasks.stage, 3);
  state = dispatch(state, { type: 'station', station: 'right' });
  for (let i = 0; i < 2; i++) state = dispatch(state, { type: 'bar', index: i, value: state.tasks.barTargets[i] });
  state = step(state, Math.max(0, state.sweepReadyAt - state.time));
  state = dispatch(state, { type: 'sweep', side: 'right' });
  state = dispatch(state, { type: 'door', side: 'right', open: true });
  state = dispatch(state, { type: 'door', side: 'left', open: false });
  state = dispatch(state, { type: 'interact', held: true });
  state = step(state, 12);
  return state;
}

test('both closed stops carrier progress and drains exactly 0.75 per second', () => {
  let state = tune(createGame(17, 'shift'));
  state = dispatch(state, { type: 'door', side: 'right', open: false });
  state = step(state, 20);
  assert.equal(state.tasks.sync, 0);
  assert.ok(Math.abs(state.energy - 85) < 1e-7);
  state = step(state, 130);
  assert.equal(state.status, 'lost');
  assert.match(state.lossReason!, /Station outage/);
  assert.equal(state.tasks.stage, 1);
  assert.ok(Math.abs(state.time - (100 / 0.75 + 8)) < 0.051);
});

test('one closed drains 0.20/s, both open recharge 0.35/s, capped at 100', () => {
  let state = step(createGame(1, 'shift'), 10);
  assert.ok(Math.abs(state.energy - 98) < 1e-7);
  state = dispatch(state, { type: 'door', side: 'left', open: true });
  state = step(state, 3);
  assert.ok(Math.abs(state.energy - 99.05) < 1e-7);
  state = step(state, 3);
  assert.equal(state.energy, 100);
});

test('explicit defensive sequence rejects the teaching fake and wins across seeds and presets', () => {
  for (const mode of ['shift', 'demo'] as const) for (const seed of [0, 1, 17, 42, 999, -13]) {
    const state = win(seed, mode);
    assert.equal(state.status, 'won', `seed ${seed}, ${mode}: ${state.lossReason}`);
    assert.equal(state.tasks.stage, 4);
    assert.equal(state.tasks.sync, 20);
    assert.equal(state.tasks.inserted, true);
    assert.equal(state.tasks.upload, 12);
    assert.equal(state.fakeRejected, 1);
    assert.ok(state.energy > 60);
    assert.ok(state.time < state.deadline);
  }
});

test('every fake has an accessible authored tell and can never match the current private answer', () => {
  for (const kind of ['expired', 'wrong-hatch', 'challenge'] as const) {
    let state = reachCartridge();
    for (let i = 0; i < 30; i++) {
      const previous = state.privateChallenge.answer;
      issueCall(state, kind);
      assert.notEqual(state.privateChallenge.answer, previous);
      assert.notEqual(state.call?.fakeAnswer, state.privateChallenge.answer);
      state = dispatch(state, { type: 'inspect' });
      state = dispatch(state, { type: 'authenticate' });
      assert.equal(state.call?.verification, 'MISMATCH');
      assert.ok(state.call!.evidence.length >= 1);
      state = dispatch(state, { type: 'reject' });
      assert.equal(state.call?.rejected, true);
      assert.equal(state.status, 'playing', 'Dialogue interaction cannot kill the player');
    }
  }
});

test('genuine radio orders match current task truth and authenticate reliably', () => {
  let state = createGame(99, 'shift');
  assert.ok(state.call!.text.startsWith(MARA_DIALOGUE.intro));
  assert.ok(state.call!.text.includes(state.order.id));
  assert.ok(state.call!.text.length <= 600);
  for (const text of Object.values(MARA_DIALOGUE)) assert.doesNotMatch(text, /NR-417|NR-416|HARBOR|ORCHARD/);
  for (const stage of [1, 2, 3] as const) {
    state.tasks.stage = stage;
    state.order = makeOrder(state);
    // Real task transitions are exercised by the complete wins above. Here test truth generation directly.
    issueCall(state, 'genuine');
    assert.equal(state.call?.orderId, state.order.id);
    assert.equal(state.call?.action, state.order.action);
    state = dispatch(state, { type: 'inspect' });
    state = dispatch(state, { type: 'authenticate' });
    assert.equal(state.call?.verification, 'MATCH');
    assert.deepEqual(state.call?.evidence, []);
    state = dispatch(state, { type: 'reject' });
    assert.equal(state.call?.rejected, false);
  }
});

test('sanitized director/events never contain private challenge or authentication response', () => {
  let state = reachCartridge(83);
  for (let i = 0; i < 8; i++) {
    issueCall(state, i % 2 ? 'genuine' : 'challenge');
    state = dispatch(state, { type: 'authenticate' });
    const serialized = JSON.stringify({ request: buildDirectorRequest(state), events: state.events });
    for (const secret of [state.privateChallenge.answer, state.privateChallenge.prompt, state.privateChallenge.previousAnswer]) {
      if (secret) assert.equal(serialized.includes(secret), false);
    }
    assert.equal(serialized.includes('privateChallenge'), false);
    assert.equal(serialized.includes('fakeAnswer'), false);
  }
});

test('approach lasts 8 seconds and threshold warning lasts 6 seconds before an open-side breach', () => {
  let state = createGame(17, 'shift');
  state.director.nextAt = 100;
  state = dispatch(state, { type: 'door', side: 'left', open: true });
  assert.equal(startProbe(state, 'left'), true);
  state = step(state, 7.9);
  assert.equal(state.creature.phase, 'approach');
  state = step(state, 0.1);
  assert.equal(state.creature.phase, 'threshold');
  state = step(state, 5.9);
  assert.equal(state.status, 'playing');
  state = step(state, 0.1);
  assert.equal(state.status, 'lost');
});

test('a sweep prevents AI overrides, guarantees 12 seconds clear and enforces global cooldown', () => {
  let state = createGame(17, 'shift');
  state.director.nextAt = 100;
  assert.equal(startProbe(state, 'left'), true);
  state = step(state, 10);
  state = dispatch(state, { type: 'sweep', side: 'left' });
  const safeUntil = state.safeUntil.left;
  const energy = state.energy;
  state = dispatch(state, { type: 'door', side: 'left', open: true });
  state = dispatch(state, { type: 'sweep', side: 'right' });
  assert.equal(state.energy, energy);
  assert.equal(state.safeUntil.right, 0);
  assert.equal(startProbe(state, 'left'), false);
  state = step(state, 11.9);
  assert.equal(state.status, 'playing');
  assert.equal(state.safeUntil.left, safeUntil);
  assert.equal(canProbe(state, 'left'), false);
  assert.equal(allowedTactics(state).includes('PROBE_LEFT'), false);
});

test('only one physical encounter can exist and switching sides respects recovery/travel', () => {
  let state = createGame(17, 'shift');
  state.director.nextAt = 100;
  assert.equal(startProbe(state, 'left'), true);
  assert.equal(startProbe(state, 'right'), false);
  state = dispatch(state, { type: 'sweep', side: 'left' });
  state = step(state, 8);
  assert.equal(canProbe(state, 'right'), false);
  state = step(state, 4);
  assert.equal(canProbe(state, 'right'), true);
});

test('the physical encounter budget never permits more than three approaches in a minute', () => {
  let state = createGame(17, 'shift');
  state.director.nextAt = 100;
  for (let i = 0; i < 3; i++) {
    assert.equal(startProbe(state, 'left'), true);
    state = dispatch(state, { type: 'sweep', side: 'left' });
    state = step(state, 12);
  }
  assert.equal(canProbe(state, 'left'), false);
  assert.equal(canProbe(state, 'right'), false);
  state = step(state, 24);
  assert.equal(canProbe(state, 'left'), true);
});

test('power zero allows eight-second rescue and prevents a new lethal phase', () => {
  let state = createGame(17, 'shift');
  state.director.nextAt = 100;
  state.energy = 0.1;
  state = dispatch(state, { type: 'door', side: 'right', open: false });
  assert.equal(startProbe(state, 'left'), true);
  state = step(state, 0.2);
  assert.ok(state.blackoutRemaining! > 7.9);
  assert.equal(state.creature.phase, 'retreat');
  assert.equal(canProbe(state, 'right'), false);
  state = step(state, 7.8);
  assert.equal(state.status, 'playing');
  state = dispatch(state, { type: 'door', side: 'left', open: true });
  state = dispatch(state, { type: 'door', side: 'right', open: true });
  state = step(state, 1);
  assert.equal(state.status, 'playing');
  assert.equal(state.blackoutRemaining, null);
  assert.ok(state.energy > 0);
});

test('pause freezes energy, task, warnings, safe windows and provider timeout; resume cancels hold', () => {
  let state = reachCartridge();
  state = dispatch(state, { type: 'sweep', side: 'left' });
  state = dispatch(state, { type: 'pause', paused: true });
  const frozen = JSON.stringify(state);
  state = step(state, 300);
  assert.equal(JSON.stringify(state), frozen);
  state = dispatch(state, { type: 'door', side: 'left', open: true });
  assert.equal(JSON.stringify(state), frozen);
  state = dispatch(state, { type: 'pause', paused: false });
  assert.equal(state.holding, false);
  assert.equal(state.time, 20);
});

test('upload checkpoints survive interrupted holds; closed right and expired sweep cannot progress', () => {
  let state = createGame(17, 'shift');
  state.tasks.stage = 3; state.tasks.bars = [...state.tasks.barTargets]; state.station = 'right'; state.director.nextAt = 100;
  state = dispatch(state, { type: 'sweep', side: 'right' });
  state = dispatch(state, { type: 'interact', held: true });
  state = step(state, 6);
  assert.equal(state.tasks.uploadCheckpoint, 4);
  state = dispatch(state, { type: 'interact', held: false });
  assert.equal(state.tasks.upload, 4);
  state = dispatch(state, { type: 'door', side: 'right', open: false });
  state = dispatch(state, { type: 'interact', held: true });
  state = step(state, 7);
  assert.equal(state.tasks.upload, 4);
  state = dispatch(state, { type: 'door', side: 'right', open: true });
  state = step(state, 2);
  assert.equal(state.tasks.upload, 4);
});

test('cartridge collection requires the left hatch open and an active sweep window', () => {
  let state = reachCartridge();
  state = dispatch(state, { type: 'station', station: 'left' });
  state = dispatch(state, { type: 'interact', held: true });
  state = step(state, 3);
  assert.equal(state.tasks.cartridgeHold, 0);
  state = dispatch(state, { type: 'door', side: 'left', open: true });
  state = step(state, 1);
  assert.equal(state.tasks.cartridgeHold, 0);
  state = dispatch(state, { type: 'sweep', side: 'left' });
  state = step(state, 3);
  assert.equal(state.tasks.hasCartridge, true);
});

function pending(): { state: GameState; proposal: DirectorProposal } {
  const state = step(createGame(17, 'shift'), 12);
  const request = state.director.request!;
  assert.ok(request);
  return { state, proposal: { requestId: request.requestId, stateVersion: request.stateVersion, tactic: 'WAIT', evidenceEventIds: [request.evidenceEventIds[0]], reasonCode: 'NO_VALID_SIGNAL' } };
}

test('director rejects invalid shapes, enums, IDs, old state, provenance, expiry and duplicate responses', () => {
  const { state, proposal } = pending();
  assert.equal(validateProposal(proposal, state), null);
  assert.equal(validateProposal('bad json', state), 'BAD_SHAPE');
  assert.equal(validateProposal({ ...proposal, tactic: 'BREACH' }, state), 'BAD_SHAPE');
  assert.equal(validateProposal({ ...proposal, requestId: 'old' }, state), 'WRONG_REQUEST');
  assert.equal(validateProposal({ ...proposal, stateVersion: 900 }, state), 'STALE_STATE');
  assert.equal(validateProposal({ ...proposal, evidenceEventIds: ['private-card'] }, state), 'UNKNOWN_EVIDENCE');
  assert.equal(validateProposal(proposal, { ...state, time: state.time + DIRECTOR_RESPONSE_BUDGET_SECONDS + 0.1 }), 'EXPIRED');
  assert.equal(validateProposal({ ...proposal, extra: 'arbitrary instructions' }, state), 'BAD_SHAPE');
  const applied = dispatch(state, { type: 'proposal', proposal, source: 'GEMINI' });
  assert.equal(applied.director.source, 'GEMINI');
  assert.equal(validateProposal(proposal, applied), 'DUPLICATE');
  const duplicate = dispatch(applied, { type: 'proposal', proposal, source: 'GEMINI' });
  assert.equal(duplicate.events.filter(e => e.type === 'DIRECTOR_APPLIED').length, 1);
});

test('director timeout does not freeze controls and uses a deterministic legal fallback', () => {
  let { state } = pending();
  state = dispatch(state, { type: 'door', side: 'right', open: false });
  assert.equal(state.doors.right, false);
  state = step(state, DIRECTOR_RESPONSE_BUDGET_SECONDS - 0.1);
  assert.ok(state.director.request, 'A request remains eligible throughout the configured provider budget');
  state = dispatch(state, { type: 'station', station: 'left' });
  assert.equal(state.station, 'left', 'Keyboard station input remains live during the provider wait');
  state = step(state, 0.2);
  assert.equal(state.director.request, null);
  assert.equal(state.director.source, 'FALLBACK');
  assert.equal(state.director.lastTactic, 'PROBE_LEFT');
  assert.equal(state.creature.phase, 'approach');
  assert.equal(state.status, 'playing');
});

test('a model proposal received after a defensive sweep cannot override the guaranteed clear window', () => {
  let { state, proposal } = pending();
  proposal = { ...proposal, tactic: 'PROBE_LEFT' };
  assert.equal(validateProposal(proposal, state), null);
  state = dispatch(state, { type: 'sweep', side: 'left' });
  const guaranteedUntil = state.safeUntil.left;
  state = dispatch(state, { type: 'proposal', proposal, source: 'GEMINI' });
  assert.equal(state.director.source, 'FALLBACK');
  assert.equal(state.creature.phase, 'dormant');
  assert.equal(state.safeUntil.left, guaranteedUntil);
  state = dispatch(state, { type: 'door', side: 'left', open: true });
  state = step(state, 11.9);
  assert.equal(state.status, 'playing');
});

test('elevated trend grants recovery and cannot directly cause loss or bypass defenses', () => {
  let state = createGame(17, 'shift');
  state.director.nextAt = 100;
  startProbe(state, 'right');
  state = step(state, 10);
  state = dispatch(state, { type: 'trend', trend: 'ELEVATED' });
  assert.equal(state.status, 'playing');
  assert.equal(state.creature.recoveryUntil, 30);
  state = step(state, 6);
  assert.equal(state.status, 'playing');
  assert.ok(['retreat', 'recover'].includes(state.creature.phase));
  state = dispatch(state, { type: 'trend', trend: 'UNKNOWN' });
  assert.equal(state.status, 'playing');
});

test('fresh games reset all temporal/verification state and equal seeds reproduce actions', () => {
  const finished = win(17, 'demo');
  const restarted = createGame(finished.seed, finished.mode);
  assert.equal(restarted.time, 0);
  assert.equal(restarted.fakeRejected, 0);
  assert.equal(restarted.director.request, null);
  assert.equal(restarted.creature.phase, 'dormant');
  assert.deepEqual(step(tune(restarted), 10), step(tune(createGame(17, 'demo')), 10));
});
