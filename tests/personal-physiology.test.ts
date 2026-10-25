import test from 'node:test';
import assert from 'node:assert/strict';
import { config, createGame, dispatch, step } from '../src/game/reducer';
import { movementProbabilities } from '../src/game/creature';
import { buildDirectorRequest } from '../src/game/directorValidation';
import { calmInhale, memoryRounds, startStage } from '../src/game/tasks';
import type { GameAction, GameState } from '../src/game/state';
import { BreathingBaseline } from '../src/sensing/breathingBaseline';
import { buildPulseReport, type BreathSample, type PulseSample } from '../src/report/analysis';

type Setup = GameAction[];
const live: GameAction = { type: 'sensor', source: 'presage', quality: 'accepted', trend: 'STEADY' };
/** Finish the stage's memory rounds so the reducer itself creates the heartbeat mask (stage 2) or calm pacer (stage 4). */
function reach(which: 'pulse' | 'calm', setup: Setup = [], seed = 17): GameState {
  let state = createGame(seed); state.time = 60; state.creature.nextMoveAt = 1000; state.blackout.nextAt = 1000;
  for (const action of setup) state = dispatch(state, action);
  startStage(state, which === 'pulse' ? 2 : 4);
  for (let round = 0; round < memoryRounds(state).rounds; round++) {
    while (state.tasks.memory.playing) state = step(state, .2);
    for (const value of [...state.tasks.memory.sequence]) state = dispatch(state, { type: 'input', value });
  }
  assert.equal(state.tasks.step, which);
  return state;
}

test('heartbeat mask uses the player\'s own rounded resting pulse; manual play keeps the seeded rhythm and RNG', () => {
  const manual = reach('pulse'), own = reach('pulse', [live, { type: 'personal', restingBpm: 71.6, restingBreathsPerMinute: null }]);
  assert.equal(own.tasks.pulse.personal, true);
  assert.ok(Math.abs(own.tasks.pulse.periodSeconds - 60 / 72) < 1e-9);
  assert.equal(manual.tasks.pulse.personal, false);
  assert.equal(own.rng, manual.rng, 'personal sensing never shifts the seeded random stream');
  const fast = reach('pulse', [live, { type: 'personal', restingBpm: 104, restingBreathsPerMinute: null }]);
  assert.ok(Math.abs(fast.tasks.pulse.periodSeconds - 60 / config.tasks.pulse.maximumBpm) < 1e-9, 'clamped to a tappable range');
  const optedOut = reach('pulse', [{ type: 'personal', restingBpm: 72, restingBreathsPerMinute: null }]);
  assert.equal(optedOut.tasks.pulse.personal, false, 'a stale baseline never personalizes manual play');
  const invalid = dispatch(createGame(17), { type: 'personal', restingBpm: 300, restingBreathsPerMinute: Number.NaN });
  assert.deepEqual(invalid.personal, { restingBpm: null, restingBreathsPerMinute: null });
});

test('calm pacer starts at the player\'s breathing pace and slows each breath to the standard pace', () => {
  const settings = config.tasks.calm;
  const manual = reach('calm');
  assert.equal(manual.tasks.calm.personal, false); assert.equal(manual.tasks.calm.halfSeconds, settings.breathSeconds);
  let state = reach('calm', [live, { type: 'personal', restingBpm: null, restingBreathsPerMinute: 12 }]);
  assert.equal(state.tasks.calm.personal, true);
  assert.ok(Math.abs(state.tasks.calm.halfSeconds - 2.5) < 1e-9, '12 breaths/min is a 2.5-second inhale');
  const halves: number[] = [state.tasks.calm.halfSeconds];
  for (let t = 0; t < 60 && state.tasks.step === 'calm'; t += .1) {
    state = dispatch(state, { type: 'breathe', holding: calmInhale(state) }); state = step(state, .1);
    if (state.tasks.calm.halfSeconds !== halves.at(-1)) halves.push(state.tasks.calm.halfSeconds);
  }
  assert.ok(halves.length > 1, 'the pacer slowed at least once');
  for (let i = 1; i < halves.length; i++) assert.ok(halves[i]! > halves[i - 1]! && halves[i]! <= settings.breathSeconds + 1e-9);
  assert.ok(state.events.some(e => e.type === 'CALM_COMPLETE') && state.tasks.step !== 'calm', 'following the personal pacer still completes the calm hold');
  const quick = reach('calm', [live, { type: 'personal', restingBpm: null, restingBreathsPerMinute: 30 }]);
  assert.equal(quick.tasks.calm.halfSeconds, settings.personalMinimumBreathSeconds, 'never faster than the minimum phase');
});

