import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { config } from '../src/game/reducer';
import { PACES, playBalancedRun } from './balance-helpers';

/** These policies know puzzle answers and react to the public alarm after a scripted delay.
 * They measure reducer solvability and a repeatable balance envelope, not human performance. */
test('30 seeded runs per policy stay bounded, take minutes, bring regular alarms and reward skill', () => {
  const policies = [
    { name: 'perfect-information', pace: 'perfect' as const },
    { name: 'fast', pace: 'fast' as const },
    { name: 'human-paced', pace: 'human' as const },
    { name: 'slow-error-prone', pace: 'slow' as const },
    { name: 'human-paced-simulated-elevated', pace: 'human' as const, elevated: true },
  ].map(({ name, pace, elevated }) => {
    const runs = Array.from({ length: 30 }, (_, i) => playBalancedRun(i + 1, { pace, elevated }));
    const wins = runs.filter(run => run.status === 'won');
    for (const run of runs) {
      assert.notEqual(run.status, 'playing', `${name} seed${run.seed}`);
      assert.ok(run.time <= config.line.deadlineSeconds + .001);
      assert.ok(run.shutdown.used <= config.shutdown.charges + 4 * config.shutdown.stageRefill);
    }
    const gaps = runs.flatMap(run => run.alarmTimes.slice(1).map((time, i) => time - run.alarmTimes[i]));
    return {
      name, count: runs.length, wins: wins.length,
      meanWinSeconds: wins.reduce((sum, run) => sum + run.time, 0) / wins.length,
      maxWinSeconds: Math.max(...wins.map(run => run.time)),
      meanAlarms: runs.reduce((sum, run) => sum + run.alarmTimes.length, 0) / runs.length,
      meanSecondsBetweenAlarms: gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length),
      meanIsolationChargesUsed: runs.reduce((sum, run) => sum + run.shutdown.used, 0) / runs.length,
      outcomes: runs.map(run => ({ seed: run.seed, outcome: run.status, seconds: Math.round(run.time * 1000) / 1000, stage: run.tasks.stage, step: run.tasks.step, chargesUsed: run.shutdown.used, alarms: run.alarmTimes.length, reason: run.lossReason ?? null })),
    };
  });
  const evidence = {
    kind: 'DETERMINISTIC REDUCER BALANCE — NOT A HUMAN PLAYTEST',
    limitation: 'Policies know private puzzle answers, solve thinking tasks after a scripted delay and react to the public proximity alarm after a scripted delay; with no isolation available they go silent. They do not measure human attention, drag accuracy, rhythm, memory or camera performance. No live provider or physiological measurements were used.',
    paces: PACES,
    elevated: 'synthetic accepted ELEVATED throughout; no raw pulse samples',
    config: { line: config.line, lineBias: config.lineBias, lineWeights: config.lineWeights, lineLure: config.lineLure, danger: config.danger, shutdown: config.shutdown, tasks: { stage1: config.tasks.stage1, stage2: config.tasks.stage2, stage3: config.tasks.stage3, stage4: config.tasks.stage4, routing: config.tasks.routing, pulse: config.tasks.pulse, locate: config.tasks.locate, calm: config.tasks.calm } },
    results: policies,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/survival-balance.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(policies.map(({ outcomes, ...summary }) => summary)));
  const [perfect, fast, human, slow, elevated] = policies;
  assert.ok(perfect.wins >= 15 && fast.wins >= 15, 'skilled play usually survives');
  assert.ok(perfect.wins <= 29 && fast.wins <= 27, 'even skilled play is sometimes caught');
  assert.ok(human.wins >= 5 && human.wins <= 18, 'human-paced play is hard, not hopeless');
  assert.ok(human.meanWinSeconds >= 200 && human.meanWinSeconds <= 360, 'a human-paced win takes about four to six minutes');
  assert.ok(human.meanAlarms >= 2.5 && perfect.meanAlarms >= 1, 'working regularly draws it to the wall, even without mistakes');
  assert.ok(human.meanSecondsBetweenAlarms >= 30, 'alarms are regular, not constant');
  assert.ok(slow.wins < human.wins, 'slower repeated mistakes must have a measurable cost');
  assert.ok(elevated.wins <= human.wins + 2, 'an accepted elevated trend never makes the run easier');
  assert.ok(elevated.wins >= 1, 'a sustained elevated pulse is harder but still winnable');

});
