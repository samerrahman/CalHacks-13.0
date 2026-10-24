import test from 'node:test';
import assert from 'node:assert/strict';
import {
  config, sedationAt, acceptedPulse, baselineFrom, pulseTrend, physiologyClue, machineryNoise, confidenceAfter,
  distanceToShelter, createRoute, advanceRoute, lureReward, applyEarnedLure, markLureArrival, lureProtected, containmentWon,
  enterQuiet, quietPhase, restoreEquipment, mayStartWarning, beginWarning, mayBreach,
  canBlackout, blackoutSnapshot, presentation, resolveFault, createMemory, enterMemory, transmitMemory,
  validateProposal, publicEvent, eventClock
} from './rules.mjs';

const sample = (at, bpm = 70, patch = {}) => ({ source: 'presage', quality: 'accepted', qualityReasons: [], receivedMonotonicMs: at, measuredMonotonicMs: at, pulseBpm: bpm, nativeConfidence: 90, validationCode: 0, ...patch });
const samples = (start = 0, bpm = 80) => Array.from({ length: 7 }, (_, i) => sample(start + i * 2000, bpm));
const threat = (now = 12000) => ({ position: [0, 0, -3.2], confidence: 0.9, quiet: false, blackout: false, quietSinceMs: null, approachStartedMs: 0, warning: null, warningStarts: [], accessibleWarningReady: true, lastAudibleEvidenceAtMs: now, lastAudibleStrength: 0.7, restoreProtectedUntilMs: 0, recoveryUntilMs: 0, lure: null, completedStages: 0 });

test('the reference config describes a windowless shelter without door controls and the exact four-stage protocol', () => {
  assert.equal(config.room.windows, 0);
  assert.equal(config.room.playerDoorControls, false);
  assert.deepEqual([config.tasks.stage1.required, config.tasks.stage2.inputs, config.tasks.stage3.required, config.tasks.stage4.inputs], [5, 4, 7, 4]);
  assert.equal(config.tasks.stage5.target, 'CONTAINMENT');
});

test('five and seven faults complete only from correct active boxes; quiet inputs and late duplicate clicks do not progress', () => {
  for (const required of [5, 7]) {
    let task = { required, cleared: 0, active: [1], complete: false };
    assert.equal(resolveFault(task, 2).noise, 0.8);
    assert.equal(resolveFault(task, 2).task.cleared, 0);
    assert.equal(resolveFault(task, 1, false).task.cleared, 0);
    for (let i = 0; i < required; i++) {
      task = { ...task, active: required === 7 && i % 2 ? [1, 3] : [1] };
      task = resolveFault(task, 1).task;
    }
    assert.equal(task.cleared, required); assert.equal(task.complete, true); assert.deepEqual(task.active, []);
    assert.equal(resolveFault(task, 1).result, 'IGNORED');
  }
});

test('quiet silences all active machinery including blackout residual noise; ordinary silence does not erase remembered evidence', () => {
  assert.equal(machineryNoise(2), 0.7);
  assert.equal(machineryNoise(2, { blackout: true }), 0.3);
  assert.equal(machineryNoise(2, { blackout: true, quiet: true }), 0);
  assert.equal(confidenceAfter(0.9, {}, 4, { quiet: true, listening: true }), 0.9);
  assert.ok(Math.abs(confidenceAfter(0.9, {}, 6, { quiet: true }) - 0.3) < 1e-9);
  assert.ok(confidenceAfter(0.9, {}, 1) > 0);
});

test('memory always has four inputs and a locked tempo no greater than 20 percent faster', () => {
  for (const trend of ['UNKNOWN', 'STEADY', 'RECOVERED', 'ELEVATED']) {
    let memory = createMemory([1, 3, 2, 4], trend);
    const tempo = memory.tempo;
    for (const digit of [1, 3, 2, 4]) memory = enterMemory(memory, digit).memory;
    assert.equal(memory.armed, true); assert.equal(memory.sequence.length, 4);
    assert.equal(memory.tempo, tempo); assert.ok(tempo >= 1 && tempo <= 1.2);
  }
  assert.throws(() => createMemory([1, 2, 3, 4, 1]), /Exactly four/);
});

