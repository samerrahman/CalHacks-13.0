import assert from 'node:assert/strict';
import test from 'node:test';
import { projectCreature, type CameraFeed, type WorldPosition } from './cctv';

test('CCTV projects the actual graph position onto the corresponding authored feed anchors', () => {
  const cases: [CameraFeed, WorldPosition, number, number][] = [
    ['A', [0, 0, -12], .79, .71], ['A', [0, 0, -19], .53, .58], ['A', [0, 0, -26], .37, .52],
    ['B', [7, 0, -36], .56, .59], ['C', [14, 0, -54], .58, .57], ['C', [14, 0, -62], .59, .34],
  ];
  for (const [feed, position, x, y] of cases) { const projection = projectCreature(feed, position)!; assert.ok(projection); assert.equal(projection.x, x); assert.equal(projection.y, y); }
});
test('shelter positions and positions on another camera branch never create a silhouette', () => {
  for (const feed of ['A', 'B', 'C'] as const) for (const position of [[0, 0, 0], [-3.1, 0, 0], [0, 0, -7]] as WorldPosition[]) assert.equal(projectCreature(feed, position), null);
  assert.equal(projectCreature('A', [7, 0, -36]), null); assert.equal(projectCreature('B', [-8, 0, -30]), null); assert.equal(projectCreature('C', [0, 0, -26]), null);
});
test('out-of-segment, invalid, above-ground and sealed positions remain hidden', () => {
  for (const position of [[14, 0, -70], [14, 0, -43], [NaN, 0, -54], [14, 1, -54], [15, 0, -54]] as WorldPosition[]) assert.equal(projectCreature('C', position), null);
  assert.equal(projectCreature('C', [14, 0, -62], true), null);
});
test('a camera projection is reversible and continuous across the middle art anchor', () => {
  const before = projectCreature('C', [14, 0, -53.999])!, after = projectCreature('C', [14, 0, -54.001])!;
  assert.ok(Math.abs(before.x - after.x) < .001 && Math.abs(before.y - after.y) < .001);
  const near = projectCreature('C', [14, 0, -47])!, far = projectCreature('C', [14, 0, -61])!;
  assert.ok(near.scale > far.scale); assert.ok(near.y > far.y);
  assert.deepEqual(projectCreature('C', [14, 0, -47]), near, 'projection has no independent encounter clock');
});
