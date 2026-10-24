// Browser side of the offline cutscene tool (tools/cutscene.mjs) and a real-time preview
// at /cutscene/index.html?preview. Not part of the game bundle.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { PROPS, PROP_NAMES, type PropName } from './props';
import { LOOKS, type Look } from './look';
import { createCutscene, type Cutscene } from './scene';
import { CUTSCENE, captionAt } from './timeline';

const loader = new GLTFLoader();
const glbs = new Map<string, Promise<THREE.Group>>();
function glb(url: string): Promise<THREE.Group> {
  let pending = glbs.get(url);
  if (!pending) {
    // glTF stores no shadow flags: everything receives, and everything opaque casts.
    pending = loader.loadAsync(url).then(g => {
      g.scene.traverse(o => { if (o instanceof THREE.Mesh) { o.receiveShadow = true; o.castShadow = !(o.material as THREE.Material).transparent; } });
      return g.scene;
    });
    glbs.set(url, pending);
  }
  // SkeletonUtils.clone keeps a rigged replacement's skin bound to its own bones.
  return pending.then(g => cloneSkinned(g) as THREE.Group);
}

function makeRenderer(width: number, height: number): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.replaceChildren(renderer.domElement);
  return renderer;
}

function gpuName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
}

let cutscene: Cutscene | null = null, renderer: THREE.WebGLRenderer | null = null;

/** Where a person standing in or near each prop would look from, for the "player view" tile. */
const VIEWPOINTS: Partial<Record<PropName, { from: [number, number, number]; to: [number, number, number] }>> = {
  lab_room: { from: [0, 1.65, 1.4], to: [0, 1.4, -4] },
  containment_tank: { from: [0, 1.65, 3.9], to: [0, 1.4, 0] },
  claws: { from: [0.15, 0.1, 1.2], to: [0, 0, 0.2] },
  shadow_figure: { from: [0, 1.6, 8], to: [0, 1.4, 0] },
  lab_corridor: { from: [0, 1.62, 0.6], to: [0, 1.4, 12] },
  exit_door: { from: [0, 1.62, -3.5], to: [0, 1.2, 0] },
  forest_ground: { from: [0, 1.62, 1], to: [0, 1.2, 20] },
  shelter_exterior: { from: [0.4, 1.62, -6], to: [0, 1.3, 0] },
  fp_arms: { from: [0, 0, 0], to: [0, -0.1, -1] },
};

async function propSheet(name: PropName, procedural = true): Promise<string> {
  const tileW = 800, tileH = 600;
  const r = makeRenderer(tileW, tileH);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3a3f44);
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x2a2622, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(5, 9, 7); sun.castShadow = true; scene.add(sun);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 1); rim.position.set(-6, 4, -8); scene.add(rim);
  const obj = procedural ? PROPS[name].build() : await glb(`/cutscene/models/${name}.glb`);
  scene.add(obj);
  const bounds = new THREE.Box3().setFromObject(obj), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const grid = new THREE.GridHelper(Math.max(4, Math.ceil(Math.max(size.x, size.z) * 1.4)), Math.max(4, Math.ceil(Math.max(size.x, size.z) * 1.4)), 0x707070, 0x505050);
  grid.position.y = bounds.min.y; scene.add(grid);
  const radius = Math.max(0.3, size.length() / 2);
  const camera = new THREE.PerspectiveCamera(40, tileW / tileH, 0.01, 500);
  const sheet = document.createElement('canvas'); sheet.width = tileW * 2; sheet.height = tileH * 2;
  const ctx = sheet.getContext('2d')!;
  const tiles: { label: string; place: () => void }[] = [
    { label: 'front (+Z)', place: () => { camera.position.copy(center).add(new THREE.Vector3(0, radius * 0.25, radius * 2.6)); camera.lookAt(center); } },
    { label: 'three-quarter', place: () => { camera.position.copy(center).add(new THREE.Vector3(radius * 1.9, radius * 1.1, radius * 1.9)); camera.lookAt(center); } },
    { label: 'side (+X)', place: () => { camera.position.copy(center).add(new THREE.Vector3(radius * 2.6, radius * 0.25, 0)); camera.lookAt(center); } },
    { label: VIEWPOINTS[name] ? 'player view' : 'back (−Z)', place: () => {
      const v = VIEWPOINTS[name];
      if (v) { camera.position.set(...v.from); camera.lookAt(new THREE.Vector3(...v.to)); camera.fov = 68; }
      else { camera.position.copy(center).add(new THREE.Vector3(-radius * 1.2, radius * 0.6, -radius * 2.3)); camera.lookAt(center); }
      camera.updateProjectionMatrix();
    } },
  ];
  tiles.forEach((tile, i) => {
    camera.fov = 40; tile.place(); camera.updateProjectionMatrix();
    r.render(scene, camera);
    const x = (i % 2) * tileW, y = Math.floor(i / 2) * tileH;
    ctx.drawImage(r.domElement, x, y);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x, y, tileW, 26);
    ctx.fillStyle = '#e8e8e8'; ctx.font = '15px monospace';
    ctx.fillText(`${name} · ${tile.label} · ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)} m`, x + 8, y + 18);
  });
  let triangles = 0;
  obj.traverse(o => { if (o instanceof THREE.Mesh) triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3; });
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, sheet.height - 26, sheet.width, 26);
  ctx.fillStyle = '#e8e8e8'; ctx.fillText(`${Math.round(triangles)} triangles · origin marked by grid · ${procedural ? 'procedural builder' : 'GLB'}`, 8, sheet.height - 8);
  r.dispose();
  return sheet.toDataURL('image/png');
}