test('memory mistakes restart only the attempt and successful transmission is consumed once', () => {
  let memory = createMemory([1, 3, 2, 4], 'ELEVATED');
  memory = enterMemory(memory, 1).memory;
  const wrong = enterMemory(memory, 4);
  assert.equal(wrong.noise, 0.8); assert.deepEqual(wrong.memory.inputs, []);
  assert.deepEqual(wrong.memory.sequence, memory.sequence); assert.equal(wrong.memory.tempo, 1.2);
  memory = wrong.memory;
  for (const digit of memory.sequence) memory = enterMemory(memory, digit).memory;
  const earned = transmitMemory(memory, 'EMITTER_A', 10000);
  assert.ok(earned.researchCompleted);
  assert.equal(transmitMemory(earned.memory, 'EMITTER_A', 10001), null);
  assert.equal(transmitMemory(memory, 'EMITTER_A', 10000, false), null);
});

test('blackout and quiet preserve the exact partial sequence, input, cursor and tempo', () => {
  let memory = createMemory([2, 1, 4, 3], 'ELEVATED');
  memory = { ...enterMemory(memory, 2).memory, playbackCursor: 2 };
  const state = { ...threat(), memory, faultCount: 3, completedStages: 1 };
  const dark = blackoutSnapshot(state);
  const pausedInput = enterMemory(dark.memory, 1, false);
  assert.deepEqual(pausedInput.memory, memory);
  const quiet = enterQuiet(dark, 12000);
  const restored = restoreEquipment({ ...quiet, position: [0, 0, -12] }, 23000, 1000);
  assert.deepEqual(restored.memory, memory); assert.equal(restored.faultCount, 3); assert.equal(restored.completedStages, 1);
  assert.equal(restored.blackout, false);
});

test('movement only follows adjacent graph edges, preserves distance travelled and cannot teleport', () => {
  assert.throws(() => createRoute(['SHELTER_WALL', 'CONTAINMENT']), /teleport/);
  const route = createRoute(['SHELTER_WALL', 'NEAR_PATH', 'JUNCTION', 'EMITTER_A']);
  const moved = advanceRoute(route, 2, 0.8);
  assert.ok(Math.abs(distanceToShelter(moved.position) - 4.8) < 1e-8);
  assert.deepEqual(route.position, [0, 0, -3.2]);
  assert.equal(advanceRoute(route, 100, 1.5).arrived, true);
  assert.throws(() => advanceRoute(route, 1, 100), /bounded movement/);
});

test('sedation changes bounded search speed but cannot shorten an already delivered warning', () => {
  assert.equal(sedationAt(0).searchSpeedMps, 0.8);
  assert.equal(sedationAt(90000).searchSpeedMps, 1.15);
  assert.equal(sedationAt(180000).searchSpeedMps, 1.5);
  let state = beginWarning({ ...threat(179000), approachStartedMs: 160000 }, 179000);
  assert.equal(state.warning.durationMs, 8000);
  state = { ...state, lastAudibleEvidenceAtMs: 186999 };
  assert.equal(mayBreach(state, 186999), false);
  assert.equal(mayBreach(state, 187000), true);
});

test('no unwarned breach and no warning before a full approach or without accessible warning delivery', () => {
  assert.equal(mayBreach(threat(), 12000), false);
  assert.equal(mayStartWarning({ ...threat(), approachStartedMs: 3000 }, 12000), false);
  assert.equal(mayStartWarning({ ...threat(), accessibleWarningReady: false }, 12000), false);
  let state = beginWarning(threat(), 12000);
  assert.equal(state.warning.durationMs, 10000);
  state.lastAudibleEvidenceAtMs = 22000;
  assert.equal(mayBreach(state, 21999), false);
  assert.equal(mayBreach(state, 22000), true);
});

