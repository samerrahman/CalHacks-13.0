import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Scene, Vector3 } from 'three';
import { hitStation } from './interaction';
import { alarmIntensity, scareStrength } from './presentation';
import { drawCameraOverlay, drawProximity, type Display, drawTerminal } from './displays';
import type { RenderState } from './state';
import { disposeObject } from './assets';

test('equipment clicks respect the first visible physical surface and its model ancestor', () => {
  const scene = new Scene(), equipment = new Group(), occluder = new Group(); equipment.userData.hushStation = 'terminal';
  const makeBox = (z: number) => { const mesh = new Mesh(new BoxGeometry(1, 1, .2), new MeshBasicMaterial()); mesh.position.z = z; return mesh; };
  equipment.add(makeBox(-5)); occluder.add(makeBox(-2)); scene.add(equipment, occluder); scene.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(), new Vector3(0, 0, -1));
  assert.equal(hitStation(ray, scene), null, 'a wall in front blocks the terminal');
  occluder.visible = false; assert.equal(hitStation(ray, scene), 'terminal', 'hidden ancestors cannot occlude');
  equipment.userData.hushStation = 'cameras'; assert.equal(hitStation(ray, scene), 'cameras');
  equipment.visible = false; assert.equal(hitStation(ray, scene), null, 'hidden equipment is not interactive');
  disposeObject(scene);
});

test('red alarm illumination is bounded, gradual and static under reduced motion', () => {
  assert.equal(alarmIntensity(1, { active: false, urgency: 1 }), 0);
  let previous = alarmIntensity(0, { active: true, urgency: 1 });
  for (let time = .01; time <= 10; time += .01) {
    const value = alarmIntensity(time, { active: true, urgency: 10 });
    assert.ok(value >= 0 && value <= 1); assert.ok(Math.abs(value - previous) < .01, 'no abrupt full-screen flashing envelope'); previous = value;
  }
  assert.equal(alarmIntensity(0, { active: true, urgency: .8 }, true), alarmIntensity(42, { active: true, urgency: .8 }, true));
});

test('visual scares require a current authoritative event and respect comfort settings', () => {
  const event = { id: 7, at: 10, kind: 'monitor' as const };
  assert.equal(scareStrength(9.9, event), 0); assert.equal(scareStrength(10, null), 0); assert.equal(scareStrength(11, event), 0);
  assert.ok(scareStrength(10.1, event, false, true) < scareStrength(10.1, event));
  assert.ok(scareStrength(10.1, event, true) < scareStrength(10.1, event));
  assert.equal(scareStrength(NaN, event), 0);
});

test('physical displays expose no breach warning or countdown text', () => {
  const lines: string[] = [], arcs: number[][] = [], noop = () => {};
  const context = { fillRect: noop, clearRect: noop, beginPath: noop, stroke: noop, fill: noop, arc(x: number, y: number, r: number) { arcs.push([x, y, r]); }, fillText(text: string) { lines.push(text); }, createRadialGradient() { return { addColorStop: noop }; } };
  const display = { context, texture: { needsUpdate: false } } as unknown as Display;
  const state: RenderState = { time: 10, power: 'on', stage: 1, faults: [], creature: { position: [0, 0, -3], distance: 3, sensorDistance: 8, sensorSampleAt: 8, sensorBearing: Math.PI / 2, phase: 'breach' }, warningRemaining: 1.25, alarm: { active: true, urgency: 1 }, cameraFeed: 'C' };
  drawProximity(display, state); drawCameraOverlay(display, state);
  assert.ok(!lines.some(line => /\d+\s*$/.test(line) && !/SECONDS/.test(line)), 'the radar never prints a range number');
  const contact = arcs.find(([, , r]) => r === 9)!; assert.ok(contact, 'the sampled contact is drawn');
  assert.ok(Math.abs(contact[0] - (256 + 8 / 24 * 150)) < 1e-6 && Math.abs(contact[1] - 205) < 1e-6, 'it sits at the sampled range and bearing, not the hidden current position');
  assert.doesNotMatch(lines.join(' '), /breach|warning|countdown|1\.25/i);
  for (const power of ['blackout', 'quiet'] as const) {
    lines.length = 0; drawProximity(display, { ...state, power }); assert.deepEqual(lines, [], 'unpowered detector is completely dark');
  }
});

test('the in-room terminal mirrors the live task step instead of a stale fault board', () => {
  const lines: string[] = [], noop = () => {};
  const context = { fillRect: noop, strokeRect: noop, clearRect: noop, beginPath: noop, arc: noop, fill: noop, stroke: noop, fillText(text: string) { lines.push(text); }, createRadialGradient() { return { addColorStop: noop }; } };
  const display = { context, texture: { needsUpdate: false } } as unknown as Display;
  const base: RenderState = { time: 10, power: 'on', stage: 1, faults: [], faultsResolved: 20, faultsRequired: 20, creature: { position: [0, 0, -12], distance: 12, phase: 'search' } };
  for (const [step, title, progress] of [['wires', 'PATCH THE RELAY', '7 / 10 CABLES LINKED'], ['routing', 'ROUTE POWER QUIETLY', '1 / 3 CIRCUITS ENGAGED'], ['locate', 'MARK ITS POSITION', '2 / 4 POSITIONS MARKED'], ['pulse', 'MASK YOUR HEARTBEAT', '3 / 8 BEATS IN RHYTHM'], ['calm', 'LET IT LOSE YOUR TRAIL', '5 / 12 CALM SECONDS']] as const) {
    lines.length = 0; const [done, total] = progress.split(' / ').map(part => Number.parseInt(part, 10));
    drawTerminal(display, { ...base, step, progress: [done, total], pulseFlash: .5, breath: .5 });
    assert.ok(lines.includes(title), step); assert.ok(lines.includes(progress), step); assert.ok(!lines.some(line => line.includes('FAULTS RESOLVED')), step);
  }
  lines.length = 0; drawTerminal(display, { ...base, step: 'faults' }); assert.ok(lines.includes('20 / 20 FAULTS RESOLVED'), 'fault steps keep the fault board');
});