async function exportGlb(name: PropName): Promise<string> {
  // onlyVisible: false keeps nodes that start hidden (cracked glass, shards). glTF has no
  // visibility flag, so the scene sets every animated node's visibility itself.
  const buffer = await new GLTFExporter().parseAsync(PROPS[name].build(), { binary: true, onlyVisible: false }) as ArrayBuffer;
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function init(options: { procedural?: boolean; scale?: number; look?: Look } = {}): Promise<{ gpu: string; frames: number }> {
  const look = options.look ?? 'ironlung';
  if (!LOOKS.includes(look)) throw new Error(`unknown look ${look} (${LOOKS.join(', ')})`);
  const scale = options.scale ?? 1;
  renderer = makeRenderer(Math.round(CUTSCENE.width * scale), Math.round(CUTSCENE.height * scale));
  const prop = (name: PropName) => options.procedural ? Promise.resolve(PROPS[name].build()) : glb(`/cutscene/models/${name}.glb`);
  cutscene = await createCutscene(renderer, prop, look);
  return { gpu: gpuName(renderer), frames: Math.round(CUTSCENE.duration * CUTSCENE.renderFps) };
}

/** Frame `index` at the render rate (renderFps); the tool blends pairs down to fps for motion blur. */
function frame(index: number, type: 'image/jpeg' | 'image/png' = 'image/jpeg', quality = 0.93): string {
  if (!cutscene || !renderer) throw new Error('call init() first');
  cutscene.renderAt(index / CUTSCENE.renderFps);
  return renderer.domElement.toDataURL(type, quality);
}

function still(time: number): string {
  if (!cutscene || !renderer) throw new Error('call init() first');
  cutscene.renderAt(time);
  return renderer.domElement.toDataURL('image/png');
}

/** Indented node tree with pivot positions, for checking a prop against its contract. */
function propNodes(name: PropName): string {
  const lines: string[] = [];
  const walk = (o: THREE.Object3D, depth: number) => {
    const p = o.position, kind = o instanceof THREE.Mesh ? `mesh:${(o.material as THREE.Material).name}` : o.type;
    lines.push(`${'  '.repeat(depth)}${o.name || '(unnamed)'} [${kind}] at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})${o.visible ? '' : ' hidden'}`);
    o.children.forEach(c => walk(c, depth + 1));
  };
  walk(PROPS[name].build(), 0);
  return lines.join('\n');
}

declare global { interface Window { __cutscene: unknown } }
window.__cutscene = { init, frame, still, propSheet, propNodes, exportGlb, names: PROP_NAMES, timeline: CUTSCENE };

// Real-time preview for people: /cutscene/index.html?preview (add &procedural to skip GLBs,
// &look=flat for the original flat colours).
if (new URLSearchParams(location.search).has('preview')) {
  const params = new URLSearchParams(location.search);
  void init({ procedural: params.has('procedural'), scale: 0.6, look: (params.get('look') ?? undefined) as Look | undefined }).then(() => {
    const ui = document.createElement('div');
    ui.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:8px 12px;background:rgba(0,0,0,.6);display:flex;gap:12px;align-items:center';
    const slider = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: String(CUTSCENE.duration), step: '0.01', value: '0' });
    slider.style.flex = '1';
    const label = document.createElement('span'), caption = document.createElement('div');
    caption.style.cssText = 'position:fixed;left:0;right:0;bottom:56px;text-align:center;font:18px sans-serif;color:#eee;text-shadow:0 1px 3px #000';
    ui.append(label, slider); document.body.append(ui, caption);
    renderer!.domElement.style.cssText = 'width:100vw;height:100vh;object-fit:contain';
    let playing = true, time = 0, last = performance.now();
    slider.oninput = () => { time = Number(slider.value); };
    addEventListener('keydown', e => { if (e.code === 'Space') playing = !playing; });
    const tick = (now: number) => {
      if (playing) time = (time + (now - last) / 1000) % CUTSCENE.duration;
      last = now; slider.value = String(time); label.textContent = `${time.toFixed(2)}s ${playing ? '▶' : '❚❚'} (space)`;
      caption.textContent = captionAt(time)?.text ?? '';
      cutscene!.renderAt(time);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
