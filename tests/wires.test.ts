import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, step } from '../src/game/reducer';
import { startStage } from '../src/game/tasks';
import type { GameState } from '../src/game/state';

function cleared(stage: 1 | 3 = 1): GameState {
  let s = createGame(17, 'tutorial');
  startStage(s, stage);
  while (s.tasks.faults.completed < s.tasks.faults.required) {
    const fault = s.tasks.faults.active[0];
    s = fault === undefined ? step(s, .2) : dispatch(s, { type: 'input', value: fault + 1 });
  }
  return s;
}
test('each repair requires four valid wire links before memory starts', () => {
  for (const stage of [1, 3] as const) {
    let s = cleared(stage);
    assert.equal(s.tasks.stage, stage);
    assert.deepEqual([...s.tasks.wires.targetOrder].sort(), [0, 1, 2, 3]);
    assert.notDeepEqual(s.tasks.wires.targetOrder, [0, 1, 2, 3]);
    for (let from = 0; from < 4; from++) {
      s = dispatch(s, { type: 'wire', from, to: s.tasks.wires.targetOrder.indexOf(from) });
      if (from < 3) assert.equal(s.tasks.stage, stage);
    }
    assert.equal(s.tasks.stage, stage + 1);
    assert.equal(s.events.filter(e => e.type === 'WIRE_CONNECTED').length, 4);
    assert.equal(s.events.filter(e => e.type === 'TASK_COMPLETE').length, 1);
  }
});
test('wrong links add bounded mistake pressure without completing wires; duplicates are neutral', () => {
  let s = cleared();
  s = dispatch(s, { type: 'wire', from: 0, to: s.tasks.wires.targetOrder.indexOf(1) });
  assert.ok(s.pressure > 0);
  assert.deepEqual(s.tasks.wires.connections, [-1, -1, -1, -1]);
  assert.equal(s.events.at(-1)?.type, 'WRONG_INPUT');
  const correct = { type: 'wire' as const, from: 0, to: s.tasks.wires.targetOrder.indexOf(0) };
  s = dispatch(s, correct);
  const events = s.eventSequence;
  s = dispatch(s, correct);
  assert.equal(s.eventSequence, events);
  assert.equal(s.events.filter(e => e.type === 'WIRE_CONNECTED').length, 1);
});
test('wire validation blocks pre-repair, wrong station, unpowered, paused and invalid endpoints', () => {
  let s = createGame(17);
  const wire = { type: 'wire' as const, from: 0, to: s.tasks.wires.targetOrder.indexOf(0) };
  assert.deepEqual(dispatch(s, wire).tasks.wires, s.tasks.wires);
  s = cleared();
  for (const input of [{ ...wire, from: NaN }, { ...wire, to: 4 }, { ...wire, from: .5 }]) assert.deepEqual(dispatch(s, input).tasks.wires, s.tasks.wires);
  for (const blocked of [dispatch(s, { type: 'station', station: 'cameras' }), dispatch(s, { type: 'quiet' }), dispatch(s, { type: 'pause' })]) {
    assert.deepEqual(dispatch(blocked, wire).tasks.wires, blocked.tasks.wires);
  }
});
test('connected cables persist across pause and isolation', () => {
  let s = cleared();
  s = dispatch(s, { type: 'wire', from: 0, to: s.tasks.wires.targetOrder.indexOf(0) });
  const wires = structuredClone(s.tasks.wires);
  s = dispatch(s, { type: 'pause' }); s = step(s, 30);
  assert.deepEqual(s.tasks.wires, wires);
  s = dispatch(s, { type: 'pause' }); s = dispatch(s, { type: 'quiet' }); s = step(s, 10);
  assert.deepEqual(s.tasks.wires, wires);
});