test('Q protects before the first lure, retains evidence, listens four seconds and retreats physically before restore', () => {
  let state = beginWarning(threat(), 12000);
  state = enterQuiet(state, 21000);
  assert.equal(state.completedStages, 0); assert.equal(state.lure, null); assert.equal(state.warning, null);
  assert.equal(state.confidence, 0.9); assert.deepEqual(state.position, [0, 0, -3.2]);
  assert.equal(quietPhase(state, 24999), 'LISTENING');
  assert.equal(mayBreach(state, 50000), false);
  assert.equal(enterQuiet(state, 24000).quietSinceMs, 21000, 'Repeated Q does not restart the retreat delay');
  let route = createRoute(['SHELTER_WALL', 'NEAR_PATH']);
  route = advanceRoute(route, 6, 1.5);
  state = { ...state, position: route.position };
  assert.equal(quietPhase(state, 31000), 'CLEAR');
  assert.ok(31000 - state.quietSinceMs <= config.quiet.maximumSecondsToClearFromWarning * 1000);
  const restored = restoreEquipment(state, 32000, 1000);
  assert.equal(restored.quiet, false); assert.equal(restored.restoreProtectedUntilMs, 42000);
});

test('an early restore can always be quieted again and cannot resume an old lethal warning', () => {
  const quiet = enterQuiet(beginWarning(threat(), 12000), 21000);
  const restored = restoreEquipment(quiet, 22000, 1000);
  assert.equal(restored.warning, null); assert.equal(restored.approachStartedMs, 22000);
  assert.equal(mayStartWarning({ ...restored, lastAudibleEvidenceAtMs: 22000 }, 22000), false);
  assert.equal(mayBreach(restored, 22000), false);
  assert.equal(enterQuiet(restored, 22001).quiet, true);
  assert.equal(restoreEquipment(quiet, 22000, 999), quiet);
});

test('all wall-origin quiet routes reach a physical clear window within the sixteen-second bound', () => {
  for (const origin of ['SHELTER_WALL', 'WEST_WALL', 'EAST_WALL']) {
    const path = origin === 'SHELTER_WALL' ? [origin, 'NEAR_PATH'] : [origin, 'SHELTER_WALL', 'NEAR_PATH'];
    const quiet = enterQuiet({ ...threat(), position: [...config.graph.nodes[origin]] }, 0);
    const moved = advanceRoute(createRoute(path), 12, config.quiet.retreatSpeedMps);
    assert.equal(quietPhase({ ...quiet, position: moved.position }, 16000), 'CLEAR');
  }
});

test('earned lure dominates local noise, accepted pulse and model wishes for at least sixteen seconds and until actual arrival', () => {
  let lure = lureReward(10000, 'EMITTER_A');
  assert.equal(lureProtected(lure, 25999), true);
  assert.equal(lureProtected(lure, 50000), true, 'Route remains locked until real arrival');
  lure = markLureArrival(lure, 'EMITTER_A', 50000);
  assert.equal(lureProtected(lure, 53999), true); assert.equal(lureProtected(lure, 54000), false);
  assert.throws(() => markLureArrival(lure, 'SHELTER_WALL', 50000), /actual graph/);
  assert.equal(mayStartWarning({ ...threat(20000), lure, confidence: 1, lastAudibleStrength: 1 }, 20000), false);
  const defended = applyEarnedLure(beginWarning(threat(), 12000), 15000, 'EMITTER_A');
  assert.equal(defended.warning, null); assert.equal(defended.approachStartedMs, null);
  const later = applyEarnedLure(defended, 17000, 'EMITTER_B');
  assert.ok(later.lure.protectedUntilGameMs > defended.lure.protectedUntilGameMs);
  assert.deepEqual(later.position, defended.position, 'A reward does not teleport the creature');
  const oldWarning = { startedAtMs: 12000, durationMs: 10000, delivered: true };
  assert.equal(mayBreach({ ...defended, warning: oldWarning, lure: { ...defended.lure, arrivedAtMs: 30000 }, lastAudibleEvidenceAtMs: 60000 }, 60000), false, 'An old warning cannot resume after lure expiry');
});

