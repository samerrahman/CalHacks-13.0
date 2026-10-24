import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Scene, Vector3 } from 'three';
import { hitStation } from './interaction';
import { alarmIntensity, scareStrength } from './presentation';
import { drawCameraOverlay, drawProximity, type Display } from './displays';
import type { RenderState } from './state';
import { disposeObject } from './assets';

test('equipment clicks respect the first visible physical surface and its model ancestor', () => {
  const scene = new Scene(), equipment = new Group(), occluder = new Group(); equipment.userData.lockInStation = 'terminal';
  const makeBox = (z: number) => { const mesh = new Mesh(new BoxGeometry(1, 1, .2), new MeshBasicMaterial()); mesh.position.z = z; return mesh; };
  equipment.add(makeBox(-5)); occluder.add(makeBox(-2)); scene.add(equipment, occluder); scene.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(), new Vector3(0, 0, -1));
  assert.equal(hitStation(ray, scene), null, 'a wall in front blocks the terminal');
  occluder.visible = false; assert.equal(hitStation(ray, scene), 'terminal', 'hidden ancestors cannot occlude');
  equipment.userData.lockInStation = 'cameras'; assert.equal(hitStation(ray, scene), 'cameras');
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
  const lines: string[] = [], context = { fillRect() {}, clearRect() {}, fillText(text: string) { lines.push(text); }, createRadialGradient() { return { addColorStop() {} }; } };
  const display = { context, texture: { needsUpdate: false } } as unknown as Display;
  const state: RenderState = { time: 10, power: 'on', stage: 1, faults: [], creature: { position: [0, 0, -3], distance: 3, sensorDistance: 8, sensorSampleAt: 8, phase: 'breach' }, warningRemaining: 1.25, alarm: { active: true, urgency: 1 }, cameraFeed: 'C' };
  drawProximity(display, state); drawCameraOverlay(display, state);
  assert.ok(lines.includes('8'), 'the last sampled distance is displayed');
  assert.ok(!lines.includes('3'), 'the hidden current position is not leaked between samples');
  assert.doesNotMatch(lines.join(' '), /breach|warning|countdown|1\.25/i);
  for (const power of ['blackout', 'quiet'] as const) {
    lines.length = 0; drawProximity(display, { ...state, power }); assert.deepEqual(lines, [], 'unpowered detector is completely dark');
  }
});