test('calming down from ELEVATED to RECOVERED makes it lose your trail, once per stage, live data only', () => {
  let state = createGame(17); state.time = 60;
  state = dispatch(state, { type: 'sensor', source: 'presage', quality: 'accepted', trend: 'ELEVATED' });
  const before = movementProbabilities(state);
  state = dispatch(state, { type: 'trend', trend: 'RECOVERED' });
  assert.equal(state.events.at(-1)?.type, 'RECOVERY_REWARD');
  assert.ok(Math.abs(state.recovery.until - (60 + config.recovery.durationSeconds)) < 1e-9);
  const after = movementProbabilities(state);
  const outward = (rows: typeof before) => rows.filter(row => row.step > 0).reduce((sum, row) => sum + row.probability, 0);
  assert.ok(outward(after) > outward(before), 'more likely to drift away from the wall');
  // Same stage: a second recovery earns nothing.
  state = dispatch(state, { type: 'trend', trend: 'ELEVATED' }); state = dispatch(state, { type: 'trend', trend: 'RECOVERED' });
  assert.equal(state.events.filter(e => e.type === 'RECOVERY_REWARD').length, 1);
  // A new stage can earn it again, even across a brief UNKNOWN capture gap.
  startStage(state, 2);
  state = dispatch(state, { type: 'trend', trend: 'ELEVATED' }); state = dispatch(state, { type: 'trend', trend: 'UNKNOWN' }); state = dispatch(state, { type: 'trend', trend: 'RECOVERED' });
  assert.equal(state.events.filter(e => e.type === 'RECOVERY_REWARD').length, 2);
  assert.deepEqual(state.recovery.rewardedStages, [1, 2]);
  assert.ok(outward(movementProbabilities(step(state, config.recovery.durationSeconds + .1))) < outward(movementProbabilities(state)), 'the reward expires');
});

test('no recovery reward for manual play, tutorial, or a plain steady trend', () => {
  let manual = createGame(17);
  manual = dispatch(manual, { type: 'sensor', source: 'manual', quality: 'accepted', trend: 'ELEVATED' });
  manual = dispatch(manual, { type: 'trend', trend: 'RECOVERED' });
  assert.equal(manual.events.some(e => e.type === 'RECOVERY_REWARD'), false);
  let tutorial = createGame(17, 'tutorial');
  tutorial = dispatch(tutorial, { type: 'sensor', source: 'presage', quality: 'accepted', trend: 'ELEVATED' });
  tutorial = dispatch(tutorial, { type: 'trend', trend: 'RECOVERED' });
  assert.equal(tutorial.events.some(e => e.type === 'RECOVERY_REWARD'), false);
  let steady = createGame(17);
  steady = dispatch(steady, { type: 'sensor', source: 'presage', quality: 'accepted', trend: 'STEADY' });
  steady = dispatch(steady, { type: 'trend', trend: 'RECOVERED' });
  assert.equal(steady.events.some(e => e.type === 'RECOVERY_REWARD'), false, 'nothing to recover from');
});

test('personal resting values never reach the director request', () => {
  const state = dispatch(dispatch(createGame(17), live), { type: 'personal', restingBpm: 67, restingBreathsPerMinute: 13 });
  const text = JSON.stringify(buildDirectorRequest(state));
  for (const key of ['personal', 'restingBpm', 'restingBreathsPerMinute', 'halfSeconds']) assert.equal(text.includes(`"${key}"`), false);
});

test('resting breathing freezes the median of a continuous accepted span; gaps and out-of-range values reset it', () => {
  const baseline = new BreathingBaseline();
  [14, 13, 30, 15].forEach((rpm, i) => baseline.add(rpm, i * 4000));
  assert.equal(baseline.value, null, '12 seconds is not enough');
  baseline.add(14, 16_000); assert.equal(baseline.value, 14);
  baseline.add(25, 20_000); assert.equal(baseline.value, 14, 'frozen once set');
  const gapped = new BreathingBaseline();
  gapped.add(14, 0); gapped.add(14, 4000); gapped.add(14, 12_000); gapped.add(14, 16_000);
  assert.equal(gapped.value, null, 'an 8-second gap restarts the span');
  gapped.add(80, 17_000); gapped.add(14, 18_000); assert.equal(gapped.value, null);
});

test('run report adds a breathing trace and recovery markers without changing the unrecorded shape', () => {
  const pulse: PulseSample[] = Array.from({ length: 40 }, (_, s) => ({ capturedAtMs: s * 1000, gameMs: s * 1000, segment: 0, bpm: 70, source: 'presage', accepted: true }));
  const breaths: BreathSample[] = [...Array.from({ length: 20 }, (_, s) => ({ capturedAtMs: s * 2000, gameMs: s * 2000, segment: 0, rpm: s < 10 ? 13 : 19, source: 'presage' as const, accepted: true })),
    { capturedAtMs: 1500, gameMs: 1500, segment: 0, rpm: 60, source: 'presage', accepted: true }, { capturedAtMs: 2500, gameMs: 2500, segment: 0, rpm: 15, source: 'simulated', accepted: true }];
  const events = [{ id: 'e1', type: 'SCARE', capturedAtMs: 10_000, gameMs: 10_000, segment: 0 }, { id: 'e2', type: 'RECOVERY', capturedAtMs: 30_000, gameMs: 30_000, segment: 0 }];
  const report = buildPulseReport({ recordingConsent: true, source: 'presage', baselineBpm: 70, samples: pulse, events, breathingSamples: breaths, restingBreathingRpm: 13 });
  assert.equal(report.breathing?.timeline.length, 20, 'out-of-range and wrong-source breathing is excluded');
  assert.equal(report.breathing?.restingRpm, 13); assert.equal(report.breathing?.lowestRpm, 13); assert.equal(report.breathing?.highestRpm, 19);
  assert.deepEqual(report.markers.map(e => e.type), ['SCARE', 'RECOVERY']);
  assert.equal(buildPulseReport({ recordingConsent: true, source: 'presage', baselineBpm: 70, samples: pulse }).breathing, undefined);
  assert.deepEqual(buildPulseReport({ recordingConsent: false, source: 'presage', baselineBpm: 70, samples: pulse, breathingSamples: breaths }),
    { status: 'unrecorded', timeline: [], markers: [], baselineBpm: null, highestBpm: null, largestIncrease: null, recovery: [] });
});