test('final containment needs all four research stages, physical arrival, and the complete seal interval', () => {
  let lure = lureReward(0, 'CONTAINMENT');
  assert.equal(containmentWon(4, lure, 90000), false);
  lure = markLureArrival(lure, 'CONTAINMENT', 90000);
  assert.equal(containmentWon(3, lure, 93000), false);
  assert.equal(containmentWon(4, lure, 92999), false);
  assert.equal(containmentWon(4, lure, 93000), true);
});

test('blackout eligibility respects cooldown, warning, tutorial and earned rewards', () => {
  const context = { nowMs: 90000, stage: 3, count: 0, lastBlackoutMs: -Infinity, tutorial: false, warning: false, lure: null, quietRetreat: false, finalContainment: false };
  assert.equal(canBlackout(context), true);
  for (const patch of [{ nowMs: 44000 }, { stage: 1 }, { stage: 5 }, { count: 3 }, { lastBlackoutMs: 40000 }, { tutorial: true }, { warning: true }, { lure: lureReward(89000, 'EMITTER_A') }, { quietRetreat: true }, { finalContainment: true }]) assert.equal(canBlackout({ ...context, ...patch }), false);
});

test('blackout hides visual distance but preserves truthful approach/recession and warning captions', () => {
  const dark = { ...threat(), blackout: true, position: [0, 0, -6] };
  const approaching = presentation(dark, [0, 0, -8], 12000);
  assert.equal(approaching.distanceM, null); assert.equal(approaching.danger, null); assert.equal(approaching.securityOnline, false);
  assert.match(approaching.caption, /APPROACHING/);
  assert.match(presentation(dark, [0, 0, -4], 12000).caption, /RECEDING/);
  assert.match(presentation({ ...dark, warning: { delivered: true } }, [0, 0, -8], 12000).caption, /BREACH WARNING/);
  const farQuiet = enterQuiet({ ...dark, position: [0, 0, -26] }, 12000);
  assert.doesNotMatch(presentation(farQuiet, farQuiet.position, 13000).caption, /BREATHING|WALL/);
  assert.equal(presentation(farQuiet, farQuiet.position, 23000).caption, 'NO NEARBY MOVEMENT — RESTORE WINDOW');
});

test('quiet camping never completes research or creates a final win', () => {
  let state = { ...enterQuiet(threat(), 0), memory: createMemory([1, 2, 3, 4]), faults: { required: 5, cleared: 0, active: [1], complete: false } };
  for (let i = 0; i < 100; i++) {
    state = { ...state, faults: resolveFault(state.faults, 1, false).task, memory: enterMemory(state.memory, i % 4 + 1, false).memory };
  }
  assert.equal(state.faults.cleared, 0); assert.equal(state.memory.armed, false); assert.equal(containmentWon(state.completedStages, state.lure, 1000000), false);
  assert.equal(sedationAt(1000000).band, 'ALERT');
});

test('pulse acceptance rejects missing, stale, rejected, unsupported, future and simulated-as-live values', () => {
  assert.equal(acceptedPulse(sample(1000, 80), 2000), 80);
  assert.equal(acceptedPulse(null, 2000), null);
  for (const s of [sample(1000, 80, { quality: 'rejected' }), sample(1000, 120), sample(1000, NaN), sample(1000, 80, { source: 'simulated' }), sample(1000, 80, { source: 'manual' }), sample(5000, 80), sample(1000, 80, { measuredMonotonicMs: 9000 })]) assert.equal(acceptedPulse(s, 2000), null);
  assert.equal(acceptedPulse(sample(1000), 6001), null);
  assert.equal(acceptedPulse(sample(1000, 80, { source: 'simulated' }), 2000, true), 80);
});

test('baseline requires warmup plus thirty usable seconds, rejects gaps and remains a frozen value', () => {
  const data = Array.from({ length: 43 }, (_, i) => sample(i * 1000, i < 12 ? 100 : 70));
  const baseline = baselineFrom(data, 0);
  assert.equal(baseline, 70);
  assert.equal(baselineFrom(data.slice(0, 40), 0), null);
  assert.equal(baselineFrom(data.filter(s => s.receivedMonotonicMs < 20000 || s.receivedMonotonicMs > 30000), 0), null);
  const elevated = samples(50000, 90);
  pulseTrend(elevated, baseline, 62000);
  assert.equal(baseline, 70);
});

