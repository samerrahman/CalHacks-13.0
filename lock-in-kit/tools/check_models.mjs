// Actual Three.js parse/animation checks; run after npm ci inside this kit.
// This is an asset check, not a game, renderer screenshot, or provider test.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { AnimationMixer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const directory = new URL('../assets/models/', import.meta.url);
const files = (await readdir(directory)).filter(file => file.endsWith('.glb')).sort();
assert.equal(files.length, 10, 'Expected all ten documented GLB models');
const results = [];
for (const file of files) {
  const bytes = await readFile(new URL(file, directory));
  const array = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().parseAsync(array, '');
  const nodes = [], meshes = [];
  gltf.scene.traverse(node => {
    nodes.push(node);
    if (node.isMesh) {
      assert.ok(node.geometry.getAttribute('position'), `${file}: position data`);
      assert.ok(node.geometry.getAttribute('normal'), `${file}: normal data`);
      assert.ok(node.geometry.getAttribute('uv'), `${file}: usable texture UVs`);
      meshes.push(node);
    }
  });
  assert.ok(meshes.length, `${file}: nonempty geometry`);
  for (const clip of gltf.animations) {
    const snapshot = () => JSON.stringify(nodes.map(node => [node.position.toArray(), node.quaternion.toArray(), node.scale.toArray()]));
    const before = snapshot(), mixer = new AnimationMixer(gltf.scene);
    mixer.clipAction(clip).play(); mixer.update(.17);
    assert.notEqual(snapshot(), before, `${file}: ${clip.name} changes its authored nodes`);
    mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
  }
  const geometries = new Set(), materials = new Set();
  for (const mesh of meshes) {
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  results.push({ file, meshes: meshes.length, clips: gltf.animations.map(clip => clip.name) });
}
console.log(JSON.stringify({ passed: true, models: results.length,
  animationClips: results.reduce((count, result) => count + result.clips.length, 0), results }, null, 2));
