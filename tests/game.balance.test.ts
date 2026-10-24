import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { config } from '../src/game/config';
import { playBalancedRun } from './balance-helpers';

/** These policies know puzzle answers and react immediately to the public alarm.
 * They measure reducer solvability and a repeatable balance envelope, not human performance. */
test('100 seeded runs per policy remain bounded, reward skill and finish within the300second budget', () => {
  const policies = [
    { name: 'fast-perfect-information', options: {} },
    { name: 'medium-perfect-information', options: { slow: true } },
    { name: 'medium-two-fault-mistakes', options: { slow: true, mistakes: true } },
    { name: 'slow-error-prone', options: { slow: true, novice: true } },
    { name: 'medium-two-mistakes-simulated-elevated', options: { slow: true, mistakes: true, elevated: true } },
  ].map(({ name, options }) => {
    const runs = Array.from({ length: 100 }, (_, i) => playBalancedRun(i + 1, options));
    const wins = runs.filter(run => run.status === 'won');
    for (const run of runs) {
      assert.notEqual(run.status, 'playing', `${name} seed${run.seed}`);
      assert.ok(run.time <= config.line.deadlineSeconds + .001);
      assert.ok(run.shutdown.used <= config.shutdown.charges);
    }
    return {
      name, count: runs.length, wins: wins.length,
      meanWinSeconds: wins.reduce((sum, run) => sum + run.time, 0) / wins.length,
      maxWinSeconds: Math.max(...wins.map(run => run.time)),
      runsWithNearEncounter: runs.filter(run => run.events.some(event => event.type === 'PROXIMITY_ALARM')).length,
      meanIsolationChargesUsed: runs.reduce((sum, run) => sum + run.shutdown.used, 0) / runs.length,
      outcomes: runs.map(run => ({ seed: run.seed, outcome: run.status, seconds: Math.round(run.time * 1000) / 1000, stage: run.tasks.stage, chargesUsed: run.shutdown.used, alarms: run.events.filter(event => event.type === 'PROXIMITY_ALARM').length, reason: run.lossReason ?? null })),
    };
  });
  const fast = policies[0], medium = policies[1], novice = policies[3];
  assert.equal(fast.wins, 100);
  assert.ok(medium.wins >= 80 && medium.meanWinSeconds <= 300);
  assert.ok(medium.runsWithNearEncounter >= 50, 'ordinary paced solving should usually encounter a near approach');
  assert.ok(medium.meanIsolationChargesUsed >= .8);
  assert.ok(novice.wins < medium.wins, 'slower repeated mistakes must have a measurable cost');
  const evidence = {
    kind: 'DETERMINISTIC REDUCER BALANCE — NOT A HUMAN PLAYTEST',
    limitation: 'Policies know private puzzle answers and respond to the public proximity alarm immediately. They do not measure human attention, drag accuracy, memory or camera performance. No live provider or physiological measurements were used.',
    policies: { fast: '0.3s input spacing', medium: '2.5s per fault;1.5s per wire;1s per memory digit', twoMistakes: 'one wrong quiet machine at the start of each fault stage', slowErrorProne: '3.5s per fault;2.5s per wire;1.5s per digit;one wrong input every third fault', elevated: 'synthetic accepted ELEVATED throughout; no raw pulse samples' },
    config: { line: config.line, lineBias: config.lineBias, lineWeights: config.lineWeights, lineLure: config.lineLure, danger: config.danger, shutdown: config.shutdown },
    results: policies,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/survival-balance.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(policies.map(({ outcomes, ...summary }) => summary)));
});
