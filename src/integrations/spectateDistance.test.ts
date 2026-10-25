import test from 'node:test';
import assert from 'node:assert/strict';
import { creatureDistance, DRIFT_METRES, METRES_PER_UNIT } from '../spectate/distance';

test('the wall reads as words, never as a number', () => {
  for (const position of [0, -3, Number.NaN]) assert.deepEqual(creatureDistance(position, 12.3, 17), { metres: 0, atWall: true, label: 'at the wall' });
});

test('distance scales to about 5 m per unit and stays within the drift band', () => {
  for (let position = 1; position <= 24; position++) for (let t = 0; t < 120; t += .37) {
    const d = creatureDistance(position, t, 42);
    assert.equal(d.atWall, false);
    assert.ok(Math.abs(d.metres - position * METRES_PER_UNIT) <= DRIFT_METRES + 1e-9, `${position} @ ${t}: ${d.metres}`);
    assert.match(d.label, /^\d+ m$/);
  }
  assert.ok(Math.abs(creatureDistance(24, 3, 1).metres - 120) <= DRIFT_METRES);
});

test('fractional positions near the wall never read below zero', () => {
  for (let position = .01; position < 1.2; position += .03) for (let t = 0; t < 30; t += .11) {
    const d = creatureDistance(position, t, 9);
    assert.ok(d.metres >= 0, `${position} @ ${t}`);
    assert.notEqual(d.label, '0 m');
  }
});

test('the drift is deterministic, smooth and actually moves', () => {
  assert.deepEqual(creatureDistance(11, 37.5, 5), creatureDistance(11, 37.5, 5));
  let low = Infinity, high = -Infinity, previous = creatureDistance(11, 0, 5).metres;
  for (let t = .1; t <= 60; t += .1) {
    const metres = creatureDistance(11, t, 5).metres;
    assert.ok(Math.abs(metres - previous) < .3, `jump at ${t}`);
    low = Math.min(low, metres); high = Math.max(high, metres); previous = metres;
  }
  assert.ok(high - low > 2, `drift range ${high - low}`);
  assert.notEqual(creatureDistance(11, 10, 5).metres, creatureDistance(11, 10, 6).metres, 'seed shifts the phase');
});

test('readouts are not stuck on multiples of five', () => {
  const shown = new Set<number>();
  for (let t = 0; t < 40; t += .5) shown.add(Number(creatureDistance(8, t, 3).label.split(' ')[0]));
  assert.ok([...shown].some(value => value % 5 !== 0), [...shown].join(','));
  assert.ok(shown.size >= 3);
  assert.equal(creatureDistance(8, Number.NaN, 3).atWall, false);
});
