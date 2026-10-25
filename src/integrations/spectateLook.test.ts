import test from 'node:test';
import assert from 'node:assert/strict';
import { SpringLook } from '../spectate/look';

test('CCTV stays within its mount limits and holds the drag until released', () => {
  const look = new SpringLook(); look.begin(); look.drag(100, -100);
  assert.equal(look.yaw, -Math.PI / 3); assert.equal(look.pitch, Math.PI / 6);
  look.step(1); assert.equal(look.yaw, -Math.PI / 3);
  look.release(); let previous = Math.abs(look.yaw);
  for (let n = 0; n < 120; n++) {
    look.step(1 / 60); assert.ok(Math.abs(look.yaw) <= previous); previous = Math.abs(look.yaw);
  }
  assert.equal(look.yaw, 0); assert.equal(look.pitch, 0);
});

test('CCTV return is independent of frame rate and reduced motion returns immediately', () => {
  const a = new SpringLook(), b = new SpringLook();
  for (const look of [a, b]) { look.begin(); look.drag(.4, .2); look.release(); }
  a.step(.2); for (let n = 0; n < 12; n++) b.step(1 / 60);
  assert.ok(Math.abs(a.yaw - b.yaw) < 1e-10);
  a.step(.01, true); assert.equal(a.yaw, 0); assert.equal(a.pitch, 0);
  b.begin(); b.drag(NaN, 1); assert.ok(Number.isFinite(b.yaw));
  b.reset(); assert.equal(b.yaw, 0);
});
