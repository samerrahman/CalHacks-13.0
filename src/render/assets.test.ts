import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AnimationMixer, LoopOnce, Mesh, Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL_NAMES, disposeObject } from './assets';

async function model(name: string) {
  const bytes = await readFile(new URL(`../../public/assets/models/${name}.glb`, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
}
const pose = (node: Object3D) => [...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()];
function cleanup(root: Object3D, mixer: AnimationMixer) { mixer.stopAllAction(); mixer.uncacheRoot(root); disposeObject(root); }

test('all ten actual GLBs have nonempty textured geometry, named displays and eleven usable clips', async () => {
  assert.equal(MODEL_NAMES.length, 10); let clips = 0;
  const screens: Record<string, string> = { terminal: 'terminal_screen', security_monitor: 'security_screen', proximity_detector: 'proximity_screen' };
  for (const name of MODEL_NAMES) {
    const asset = await model(name), nodes: Object3D[] = [], mixer = new AnimationMixer(asset.scene); let meshes = 0;
    asset.scene.traverse(node => {
      nodes.push(node); if (!(node instanceof Mesh)) return; meshes++;
      assert.ok(node.geometry.getAttribute('position'), name); assert.ok(node.geometry.getAttribute('normal'), name);
      assert.ok(node.geometry.getAttribute('uv'), `${name} supplies actual display/material UVs`);
      assert.ok(node.geometry.getAttribute('position').array.every(Number.isFinite), name);
    });
    assert.ok(meshes > 0, name); if (screens[name]) assert.ok(asset.scene.getObjectByName(screens[name]), name);
    for (const clip of asset.animations) {
      const before = nodes.map(pose); mixer.clipAction(clip).play(); mixer.update(.17);
      assert.notDeepEqual(nodes.map(pose), before, `${name}.${clip.name} changes its authored nodes`);
      mixer.stopAllAction(); clips++;
    }
    cleanup(asset.scene, mixer);
  }
  assert.equal(clips, 11);
});

test('door impact returns to rest and final dent never translates the sealed doorway root', async () => {
  const asset = await model('sealed_door'), mixer = new AnimationMixer(asset.scene);
  asset.scene.position.set(-1.75, 0, 2.39); asset.scene.rotation.y = Math.PI;
  const root = asset.scene.getObjectByName('sealed_door_root')!, panel = asset.scene.getObjectByName('dent_panel_1')!;
  const rootBefore = pose(root), wrapperBefore = pose(asset.scene), panelBefore = pose(panel);
  assert.deepEqual(asset.animations.map(clip => clip.name).sort(), ['dent', 'impact']);
  for (const name of ['impact', 'dent']) {
    const action = mixer.clipAction(asset.animations.find(clip => clip.name === name)!); action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.reset().play();
    mixer.update(.17); assert.notDeepEqual(pose(panel), panelBefore, name);
    assert.deepEqual(pose(root), rootBefore); assert.deepEqual(pose(asset.scene), wrapperBefore);
    mixer.update(1);
    if (name === 'impact') pose(panel).forEach((value, index) => assert.ok(Math.abs(value - panelBefore[index]!) < .000001));
    else assert.notDeepEqual(pose(panel), panelBefore, 'loss dent remains visible');
    mixer.stopAllAction();
  }
  cleanup(asset.scene, mixer);
});

test('each machine fault clip changes only its corresponding independent moving assembly', async () => {
  for (let unit = 1; unit <= 4; unit++) {
    const asset = await model('machine_rack'), mixer = new AnimationMixer(asset.scene);
    const assemblies = [1, 2, 3, 4].map(index => asset.scene.getObjectByName(`unit_0${index}_fault_assembly`)!);
    const before = assemblies.map(pose); mixer.clipAction(asset.animations.find(clip => clip.name === `fault_0${unit}`)!).play(); mixer.update(.17);
    assemblies.forEach((node, index) => index === unit - 1 ? assert.notDeepEqual(pose(node), before[index]) : assert.deepEqual(pose(node), before[index]));
    cleanup(asset.scene, mixer);
  }
});

test('paused emergency lever scrubbing reaches distinct power states without moving its fixed locator', async () => {
  const asset = await model('emergency_switch'), mixer = new AnimationMixer(asset.scene);
  const action = mixer.clipAction(asset.animations.find(clip => clip.name === 'flip_off')!); action.play(); action.paused = true;
  const lever = asset.scene.getObjectByName('switch_lever')!, locator = asset.scene.getObjectByName('emergency_locator')!, locatorBefore = pose(locator);
  action.time = 0; mixer.update(0); const on = pose(lever);
  action.time = .34999; mixer.update(0); assert.notDeepEqual(pose(lever), on);
  action.time = 0; mixer.update(0); assert.deepEqual(pose(lever), on); assert.deepEqual(pose(locator), locatorBefore);
  cleanup(asset.scene, mixer);
});
