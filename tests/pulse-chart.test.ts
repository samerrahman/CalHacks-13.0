import assert from 'node:assert/strict';
import test from 'node:test';
import { continuousLine, measuredSegment, monotonePath, partialPath, timeTicks, valueAxis } from '../src/ui/pulseChart';

test('the pulse line runs from the start of the run to its end, bridging gaps', () => {
  const line = continuousLine([{ gameMs: 18_000, value: 81 }, { gameMs: 19_000, value: 80 }, { gameMs: 40_000, value: 75 }], 70_000, 73);
  assert.deepEqual(line.map(p => [p.t, p.v, p.measured]), [[0, 73, false], [18_000, 81, true], [19_000, 80, true], [40_000, 75, true], [70_000, 75, false]]);
  assert.equal(measuredSegment(line, 0), false, 'lead-in from the baseline is bridged');
  assert.equal(measuredSegment(line, 1), true, 'consecutive readings are measured');
  assert.equal(measuredSegment(line, 2), false, 'a 21-second gap is bridged');
  assert.equal(measuredSegment(line, 3), false, 'the hold to the end is bridged');
  assert.deepEqual(continuousLine([{ gameMs: 5_000, value: 70 }], 10_000, null).map(p => p.v), [70, 70, 70], 'without a baseline the first reading leads');
  assert.deepEqual(continuousLine([], 10_000, 72), []);
});

test('curves pass through every point without overshooting, and pieces lie on the whole curve', () => {
  const points = [{ x: 0, y: 50 }, { x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 60 }];
  const whole = monotonePath(points);
  assert.match(whole, /^M0\.0,50\.0 C/);
  for (const p of points) assert.ok(whole.includes(`${p.x.toFixed(1)},${p.y.toFixed(1)}`));
  const ys = [...whole.matchAll(/-?\d+\.\d,(-?\d+\.\d)/g)].map(m => Number(m[1]));
  assert.ok(ys.every(y => y >= 10 - 1e-9 && y <= 60 + 1e-9), 'control points stay within the data range');
  const piece = partialPath(points, i => i === 1);
  assert.ok(whole.includes(piece.replace(/^M10\.0,10\.0 /, '')), 'the measured piece is a segment of the whole curve');
});

test('axes are tidy', () => {
  assert.deepEqual(valueAxis([73, 81], 3, 5), { min: 70, max: 85, ticks: [70, 75, 80, 85] });
  assert.deepEqual(timeTicks(45_000).map(t => t.label), ['0:00', '0:10', '0:20', '0:30', '0:40']);
  assert.deepEqual(timeTicks(70_000).map(t => t.label), ['0:00', '0:30', '1:00']);
  assert.deepEqual(timeTicks(196_000).map(t => t.label), ['0:00', '1:00', '2:00', '3:00']);
});
