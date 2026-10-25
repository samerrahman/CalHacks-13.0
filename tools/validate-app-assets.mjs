// Checks the assets the playable application actually serves. No network calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnimationMixer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const root = fileURLToPath(new URL('../', import.meta.url)), assetRoot = path.join(root, 'public/assets');
const manifest = JSON.parse(await readFile(path.join(assetRoot, 'manifest.json'), 'utf8'));
const inventoried = new Set();
for (const entry of manifest.assets) {
  assert.ok(typeof entry.path === 'string' && entry.path.startsWith('public/assets/'), 'Asset path must stay in public/assets');
  const absolute = path.resolve(root, entry.path);
  assert.ok(absolute.startsWith(`${assetRoot}${path.sep}`), 'No escaping paths');
  assert.equal(await realpath(absolute), absolute, 'No symlink assets');
  assert.ok(!inventoried.has(entry.path), 'No duplicate inventory entries'); inventoried.add(entry.path);
  const bytes = await readFile(absolute);
  assert.equal(bytes.length, entry.bytes, `${entry.path} bytes`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${entry.path} hash`);
  assert.equal(entry.url, entry.path.replace(/^public/, ''), `${entry.path} served URL`);
  assert.ok(entry.license && entry.source, `${entry.path} provenance`);
}
async function files(directory, extension) { return (await readdir(path.join(assetRoot, directory))).filter(name => name.endsWith(extension)).sort(); }
async function checkInventory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), 'No asset symlinks');
    if (entry.isDirectory()) await checkInventory(absolute);
    else if (absolute !== path.join(assetRoot, 'manifest.json')) assert.ok(inventoried.has(path.relative(root, absolute)), `Unlisted asset: ${absolute}`);
  }
}
await checkInventory(assetRoot);
const models = await files('models', '.glb'), audio = await files('audio', '.wav'), cameras = await files('cameras', '.png'), decals = await files('decals', '.svg'), videos = await files('video', '.mp4');
assert.equal(models.length, 10); assert.equal(audio.length, 44); assert.equal(cameras.length, 4); assert.equal(decals.length, 7); assert.deepEqual(videos, ['ending.mp4', 'opening.mp4']);
assert.deepEqual(manifest.counts, { models: 10, audio: 44, cctvBackgrounds: 4, decals: 7, openingVideo: 1, endingVideo: 1 });
// Opening and ending cutscenes: ISO-BMFF (MP4) files rendered by tools/cutscene.mjs. Their source lives in cutscene/ and src/cutscene/.
const film = await readFile(path.join(assetRoot, 'video', 'opening.mp4')), ending = await readFile(path.join(assetRoot, 'video', 'ending.mp4'));
assert.equal(film.subarray(4, 8).toString('latin1'), 'ftyp', 'opening.mp4 is an MP4 container');
assert.equal(ending.subarray(4, 8).toString('latin1'), 'ftyp', 'ending.mp4 is an MP4 container');
let meshCount = 0, clipCount = 0;
for (const file of models) {
  const bytes = await readFile(path.join(assetRoot, 'models', file));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const nodes = [], geometries = new Set(), materials = new Set();
  gltf.scene.traverse(node => {
    nodes.push(node); if (!node.isMesh) return; meshCount++;
    for (const attribute of ['position', 'normal', 'uv']) {
      const data = node.geometry.getAttribute(attribute); assert.ok(data, `${file}: ${attribute}`);
      assert.ok(data.array.every(Number.isFinite), `${file}: finite ${attribute}`);
    }
    geometries.add(node.geometry); for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
  });
  assert.ok(geometries.size, `${file}: geometry`);
  const snapshot = () => JSON.stringify(nodes.map(node => [node.position.toArray(), node.quaternion.toArray(), node.scale.toArray()]));
  const mixer = new AnimationMixer(gltf.scene);
  for (const clip of gltf.animations) {
    const before = snapshot(); mixer.clipAction(clip).play(); mixer.update(.17);
    assert.notEqual(snapshot(), before, `${file}.${clip.name}: animation must move an authored node`);
    mixer.stopAllAction(); clipCount++;
  }
  mixer.uncacheRoot(gltf.scene); for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose();
}
assert.equal(clipCount, 11);
const audioManifest = JSON.parse(await readFile(path.join(assetRoot, 'audio/audio-manifest.json'), 'utf8'));
let maximumPeak = 0, loopBeds = 0;
for (const file of audio) {
  const bytes = await readFile(path.join(assetRoot, 'audio', file));
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  let format = null, data = null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), begin = offset + 8;
    assert.ok(begin + length <= bytes.length, `${file}: chunk bounds`);
    if (type === 'fmt ') format = bytes.subarray(begin, begin + length);
    if (type === 'data') data = bytes.subarray(begin, begin + length);
    offset = begin + length + length % 2;
  }
  assert.ok(format && data && data.length > 0 && data.length % 2 === 0, `${file}: PCM data`);
  assert.equal(format.readUInt16LE(0), 1); assert.equal(format.readUInt16LE(2), 1); assert.equal(format.readUInt32LE(4), 22050); assert.equal(format.readUInt16LE(14), 16);
  let peak = 0; for (let offset = 0; offset < data.length; offset += 2) peak = Math.max(peak, Math.abs(data.readInt16LE(offset)) / 32768);
  assert.ok(peak > 0 && peak <= .7, `${file}: bounded, nonempty waveform`); maximumPeak = Math.max(maximumPeak, peak);
  const record = audioManifest.assets.find(item => item.file === `audio/${file}`); assert.ok(record, `${file}: metadata`);
  assert.ok(Math.abs(data.length / 44100 - record.durationSeconds) < .0001, `${file}: duration`);
  assert.ok(Math.abs(peak - record.peakLinear) < .000001, `${file}: peak metadata`);
  if (record.loop) { loopBeds++; assert.ok(Math.abs(data.readInt16LE(0) - data.readInt16LE(data.length - 2)) / 32768 < .03, `${file}: loop boundary`); }
}
assert.equal(loopBeds, 6);
for (const file of cameras) {
  const bytes = await readFile(path.join(assetRoot, 'cameras', file));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file}: PNG signature`);
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR'); assert.ok(bytes.readUInt32BE(16) >= 1280 && bytes.readUInt32BE(20) >= 720, `${file}: resolution`);
}
for (const file of decals) { const source = await readFile(path.join(assetRoot, 'decals', file), 'utf8'); assert.match(source, /<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/); assert.doesNotMatch(source, /<script|<foreignObject|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["']https?:/i); }
console.log(JSON.stringify({ passed: true, filesHashed: inventoried.size, models: models.length, meshes: meshCount, animationClips: clipCount, wavFiles: audio.length, loopBeds, maximumPeak, cctvBackgrounds: cameras.length, svgDecals: decals.length, openingVideoBytes: film.length, endingVideoBytes: ending.length }, null, 2));