test('trend needs twelve sustained seconds, handles timestamp jitter, immediate unknown and twenty-second dwell', () => {
  assert.equal(pulseTrend(samples(), 70, 12000).trend, 'ELEVATED');
  assert.equal(pulseTrend(samples(), 70, 12001).trend, 'ELEVATED', 'Receive-time jitter does not erase a covered window');
  assert.equal(pulseTrend(samples(), 70, 18000).trend, 'UNKNOWN');
  const bad = samples(); bad[3].quality = 'rejected';
  assert.equal(pulseTrend(bad, 70, 12000, { trend: 'ELEVATED', changedAtMs: 11000 }).trend, 'UNKNOWN');
  assert.equal(pulseTrend(samples(0, 70), 70, 12000, { trend: 'ELEVATED', changedAtMs: 0 }).trend, 'ELEVATED');
  assert.equal(pulseTrend(samples(20000, 70), 70, 32000, { trend: 'ELEVATED', changedAtMs: 0 }).trend, 'RECOVERED');
});

test('physiology is capped near the shelter, neutral when unknown/quiet, and never independently enables a breach', () => {
  assert.equal(physiologyClue({ trend: 'ELEVATED', quality: 'accepted', distanceM: 4 }), 0.18);
  for (const patch of [{ distanceM: 9 }, { quality: 'unknown' }, { trend: 'UNKNOWN' }, { quiet: true }]) assert.equal(physiologyClue({ trend: 'ELEVATED', quality: 'accepted', distanceM: 4, ...patch }), 0);
  const state = { ...threat(300000), confidence: 1, lastAudibleEvidenceAtMs: null, lastAudibleStrength: 0 };
  assert.equal(mayStartWarning(state, 300000), false);
  assert.equal(mayBreach({ ...state, warning: { startedAtMs: 0, durationMs: 6000, delivered: true } }, 300000), false);
});

const proposal = { requestId: 'request-1', stateVersion: 7, tactic: 'WAIT', target: 'NONE', evidenceEventIds: ['run:e1'], reasonCode: 'NO_VALID_SIGNAL', tauntId: 'NONE' };
const context = () => ({ requestId: 'request-1', stateVersion: 7, nowMs: 13000, issuedAtGameMs: 12000, expiresAtGameMs: 20000, previousRequestAtMs: null, usedRequestIds: new Set(), allowedTactics: ['WAIT', 'TAUNT', 'INVESTIGATE_SOUND', 'LISTEN_NEAR', 'FOLLOW_LURE', 'RETREAT'], allowedTargets: ['NONE', 'SHELTER', 'EMITTER_A', 'EMITTER_B', 'CONTAINMENT'], allowedTauntIds: ['NONE', 'HEARD_RHYTHM'], publicEventIds: new Set(['run:e1']), quiet: false, distanceM: 4, trend: 'UNKNOWN', quality: 'unknown', lure: null });

test('director validation rejects malformed, late, duplicate, stale, unproven and illegal proposals', () => {
  assert.equal(validateProposal(proposal, context()), null);
  assert.equal(validateProposal('invalid JSON', context()), 'BAD_SHAPE');
  assert.equal(validateProposal({ ...proposal, tactic: 'KILL' }, context()), 'BAD_ENUM');
  assert.equal(validateProposal({ ...proposal, requestId: 'old' }, context()), 'WRONG_REQUEST');
  assert.equal(validateProposal(proposal, { ...context(), usedRequestIds: new Set(['request-1']) }), 'DUPLICATE');
  assert.equal(validateProposal(proposal, { ...context(), nowMs: 20001 }), 'EXPIRED');
  assert.equal(validateProposal(proposal, { ...context(), stateVersion: 8 }), 'STALE_STATE');
  assert.equal(validateProposal({ ...proposal, evidenceEventIds: ['private-sequence'] }, context()), 'UNKNOWN_EVIDENCE');
  assert.equal(validateProposal({ ...proposal, target: 'SHELTER' }, context()), 'TARGET_MISMATCH');
  assert.equal(validateProposal(proposal, { ...context(), previousRequestAtMs: 11000 }), 'COOLDOWN');
});

