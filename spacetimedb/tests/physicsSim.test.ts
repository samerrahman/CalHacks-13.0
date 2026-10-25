import test from 'node:test';
import assert from 'node:assert/strict';
import { applyImpulse, allAsleep, impulsesFromEvents, OBSTACLES, PROPS, ROOM, sanitizeBody, spawnBodies, stepBodies, type Body } from '../src/physicsSim';

function run(seqs: number[], steps = 900): Body[] {
  let bodies = spawnBodies();
  for (const seq of seqs) bodies = stepBodies(applyImpulse(bodies, { seq, source: 'DOOR_POUND', strength: 1 }), 20);
  return stepBodies(bodies, steps);
}

test('spawned props rest asleep on their surfaces and stepping leaves them untouched', () => {
  const bodies = spawnBodies();
  assert.equal(bodies.length, PROPS.length);
  assert.ok(allAsleep(bodies));
  assert.deepEqual(stepBodies(bodies, 120), bodies);
});

test('a door pound wakes props, then every prop settles asleep inside the room and outside obstacles', () => {
  const start = spawnBodies();
  const kicked = applyImpulse(start, { seq: 7, source: 'DOOR_POUND', strength: 1 });
  assert.ok(kicked.every(b => !b.sleeping));
  assert.deepEqual(start, spawnBodies(), 'impulses do not mutate their input');
  const moved = stepBodies(kicked, 30);
  assert.ok(moved.some((b, i) => Math.hypot(b.x - start[i]!.x, b.y - start[i]!.y, b.z - start[i]!.z) > 0.01));
  const settled = stepBodies(kicked, 900);
  assert.ok(allAsleep(settled), 'props come to rest within 15 simulated seconds');
  for (const b of settled) {
    const r = PROPS[b.slot]!.radius;
    for (let a = 0; a < 3; a++) {
      const p = [b.x, b.y, b.z][a]!;
      assert.ok(p >= ROOM.min[a]! + r - 1e-6 && p <= ROOM.max[a]! - r + 1e-6, `slot ${b.slot} stays in the room`);
    }
    for (const box of OBSTACLES) {
      const inside = [b.x, b.y, b.z].every((p, a) => p > box.min[a]! + 1e-3 && p < box.max[a]! - 1e-3);
      assert.equal(inside, false, `slot ${b.slot} is not buried in an obstacle`);
    }
  }
});

test('the same impulses always produce the same frames', () => {
  assert.deepEqual(run([3, 9, 14]), run([3, 9, 14]));
  assert.notDeepEqual(run([3, 9, 14], 10), run([4, 9, 14], 10), 'jitter follows the impulse sequence');
});

test('door pounds push props near the door harder than props on the far desk', () => {
  const start = spawnBodies();
  const kicked = applyImpulse(start, { seq: 1, source: 'BREACH', strength: 1 });
  const speed = (b: Body) => Math.hypot(b.vx, b.vy, b.vz);
  assert.ok(speed(kicked[4]!) > speed(kicked[0]!), 'bottle by the door outruns the mug on the desk');
  assert.ok(kicked[4]!.vz < 0, 'the blast points away from the door');
});

test('knocks only move their own slot and zero-strength impulses do nothing', () => {
  const start = spawnBodies();
  const knocked = applyImpulse(start, { seq: 2, source: 'KNOCK', strength: 0.5, slot: 1 });
  assert.equal(knocked.filter(b => !b.sleeping).length, 1);
  assert.equal(knocked[1]!.sleeping, false);
  assert.deepEqual(applyImpulse(start, { seq: 2, source: 'DOOR_POUND', strength: 0 }), start);
  assert.deepEqual(applyImpulse(start, { seq: 2, source: 'DOOR_POUND', strength: Number.NaN }), start);
});

test('only known sanitized events become impulses', () => {
  const impulses = impulsesFromEvents([
    { seq: 1, type: 'SCARE', detail: 'impact' },
    { seq: 2, type: 'SCARE', detail: 'breach' },
    { seq: 3, type: 'ATTACK_COMMITTED', detail: '' },
    { seq: 4, type: 'MONSTER_STEP', detail: 'from=3 to=1 step=-2' },
    { seq: 5, type: 'MONSTER_STEP', detail: 'from=8 to=5 step=-3' },
    { seq: 6, type: 'MONSTER_STEP', detail: 'to=0' },
    { seq: 7, type: 'WRONG_INPUT', detail: 'WIRE' },
    { seq: 8, type: 'SCARE', detail: '' },
  ]);
  assert.deepEqual(impulses.map(i => [i.seq, i.source]), [[1, 'DOOR_POUND'], [2, 'BREACH'], [3, 'DOOR_POUND'], [4, 'FOOTSTEPS']]);
  assert.ok(Math.abs(impulses[3]!.strength - 0.4) < 1e-9);
});

test('corrupt stored bodies are reset or clamped back into the room', () => {
  const [mug] = spawnBodies();
  assert.deepEqual(sanitizeBody({ ...mug!, x: Number.NaN, sleeping: false }), mug);
  const clamped = sanitizeBody({ ...mug!, x: 40, y: -3, rest: 900 });
  assert.equal(clamped.x, ROOM.max[0] - PROPS[0]!.radius);
  assert.equal(clamped.y, PROPS[0]!.radius);
  assert.equal(clamped.rest, 255);
  assert.throws(() => sanitizeBody({ ...mug!, slot: 99 }));
});
