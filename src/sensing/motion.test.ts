import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_HEIGHT, GRID_WIDTH, MotionMeter, lumaFromRgba } from './motion';

const SIZE = GRID_WIDTH * GRID_HEIGHT;
/** A dark room with a bright face-sized block at column `x`, plus seeded sensor noise. */
function frame(x: number, brightness = 0, seed = 1): Uint8Array {
  const out = new Uint8Array(SIZE);
  let s = seed;
  for (let i = 0; i < SIZE; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    const col = i % GRID_WIDTH, row = Math.floor(i / GRID_WIDTH);
    const face = col >= x && col < x + 8 && row >= 6 && row < 18;
    out[i] = Math.max(0, Math.min(255, (face ? 170 : 40) + brightness + (s % 7) - 3));
  }
  return out;
}

test('a still scene with sensor noise reads as still and accumulates still time', () => {
  const meter = new MotionMeter();
  assert.equal(meter.push(frame(10, 0, 1), 0).ready, false);
  let reading = meter.push(frame(10, 0, 2), 100);
  for (let t = 200; t <= 3000; t += 100) reading = meter.push(frame(10, 0, t), t);
  assert.equal(reading.still, true);
  assert.ok(reading.energy < 0.05, `energy ${reading.energy}`);
  assert.ok(reading.stillForMs >= 2800);
});

test('moving a face across the frame breaks stillness', () => {
  const meter = new MotionMeter();
  for (let t = 0; t <= 1000; t += 100) meter.push(frame(10, 0, t), t);
  let reading = meter.push(frame(10, 0, 5), 1100);
  assert.equal(reading.still, true);
  for (let t = 1200, x = 12; t <= 1800; t += 100, x += 2) reading = meter.push(frame(x % 24, 0, t), t);
  assert.equal(reading.still, false);
  assert.equal(reading.stillForMs, 0);
  assert.ok(reading.energy > 0.16, `energy ${reading.energy}`);
});

test('a whole-frame exposure change alone does not count as motion', () => {
  const meter = new MotionMeter();
  for (let t = 0; t <= 1000; t += 100) meter.push(frame(10, 0, t), t);
  const reading = meter.push(frame(10, 45, 99), 1100);
  assert.equal(reading.still, true);
  assert.ok(reading.energy < 0.08);
});

test('frames must be the fixed grid size and luma conversion matches Rec. 601', () => {
  assert.throws(() => new MotionMeter().push(new Uint8Array(10), 0));
  const rgba = new Uint8ClampedArray(SIZE * 4).fill(255);
  rgba[0] = 255; rgba[1] = 0; rgba[2] = 0;
  const luma = lumaFromRgba(rgba);
  assert.equal(luma[0], 76);
  assert.equal(luma[1], 255);
  assert.throws(() => lumaFromRgba(new Uint8ClampedArray(8)));
});