test('AI cannot cancel quiet, teleport a listening tactic, invent a pulse clue, or change an earned lure target', () => {
  assert.equal(validateProposal({ ...proposal, tactic: 'INVESTIGATE_SOUND', target: 'SHELTER' }, { ...context(), quiet: true }), 'QUIET_PROTECTED');
  assert.equal(validateProposal({ ...proposal, tactic: 'LISTEN_NEAR', target: 'SHELTER' }, { ...context(), distanceM: 30 }), 'NOT_NEAR');
  assert.equal(validateProposal({ ...proposal, tactic: 'TAUNT', tauntId: 'HEARD_RHYTHM' }, context()), 'NO_VALID_SIGNAL');
  const lure = lureReward(12000, 'EMITTER_A');
  assert.equal(validateProposal({ ...proposal, tactic: 'INVESTIGATE_SOUND', target: 'SHELTER' }, { ...context(), lure }), 'LURE_PROTECTED');
  assert.equal(validateProposal({ ...proposal, tactic: 'FOLLOW_LURE', target: 'EMITTER_B' }, { ...context(), lure }), 'LURE_TARGET_MISMATCH');
  assert.equal(validateProposal({ ...proposal, tactic: 'FOLLOW_LURE', target: 'EMITTER_A' }, { ...context(), lure }), null);
});

test('director waits are independent of emergency input and puzzle functions', () => {
  const waiting = context();
  for (let elapsed = 0; elapsed < config.director.responseBudgetMs; elapsed += 1000) {
    const defended = enterQuiet(beginWarning(threat(12000), 12000), 12000 + elapsed);
    assert.equal(mayBreach(defended, 22000), false);
    const changed = resolveFault({ required: 5, cleared: 0, active: [1], complete: false }, 1);
    assert.equal(changed.task.cleared, 1);
    assert.equal(validateProposal(proposal, { ...waiting, nowMs: 12000 + elapsed }), null);
  }
});

test('public events retain useful evidence but exclude raw pulse, images, puzzle answers and arbitrary text', () => {
  const event = eventClock('run_17', 1, 12000, 88000, 'PHYSIO_TREND', { source: 'presage', quality: 'accepted', trend: 'ELEVATED', pulseBpm: 82, frame: 'PRIVATE_IMAGE', sequence: [1, 3, 2, 4], freeText: 'PRIVATE_STRING' });
  assert.deepEqual(publicEvent(event).data, { source: 'presage', quality: 'accepted', trend: 'ELEVATED' });
  const malformed = publicEvent({ ...event, data: { source: 'PRIVATE_STRING', trend: 'PRIVATE_IMAGE' } });
  assert.deepEqual(malformed.data, {});
  const paused = eventClock('run_17', 2, 12000, 98000, 'PAUSED');
  assert.equal(paused.gameMs, event.gameMs); assert.ok(paused.receivedMonotonicMs > event.receivedMonotonicMs);
  assert.notEqual(event.id, eventClock('run_18', 1, 12000, 88000, 'PHYSIO_TREND').id);
});

test('nonfinite physical inputs cannot create rewards, early restore, or a lethal sound clue', () => {
  assert.throws(() => lureReward(NaN, 'EMITTER_A'), /finite/);
  assert.throws(() => markLureArrival(lureReward(0, 'EMITTER_A'), 'EMITTER_A', Infinity), /finite/);
  assert.throws(() => enterQuiet(threat(), NaN), /finite/);
  assert.throws(() => restoreEquipment(enterQuiet(threat(), 0), 10000, NaN), /finite/);
  assert.equal(mayStartWarning({ ...threat(), lastAudibleStrength: Infinity }, 12000), false);
  assert.equal(confidenceAfter(0.5, { machinery: Infinity, transient: NaN, physiology: Infinity }, 1), 0.45);
});
