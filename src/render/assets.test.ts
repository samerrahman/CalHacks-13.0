import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AnimationMixer, LoopOnce } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL_NAMES, disposeObject } from './assets';

async function model(name: string) {
  const bytes = await readFile(new URL(`../../public/assets/models/${name}.glb`, import.meta.url));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new GLTFLoader().parseAsync(data, '');
}

test('all eight actual GLB assets parse into nonempty Three.js scenes', async () => {
  for (const name of MODEL_NAMES) {
    const asset = await model(name);
    assert.ok(asset.scene.children.length > 0, name);
    disposeObject(asset.scene);
  }
});

test('shutter animation moves only the leaf; root remains at its doorway', async () => {
  const asset = await model('shutter'); asset.scene.position.x = -4;
  const mixer = new AnimationMixer(asset.scene);
  const clip = asset.animations.find(item => item.name === 'open')!;
  assert.ok(clip);
  const action = mixer.clipAction(clip); action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
  const leaf = asset.scene.getObjectByName('shutter_leaf')!;
  const original = leaf.position.y;
  mixer.update(.4);
  assert.ok(leaf.position.y > original + 1.3);
  assert.equal(asset.scene.position.x, -4);
  assert.equal(asset.scene.position.y, 0);
  mixer.update(.4);
  assert.ok(Math.abs(leaf.position.y - 4.15) < .001);
  mixer.stopAllAction(); mixer.uncacheRoot(asset.scene); disposeObject(asset.scene);
});

test('idle, listen and reach clips each visibly change their authored mimic nodes', async () => {
  for (const [name, nodeName, component] of [
    ['idle', 'torso', 'position'], ['listen', 'head', 'quaternion'], ['reach', 'shoulder_-1', 'quaternion'],
  ] as const) {
    const asset = await model('mimic'), mixer = new AnimationMixer(asset.scene);
    const clip = asset.animations.find(item => item.name === name)!;
    assert.ok(clip, name);
    const node = asset.scene.getObjectByName(nodeName)!;
    const before = node[component].toArray();
    mixer.clipAction(clip).play(); mixer.update(.4);
    assert.notDeepEqual(node[component].toArray(), before, `${name} changes ${nodeName}`);
    mixer.stopAllAction(); mixer.uncacheRoot(asset.scene); disposeObject(asset.scene);
  }
});

test('paused shutter clip scrubs correctly at the render loop endpoints', async () => {
  const asset = await model('shutter');
  const mixer = new AnimationMixer(asset.scene), action = mixer.clipAction(asset.animations[0]!);
  action.play(); action.paused = true;
  const leaf = asset.scene.getObjectByName('shutter_leaf')!;
  action.time = .79999; mixer.update(0);
  assert.ok(Math.abs(leaf.position.y - 4.15) < .001, 'open leaf clears the 2.7m doorway');
  action.time = 0; mixer.update(0);
  assert.ok(Math.abs(leaf.position.y - 1.35) < .001, 'closed leaf rests on the floor');
  mixer.stopAllAction(); mixer.uncacheRoot(asset.scene); disposeObject(asset.scene);
});
