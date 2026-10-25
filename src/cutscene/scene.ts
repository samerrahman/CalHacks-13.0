import * as THREE from 'three';
import type { PropName } from './props';
import { applyLook, createPost, type Look } from './look';
import { material, rng } from './style';
import { BEATS as B, STEP_RATE } from './timeline';

/** Loads a fresh instance of a cutscene prop (GLB from cutscene/models, or procedural). */
export type PropSource = (name: PropName) => Promise<THREE.Object3D>;

export type Cutscene = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderAt(time: number): void; dispose(): void };

/** First-person camera keyframe. yaw 0 looks toward −Z, 90 toward −X, 180 toward +Z.
 * `run` (0..1) drives footfalls; `breath` (0..1) the out-of-breath sway. */
export type CameraKey = { t: number; pos: [number, number, number]; yaw: number; pitch?: number; roll?: number; run?: number; breath?: number };
/** A jolt: `strength` shakes, `kick` shoves the camera back along its view (metres). */
export type Impact = { t: number; strength: number; kick?: number };

const smooth = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 0 before `a`, 1 after `b`, eased between. */
export const ramp = (t: number, a: number, b: number) => smooth(clamp01((t - a) / (b - a)));
/** Piecewise value track: [[time, value], …], eased between keys. */
export const track = (t: number, keys: [number, number][]) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * smooth((t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
  return keys[keys.length - 1][1];
};
/** Deterministic 0..1 noise per integer step (for flicker). */
export const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
export const pulse = (t: number, hz: number, sharpness = 3) => Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 2 * hz), sharpness);
const deg = THREE.MathUtils.degToRad;

function catmull(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

/** Deterministic first-person rig. Running is footfall-driven (`stepRate`, shared with the
 * footstep audio): a sharp dip and a pitch nod on every step, sway alternating per foot,
 * constant speed between keys, and a FOV pump. Impacts shake and shove the view. */
export class CameraRig {
  constructor(private keys: CameraKey[], private impacts: Impact[] = [], private stepRate: number = STEP_RATE) {}
  apply(camera: THREE.PerspectiveCamera, t: number): void {
    const k = this.keys, last = k.length - 1;
    let i = 0;
    while (i < last - 1 && t >= k[i + 1].t) i++;
    const a = k[Math.max(0, i - 1)], b = k[i], c = k[Math.min(last, i + 1)], d = k[Math.min(last, i + 2)];
    const u = c.t > b.t ? clamp01((t - b.t) / (c.t - b.t)) : 0;
    const run = (b.run ?? 0) + ((c.run ?? 0) - (b.run ?? 0)) * u, breath = (b.breath ?? 0) + ((c.breath ?? 0) - (b.breath ?? 0)) * u;
    const e = run > 0.5 ? u : smooth(u) * 0.5 + u * 0.5; // constant speed while running
    const pos = [0, 1, 2].map(j => catmull(a.pos[j], b.pos[j], c.pos[j], d.pos[j], e));
    const yaw = catmull(a.yaw, b.yaw, c.yaw, d.yaw, e), pitch = catmull(a.pitch ?? 0, b.pitch ?? 0, c.pitch ?? 0, d.pitch ?? 0, e);
    const roll = catmull(a.roll ?? 0, b.roll ?? 0, c.roll ?? 0, d.roll ?? 0, e);

    const phase = t * this.stepRate, step = phase - Math.floor(phase), side = Math.sin(Math.PI * phase);
    const bob = (Math.pow(Math.sin(Math.PI * step), 0.7) - 0.65) * 0.085 * run; // lowest exactly at each footfall
    const nod = Math.exp(-step * 9) * 2.2 * run, sway = side * 0.035 * run, stepRoll = side * 1.8 * run;
    const gasp = Math.sin(t * Math.PI * 2 * 1.05);
    let shakeYaw = 0, shakePitch = 0, shakeRoll = 0, kick = 0, drop = 0;
    for (const hit of this.impacts) {
      const dt = t - hit.t;
      if (dt < 0 || dt > 1.6) continue;
      const env = Math.exp(-dt * 6) * hit.strength;
      shakeYaw += (Math.sin(dt * 83) + Math.sin(dt * 47 + 2) * 0.6) * 2.4 * env;
      shakePitch += (Math.sin(dt * 61 + 1) + Math.sin(dt * 37) * 0.5) * 1.8 * env;
      shakeRoll += Math.sin(dt * 29 + 3) * 1.5 * env;
      drop += Math.sin(dt * 55) * 0.025 * env;
      kick += (hit.kick ?? 0) * (1 - Math.exp(-dt * 28)) * Math.exp(-dt * 2.2);
    }
    const yawR = deg(yaw), fx = -Math.sin(yawR), fz = -Math.cos(yawR), rx = Math.cos(yawR), rz = -Math.sin(yawR);
    camera.position.set(pos[0] + rx * sway - fx * kick, pos[1] + bob + gasp * 0.012 * breath + drop, pos[2] + rz * sway - fz * kick);
    camera.rotation.set(deg(pitch - nod + shakePitch + gasp * 1.1 * breath), deg(yaw + shakeYaw), deg(roll + stepRoll + shakeRoll), 'YXZ');
    camera.fov = 68 + 5 * run; camera.updateProjectionMatrix();
  }
}

// World layout: lab (z −4.5..4.5), corridor (4.5..16.5), exit door at 16.5, then a short
// forest route with two turns to the shed, whose door faces −Z at SHED.
const LAB_TANK = new THREE.Vector3(0, 0, -2.5);
const CORRIDOR_Z = 4.5, EXIT_Z = 16.5, GROUND_Z = 16.8;
const ROUTE: [number, number][] = [[0, 17.2], [0, 21.4], [2.2, 25.4], [5.2, 28.7], [6.6, 32.7], [6.0, 36.6], [6.0, 40.2]];
const SHED = new THREE.Vector3(6.0, 0, 41.6);

const find = (root: THREE.Object3D, name: string) => root.getObjectByName(name) ?? null;
/** Gives an object tree its own materials so animating one emissive doesn't touch other props. */
function own(o: THREE.Object3D | null): void {
  o?.traverse(m => { if (m instanceof THREE.Mesh) m.material = (m.material as THREE.Material).clone(); });
}
function glow(o: THREE.Object3D | null, intensity: number, color?: number): void {
  o?.traverse(m => {
    if (m instanceof THREE.Mesh && 'emissiveIntensity' in m.material) {
      const mat = m.material as THREE.MeshStandardMaterial; mat.emissiveIntensity = intensity; if (color !== undefined) mat.emissive.setHex(color);
    }
  });
}
const worldOf = (o: THREE.Object3D | null, fallback: THREE.Vector3) => o ? o.getWorldPosition(new THREE.Vector3()) : fallback.clone();

function puffTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export async function createCutscene(renderer: THREE.WebGLRenderer, prop: PropSource, look: Look = 'ironlung'): Promise<Cutscene> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080a);
  scene.fog = new THREE.FogExp2(0x05080a, 0.05);
  const fog = scene.fog as THREE.FogExp2, background = scene.background as THREE.Color;
  const camera = new THREE.PerspectiveCamera(68, renderer.domElement.width / renderer.domElement.height, 0.05, 200);
  scene.add(camera);

  // ---------- sets ----------
  const labSet = new THREE.Group(), corridorSet = new THREE.Group(), forestSet = new THREE.Group();
  scene.add(labSet, corridorSet, forestSet);
  const lab = await prop('lab_room'); labSet.add(lab); own(lab);
  const tank = await prop('containment_tank'); tank.position.copy(LAB_TANK); labSet.add(tank); own(tank);
  const claws = await prop('claws'); own(claws); claws.scale.setScalar(1.8); // claw_mount is placed for this scale
  (find(tank, 'claw_mount') ?? tank).add(claws);
  // A colleague with a clipboard checks the tube from its front-right: the one the hand takes.
  const colleague = await prop('researcher'); own(colleague); labSet.add(colleague);
  colleague.rotation.order = 'YXZ';
  const corridor = await prop('lab_corridor'); corridor.position.z = CORRIDOR_Z; corridorSet.add(corridor); own(corridor);
  const exit = await prop('exit_door'); exit.position.z = EXIT_Z; corridorSet.add(exit); own(exit);
  const ground = await prop('forest_ground'); ground.position.z = GROUND_Z; forestSet.add(ground);
  const shelter = await prop('shelter_exterior'); forestSet.add(shelter); own(shelter);
  const shadow = await prop('shadow_figure'); forestSet.add(shadow);
  const arms = await prop('fp_arms'); camera.add(arms); own(arms);
  // The viewmodel sits in front of the flashlight; it must never shadow its own beam.
  arms.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
  // Openings into darkness stay pure black under any light (no specular sheen), and the torch
  // body ignores lights so the beam, which starts inside it, can never flare on it.
  const unlitVoid = new THREE.MeshBasicMaterial({ color: 0x000000 }), unlitTorch = new THREE.MeshBasicMaterial({ color: 0x15191b });
  scene.traverse(o => { if (o instanceof THREE.Mesh && (o.material as THREE.Material).name === 'void') o.material = unlitVoid; });
  find(arms, 'flashlight')?.traverse(o => { if (o instanceof THREE.Mesh && o.name !== 'flashlight_lens') o.material = unlitTorch; });
  // The route below has its own path; the ground's straight path and its puddles, roots and twigs would float off it.
  for (const n of ['path', 'puddle_0', 'puddle_1', 'puddle_2', 'roots', 'twigs']) find(ground, n)?.traverse(o => { o.visible = false; });
  scene.updateMatrixWorld(true);

  // Terrain height under (x, z), so the route, the shed and every scattered prop sit on the ground.
  const terrain: THREE.Object3D[] = [];
  ground.traverse(o => { if (o instanceof THREE.Mesh && o.visible && !/puddle/.test(o.name)) terrain.push(o); });
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  const heightAt = (x: number, z: number) => { ray.set(new THREE.Vector3(x, 60, z), down); return ray.intersectObjects(terrain, false)[0]?.point.y ?? 0; };

  // The route: a smooth curve through ROUTE at ground height, sampled by distance.
  const routeCurve = new THREE.CatmullRomCurve3(ROUTE.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const routeLength = routeCurve.getLength();
  const routeAt = (s: number) => { const p = routeCurve.getPointAt(clamp01(s / routeLength)); p.y = heightAt(p.x, p.z); return p; };
  const routeHeading = (s: number) => { const d = routeCurve.getTangentAt(clamp01(s / routeLength)); return 180 + THREE.MathUtils.radToDeg(Math.atan2(d.x, d.z)); };
  const routeSamples = Array.from({ length: 80 }, (_, i) => routeAt(routeLength * i / 79));
  const distToRoute = (x: number, z: number) => Math.min(...routeSamples.map(p => Math.hypot(p.x - x, p.z - z)));
  // Sit the floor on the highest ground under the vestibule, so no terrain pokes into the black.
  const underVestibule = [-0.7, 0, 0.7].flatMap(dx => [0.05, 0.75, 1.45].map(dz => heightAt(SHED.x + dx, SHED.z + dz)));
  shelter.position.set(SHED.x, Math.max(heightAt(SHED.x, SHED.z - 0.3), ...underVestibule) + 0.02, SHED.z);
  scene.updateMatrixWorld(true);

  // Dirt path ribbon along the route.
  {
    const steps = 90, pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const p = routeAt(routeLength * i / steps), tan = routeCurve.getTangentAt(i / steps), nx = tan.z, nz = -tan.x, w = 0.7;
      for (const side of [-1, 1]) { const x = p.x + nx * w * side, z = p.z + nz * w * side; pos.push(x, heightAt(x, z) + 0.03, z); }
      if (i < steps) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geometry.setIndex(idx); geometry.computeVertexNormals();
    const path = new THREE.Mesh(geometry, material('dirt')); path.receiveShadow = true; forestSet.add(path);
  }

  // Seeded forest scatter off the route (the ground carries no trees).
  {
    const random = rng(2026), pines: PropName[] = ['pine_tree_a', 'pine_tree_b', 'pine_tree_c'];
    const templates = await Promise.all([...pines, 'rock', 'fern', 'fallen_log'].map(n => prop(n as PropName)));
    const place = (template: THREE.Object3D, x: number, z: number, scale: number, sink = 0.05) => {
      const o = template.clone(true); o.position.set(x, heightAt(x, z) - sink, z); o.rotation.y = random() * Math.PI * 2; o.scale.setScalar(scale); forestSet.add(o); return o;
    };
    const nearShed = (x: number, z: number) => z > SHED.z - 3 && z < SHED.z + 10 && Math.abs(x - SHED.x) < 7;
    for (let z = GROUND_Z + 0.5; z < GROUND_Z + 48; z += 0.9) for (let k = 0; k < 3; k++) {
      const x = -11 + random() * 22;
      if (random() > 0.75 || distToRoute(x, z) < 2.2 || nearShed(x, z)) continue;
      const tree = place(templates[Math.floor(random() * 3)], x, z + (random() - 0.5) * 0.8, 0.8 + random() * 0.5, 0.1);
      tree.rotation.x = (random() - 0.5) * 0.06; tree.rotation.z = (random() - 0.5) * 0.06;
    }
    for (let i = 0; i < 70; i++) { // ferns hugging the path edges
      const s = routeLength * random(), p = routeAt(s), tan = routeCurve.getTangentAt(s / routeLength), side = random() < 0.5 ? -1 : 1, off = 1.0 + random() * 1.3;
      const x = p.x + tan.z * off * side, z = p.z - tan.x * off * side;
      if (!nearShed(x, z)) place(templates[4], x, z, 0.7 + random() * 0.6, 0);
    }
    for (let i = 0; i < 22; i++) { const x = -10 + random() * 20, z = GROUND_Z + random() * 44; if (distToRoute(x, z) > 1.8 && !nearShed(x, z)) place(templates[3], x, z, 0.6 + random() * 0.8, 0.15); }
    for (const [x, z, r] of [[-3.6, 24, 0.3], [10, 30, -0.5], [1.5, 35, 0.9]] as const) if (distToRoute(x, z) > 2.5) { const log = place(templates[5], x, z, 1, 0.05); log.rotation.y = r; }
  }

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0x6f8a9a, 0x0b0d0c, 0.2); scene.add(hemi);
  const labLights = [0, 1, 2, 3].map(i => {
    const at = worldOf(find(lab, `ceiling_light_${i}`), new THREE.Vector3(i % 2 ? 3.5 : -3.5, 3.95, i < 2 ? -6 : 1));
    const l = new THREE.PointLight(0xd8eeff, 0, 12, 2); l.position.copy(at).add(new THREE.Vector3(0, -0.25, 0)); scene.add(l); return l;
  });
  const hatchAt = worldOf(find(tank, 'hatch_hole'), LAB_TANK.clone().add(new THREE.Vector3(0, 1.65, 1.2)));
  const tankWash = new THREE.PointLight(0x37e0c8, 0, 6, 2); tankWash.position.copy(hatchAt).add(new THREE.Vector3(0, 1.0, 1.4)); scene.add(tankWash);
  const hatchKey = new THREE.PointLight(0xff3a24, 0, 4, 2); hatchKey.position.copy(hatchAt).add(new THREE.Vector3(1.0, 0.9, 0.8)); scene.add(hatchKey);
  const clawKey = new THREE.PointLight(0xc8dcff, 0, 3, 2); clawKey.position.copy(hatchAt).add(new THREE.Vector3(1.3, 0.55, 0.9)); scene.add(clawKey); // catches the hand on the frame
  const burstFlash = new THREE.PointLight(0xffa868, 0, 6, 2); burstFlash.position.copy(hatchAt).add(new THREE.Vector3(0, 0, 0.6)); scene.add(burstFlash);
  const consoleGlow = new THREE.PointLight(0x37e0c8, 0, 2.5, 2); consoleGlow.position.set(0, 1.25, 0.7); scene.add(consoleGlow);
  const labAlarmAt = [0, 1, 2, 3].map(i => worldOf(find(lab, `alarm_light_${i}`), new THREE.Vector3(i % 2 ? 6.9 : -6.9, 3.2, i < 2 ? -2.5 : 4.4)));
  const corridorAlarmAt = [0, 1, 2, 3, 4, 5].map(i => worldOf(find(corridor, `alarm_light_${i}`), new THREE.Vector3(0, 2.4, CORRIDOR_Z + 1 + i * 2)));
  const labAlarms = labAlarmAt.map(at => { const l = new THREE.PointLight(0xff2a1a, 0, 10, 2); l.position.copy(at); scene.add(l); return l; });
  const corridorAlarms = corridorAlarmAt.map(at => { const l = new THREE.PointLight(0xff2a1a, 0, 7, 2); l.position.copy(at); scene.add(l); return l; });
  const exitGlow = new THREE.PointLight(0x3dff6e, 0, 3.5, 2); exitGlow.position.copy(worldOf(find(exit, 'exit_sign'), new THREE.Vector3(0, 2.4, EXIT_Z))).add(new THREE.Vector3(0, -0.15, -0.35)); scene.add(exitGlow);
  const moon = new THREE.DirectionalLight(0x7d93b8, 0); moon.position.set(-25, 40, 10); moon.target.position.set(0, 0, 32); scene.add(moon, moon.target);
  const shelterLamp = new THREE.PointLight(0xffb35c, 0, 16, 2); shelterLamp.position.copy(worldOf(find(shelter, 'lamp_bulb'), SHED.clone().add(new THREE.Vector3(0, 3, 0)))).add(new THREE.Vector3(0, -0.3, -1.0)); scene.add(shelterLamp); // out from the wall, so it washes the door
  const vestibuleFill = new THREE.PointLight(0x9fb4c8, 0, 3.5, 2); vestibuleFill.position.copy(SHED).add(new THREE.Vector3(-0.65, shelter.position.y + 2.45, 0.3)); scene.add(vestibuleFill); // rakes across the door so the dent reads
  const flashlight = new THREE.SpotLight(0xfff1d6, 0, 26, 0.36, 0.55, 1.6);
  flashlight.position.set(0.18, -0.22, -0.4); flashlight.target.position.set(0.02, -0.25, -9); flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(1024, 1024); flashlight.shadow.camera.near = 0.2; flashlight.shadow.bias = -0.0015;
  camera.add(flashlight, flashlight.target);

  // Console readouts: canvases redrawn every frame from t, on planes over the three screens.
  const screenCanvas = [0, 1, 2].map(() => Object.assign(document.createElement('canvas'), { width: 192, height: 104 }));
  const screenMaps = screenCanvas.map(canvas => {
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    if (look === 'ironlung') map.magFilter = map.minFilter = THREE.NearestFilter;
    return map;
  });
  screenMaps.forEach((map, i) => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.27), new THREE.MeshBasicMaterial({ map }));
    plane.position.copy(worldOf(find(lab, `console_screen_${i}`), new THREE.Vector3((i - 1) * 0.7, 1.06, 0.16))).add(new THREE.Vector3(0, 0, 0.03));
    labSet.add(plane);
  });

  // ---------- animated parts ----------
  const hatchDoor = find(tank, 'hatch_door'), hatchPanel = find(tank, 'hatch_panel'), hatchBulge = find(tank, 'hatch_bulge');
  const fingers = [0, 1, 2, 3].map(i => { const n = find(claws, `talon_${i}`); return n ? { node: n, rest: n.rotation.clone() } : null; });
  const statusLights = [0, 1].map(i => find(tank, `status_light_${i}`));
  const labScreens = [0, 1, 2].map(i => find(lab, `console_screen_${i}`));
  const labCeiling = [0, 1, 2, 3].map(i => find(lab, `ceiling_light_${i}`));
  const labAlarmMeshes = [0, 1, 2, 3].map(i => find(lab, `alarm_light_${i}`));
  const corridorAlarmMeshes = [0, 1, 2, 3, 4, 5].map(i => find(corridor, `alarm_light_${i}`));
  const doorLeaf = find(exit, 'door_leaf'), shedDoor = find(shelter, 'hatch_door'), dent = find(shelter, 'hatch_dent'), lampBulb = find(shelter, 'lamp_bulb');
  const fpNames = ['arm_l', 'arm_r', 'hand_l', 'hand_r'] as const;
  const fp = Object.fromEntries(fpNames.map(n => { const node = find(arms, n); return [n, node ? { node, rest: node.rotation.clone() } : null]; })) as Record<typeof fpNames[number], { node: THREE.Object3D; rest: THREE.Euler } | null>;
  const pose = (j: { node: THREE.Object3D; rest: THREE.Euler } | null, x = 0, y = 0, z = 0) => { if (j) j.node.rotation.set(j.rest.x + x, j.rest.y + y, j.rest.z + z); };
  const lens = find(arms, 'flashlight_lens'), armRestZ = fp.arm_l?.node.position.z ?? 0;

  // Steam: seams hissing at the bulge, a billow out of the open hatch, the corridor vents.
  const puff = puffTexture(), steam: { sprite: THREE.Sprite; at: THREE.Vector3; born: number; drift: THREE.Vector3; life: number; size: number; peak: number }[] = [];
  const emit = (parent: THREE.Object3D, at: THREE.Vector3, born: number, count: number, seed: number, drift: (r: () => number) => THREE.Vector3, life = 1.9, size = 1.7, peak = 0.42, spacing = 0.09) => {
    const r = rng(seed);
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0xd8c8c4, transparent: true, depthWrite: false, opacity: 0 }));
      parent.add(sprite);
      steam.push({ sprite, at: at.clone(), born: born + i * spacing, drift: drift(r), life, size, peak });
    }
  };
  emit(labSet, hatchAt.clone().add(new THREE.Vector3(0.45, 0.5, 0.1)), B.thud2 + 0.05, 5, 31, r => new THREE.Vector3(0.3 + r() * 0.4, 0.2 + r() * 0.3, 0.3 + r() * 0.4), 1.6, 0.9, 0.3);
  emit(labSet, hatchAt.clone().add(new THREE.Vector3(-0.4, -0.45, 0.1)), B.thud3 + 0.05, 5, 37, r => new THREE.Vector3(-0.3 - r() * 0.4, 0.1 + r() * 0.3, 0.3 + r() * 0.4), 1.6, 0.9, 0.3);
  emit(labSet, hatchAt.clone().add(new THREE.Vector3(0, 0, 0.15)), B.open, 18, 41, r => new THREE.Vector3((r() - 0.75) * 1.3, 0.15 + r() * 0.8, 0.7 + r() * 1.5), 2.8, 2.4, 0.3, 0.08);
  emit(corridorSet, worldOf(find(corridor, 'steam_vent_0'), new THREE.Vector3(0.8, 2.3, CORRIDOR_Z + 4)), B.steam0, 7, 900, r => new THREE.Vector3((r() - 0.5) * 0.8 - 0.9, -0.5 - r() * 0.6, (r() - 0.5) * 0.8));
  emit(corridorSet, worldOf(find(corridor, 'steam_vent_1'), new THREE.Vector3(-0.9, 2.3, CORRIDOR_Z + 8)), B.steam1, 7, 901, r => new THREE.Vector3((r() - 0.5) * 0.8 + 0.9, -0.5 - r() * 0.6, (r() - 0.5) * 0.8));
  emit(forestSet, SHED.clone().add(new THREE.Vector3(0, shelter.position.y + 2.6, 0.4)), B.crash + 0.02, 9, 55, r => new THREE.Vector3((r() - 0.5) * 0.9, -0.9 - r() * 0.5, (r() - 0.5) * 0.4), 2.2, 0.5, 0.35);

  // Rain as thin streaks around the camera (positions are a pure function of time).
  const dropCount = 700, streak = new THREE.Vector3(0.04, -0.24, 0.02), drops = new Float32Array(dropCount * 6), dropBase = new Float32Array(dropCount * 3);
  { const r = rng(77); for (let i = 0; i < dropCount * 3; i += 3) { dropBase[i] = (r() - 0.5) * 18; dropBase[i + 1] = r() * 8; dropBase[i + 2] = (r() - 0.5) * 18; } }
  const dropGeometry = new THREE.BufferGeometry(); dropGeometry.setAttribute('position', new THREE.BufferAttribute(drops, 3));
  const rain = new THREE.LineSegments(dropGeometry, new THREE.LineBasicMaterial({ color: 0x9fb4c4, transparent: true, opacity: 0.28, depthWrite: false }));
  rain.frustumCulled = false; forestSet.add(rain);
  if (look === 'ironlung') (rain.material as THREE.LineBasicMaterial).opacity = 0.13; // one low-res pixel is three output pixels wide

  // Full-frame fade attached to the camera.
  const fade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthTest: false, depthWrite: false }));
  fade.position.z = -0.08; fade.renderOrder = 999; camera.add(fade);
  const fadeMaterial = fade.material as THREE.MeshBasicMaterial;

  await applyLook(scene, look, [lab, tank, corridor, exit]); // the facility is kept clean; the woods are not
  const post = createPost(renderer, look);

  // ---------- camera ----------
  const runEnd = B.arrive - 0.4, eye = (p: THREE.Vector3, h = 1.62): [number, number, number] => [p.x, p.y + h, p.z];
  const forestKeys: CameraKey[] = [];
  for (let n = 0; n <= 9; n++) {
    const t = B.forest + (runEnd - B.forest) * n / 9, s = routeLength * n / 9;
    forestKeys.push({ t, pos: eye(routeAt(s)), yaw: routeHeading(s), pitch: -2, run: 1, breath: 0.4 });
  }
  const shedY = shelter.position.y, inside = SHED.z + 0.75, sx = SHED.x;
  const rig = new CameraRig([
    // Unhurried: the hall and its tube, the colleague at work beside it; one slow look down to the
    // console, then stillness while the screen goes from STABLE to SENSOR FAULT to CONTAINMENT
    // BREACH. The first thud brings the eyes up to the tube. Then the hand, and the snatch.
    { t: 0, pos: [0.05, 1.63, 1.12], yaw: -5, pitch: 3 },
    { t: 1.4, pos: [0.05, 1.63, 1.1], yaw: -3, pitch: 2 },
    { t: 2.2, pos: [0.05, 1.62, 1.08], yaw: 1, pitch: -31 },
    { t: B.thud1 - 0.35, pos: [0.04, 1.62, 1.1], yaw: 1, pitch: -30 },
    { t: B.thud1 + 0.3, pos: [0.04, 1.64, 1.2], yaw: -9, pitch: 2 },
    { t: B.thud2, pos: [0, 1.63, 1.1], yaw: -7, pitch: 3 },
    { t: B.thud3 + 0.2, pos: [0, 1.62, 1.0], yaw: -5, pitch: 1 },
    { t: B.open + 0.3, pos: [0, 1.6, 1.15], yaw: -6, pitch: 2 },
    { t: B.grab + 0.35, pos: [0.04, 1.6, 1.25], yaw: -12, pitch: 1 },
    { t: B.snatch, pos: [0.04, 1.6, 1.25], yaw: -14, pitch: 1 },
    { t: B.snatch + 0.24, pos: [-0.02, 1.6, 1.22], yaw: -46, pitch: -2 },
    { t: B.snatch + 0.45, pos: [-0.04, 1.6, 1.25], yaw: -36, pitch: 0 },
    { t: B.snatch + 0.85, pos: [0.04, 1.6, 1.4], yaw: -8, pitch: 2 },
    { t: B.turn + 0.3, pos: [0.15, 1.6, 2.0], yaw: 120, pitch: -1, run: 0.5 },
    { t: B.turn + 0.9, pos: [0.1, 1.62, 3.6], yaw: 182, run: 1, breath: 0.2 },
    { t: B.turn + 1.7, pos: [0.02, 1.62, 6.5], yaw: 181, run: 1 },
    { t: B.turn + 2.6, pos: [-0.45, 1.62, 9.6], yaw: 172, run: 1 },
    { t: B.turn + 3.2, pos: [-0.5, 1.62, 11.7], yaw: 180, run: 1 },
    { t: B.turn + 3.8, pos: [-0.05, 1.62, 14.3], yaw: 186, run: 1 },
    { t: B.barge, pos: [0, 1.6, 16.0], yaw: 180, pitch: -3, run: 0.8 },
    ...forestKeys,
    // The door is hinged on +X (camera left) and swings out 1.5 m; keep the eye outside that arc.
    // Then, as it swings, step back and look left into the black doorway.
    { t: B.arrive, pos: [sx - 0.5, shedY + 1.62, SHED.z - 1.15], yaw: 180, pitch: -5, run: 0.25, breath: 0.6 },
    { t: B.doorOpen, pos: [sx - 0.55, shedY + 1.6, SHED.z - 1.2], yaw: 182, pitch: -4, breath: 0.7 },
    { t: B.doorOpen + 0.5, pos: [sx - 0.8, shedY + 1.6, SHED.z - 1.6], yaw: 196, pitch: 0, breath: 0.8 },
    { t: B.enter, pos: [sx - 0.55, shedY + 1.6, SHED.z - 1.35], yaw: 192, pitch: -1, run: 0.3, breath: 0.8 },
    { t: B.enter + 0.5, pos: [sx, shedY + 1.52, inside + 0.15], yaw: 182, pitch: -6, run: 0.3, breath: 0.8 },
    { t: B.lookBack, pos: [sx, shedY + 1.52, inside + 0.1], yaw: 230, pitch: -3, breath: 0.9 },
    { t: B.lookBack + 0.7, pos: [sx, shedY + 1.55, inside], yaw: 362, pitch: 0, breath: 0.9 },
    { t: B.haul, pos: [sx + 0.05, shedY + 1.55, inside - 0.05], yaw: 361, pitch: 1, breath: 1 },
    { t: B.slam, pos: [sx + 0.08, shedY + 1.55, inside - 0.1], yaw: 360, pitch: 1, breath: 1 },
    { t: B.crash - 0.05, pos: [sx + 0.08, shedY + 1.55, inside - 0.05], yaw: 360, pitch: 0, breath: 0.7 },
    { t: B.crash + 0.6, pos: [sx + 0.12, shedY + 1.5, inside + 0.15], yaw: 357, pitch: 7, breath: 1 },
    { t: B.black, pos: [sx + 0.1, shedY + 1.48, inside + 0.2], yaw: 358, pitch: 3, breath: 1 },
    { t: B.end, pos: [sx + 0.1, shedY + 1.48, inside + 0.2], yaw: 358, pitch: 3 },
  ], [
    { t: B.thud1, strength: 0.25 }, { t: B.thud2, strength: 0.45 }, { t: B.thud3, strength: 0.6, kick: 0.05 },
    { t: B.open, strength: 1.2, kick: 0.2 }, { t: B.grab, strength: 0.3 }, { t: B.snatch + 0.2, strength: 0.7, kick: 0.06 }, { t: B.snatch + 0.78, strength: 0.4 }, { t: B.barge, strength: 0.9, kick: -0.1 },
    { t: B.slam, strength: 1.1, kick: 0.08 }, { t: B.crash, strength: 2.2, kick: 0.2 }, { t: B.scrape, strength: 0.4 },
  ]);

  // ---------- per-frame state (a pure function of t) ----------
  const fogColor = new THREE.Color(), labFog = new THREE.Color(0x0a1416), corridorFog = new THREE.Color(0x160707), forestFog = new THREE.Color(0x172529);
  const crashFlickerOf = (t: number) => t >= B.crash && t < B.crash + 0.5 ? (hash(Math.floor(t * 40)) > 0.4 ? 1 : 0.15) : 1;
  const shakeOf = (t: number, hits: [number, number][]) => hits.reduce((s, [at, amp]) => { const dt = t - at; return dt < 0 || dt > 1 ? s : s + Math.sin(dt * 70) * amp * Math.exp(-dt * 7); }, 0);

  // The colleague's marks: beside you at the console's right end, a step back at the first thud,
  // another as it bursts; the last is where the hand takes them, at chest height.
  const STAND: [number, number][] = [[0.95, 0.85], [1.0, 0.95], [1.05, 1.0]];
  const facing = Math.atan2(LAB_TANK.x - STAND[0][0], LAB_TANK.z + 1.2 - STAND[0][1]); // toward the hatch
  const clawMount = claws.parent!;
  clawMount.updateWorldMatrix(true, false);
  // In claw_mount space: the arm aims from the hatch straight at the colleague's chest (palm 0.27
  // ahead of the wrist), and its forearm stretches so it always runs back into the dark.
  const chestAt = clawMount.worldToLocal(new THREE.Vector3(STAND[2][0], 1.3, STAND[2][1])), aim = chestAt.clone().normalize();
  const lunge = chestAt.clone().addScaledVector(aim, -0.27), INSIDE = aim.clone().multiplyScalar(-1.2), held = new THREE.Vector3();
  const aimQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), aim), twist = new THREE.Quaternion(), twistE = new THREE.Euler();
  const forearm = find(claws, 'forearm'), FOREARM = 0.95 * 1.8; // its length at the scene's scale

  function poseClaws(t: number): void {
    // Out of the dark onto the frame (non-hinge side), fingers curling to grip. Then it lets go,
    // lunges, closes on the colleague and drags them back into the dark.
    claws.visible = t >= B.grab - 0.25 && t < B.snatch + 0.9;
    const reach = ramp(t, B.snatch, B.snatch + 0.2), back = Math.pow(clamp01((t - B.snatch - 0.35) / 0.4), 2);
    held.set(0, track(t, [[B.grab, 0], [B.snatch, 0.02]]), track(t, [[B.grab - 0.25, -0.8], [B.grab, 0], [B.grab + 0.15, 0.03], [B.snatch, 0.05]]));
    claws.position.copy(held).lerp(lunge, reach).lerp(INSIDE, back);
    if (t > B.snatch + 0.2 && t < B.snatch + 0.4) claws.position.x += Math.sin(t * 90) * 0.02; // the struggle
    twist.setFromEuler(twistE.set(Math.sin(t * 7) * 0.02, track(t, [[B.grab, 0.25], [B.grab + 0.3, 0]]), 0));
    claws.quaternion.identity().slerp(aimQ, ramp(t, B.snatch, B.snatch + 0.12)).multiply(twist);
    if (forearm) forearm.scale.z = Math.max(1, (claws.position.length() + 0.35) / FOREARM);
    const grip = track(t, [[B.grab - 0.25, -0.1], [B.grab + 0.05, 0.2], [B.grab + 0.25, 1.05], [B.grab + 0.6, 1.15], [B.snatch, 1.15], [B.snatch + 0.08, -0.35], [B.snatch + 0.18, -0.3], [B.snatch + 0.26, 1.3]]);
    fingers.forEach((f, i) => { if (f) f.node.rotation.set(f.rest.x + grip + Math.sin(t * 13 + i * 1.7) * 0.04, f.rest.y, f.rest.z); });
  }

  const cj = Object.fromEntries(['body', 'torso', 'head', 'arm_l', 'arm_r', 'leg_l', 'leg_r'].map(n => [n, find(colleague, n)])) as Record<string, THREE.Object3D | null>;
  const palm = new THREE.Vector3(), chestOffset = new THREE.Vector3();
  function poseColleague(t: number): void {
    colleague.visible = labSet.visible && t < B.snatch + 0.85;
    if (!colleague.visible) return;
    const set = (o: THREE.Object3D | null, x: number, y = 0, z = 0) => o?.rotation.set(x, y, z);
    if (t < B.snatch + 0.2) {
      // Working the console beside you, a look your way at the alarm, a flinch at each blow, frozen.
      const look = ramp(t, B.alarm, B.alarm + 0.3) * (1 - ramp(t, B.thud1, B.thud1 + 0.3));
      const jolt = Math.max(ramp(t, B.thud1, B.thud1 + 0.12) * (1 - ramp(t, B.thud1 + 0.5, B.thud2)), ramp(t, B.open, B.open + 0.1));
      const s1 = ramp(t, B.thud1, B.thud1 + 0.4), s2 = ramp(t, B.open, B.open + 0.35);
      colleague.position.set(STAND[0][0] + (STAND[1][0] - STAND[0][0]) * s1 + (STAND[2][0] - STAND[1][0]) * s2, 0, STAND[0][1] + (STAND[1][1] - STAND[0][1]) * s1 + (STAND[2][1] - STAND[1][1]) * s2);
      colleague.rotation.set(0, facing + 0.55 * look, 0);
      const tremble = Math.sin(t * 31) * 0.03 * ramp(t, B.grab, B.grab + 0.2), up = ramp(t, B.open, B.open + 0.15);
      set(cj.torso, -0.22 * jolt + Math.sin(t * 1.3) * 0.02 + tremble);
      set(cj.head, 0.15 * (1 - look) - 0.2 * jolt, 0.4 * look);
      set(cj.arm_l, 0.5 - 1.3 * up + tremble); set(cj.arm_r, 0.5 - 1.0 * up);
      set(cj.leg_l, 0); set(cj.leg_r, 0);
    } else {
      // Seized at the chest: pitched head-first toward the hatch and dragged in with the hand.
      const k = ramp(t, B.snatch + 0.2, B.snatch + 0.5), flail = Math.sin(t * 34);
      colleague.rotation.set(1.35 * k, facing, 0.25 * Math.sin(t * 9) * k);
      claws.updateWorldMatrix(true, false);
      claws.localToWorld(palm.set(0, 0, 0.15));
      colleague.position.copy(palm).sub(chestOffset.set(0, 1.3, 0.12).applyEuler(colleague.rotation));
      set(cj.torso, 0.2); set(cj.head, -0.5);
      set(cj.arm_l, -2.2 + 0.6 * flail); set(cj.arm_r, -2.0 - 0.6 * flail);
      set(cj.leg_l, 0.5 * flail); set(cj.leg_r, -0.5 * flail);
    }
  }

  // Console readouts: the subject's vitals, a sensor fault as the lights stutter, then the breach.
  const amber = '#ffb347', teal = '#5ff0d8', red = '#ff3a26';
  function drawScreens(t: number): void {
    if (!labSet.visible) return;
    const step = Math.floor(t * 12), breach = t >= B.alarm, fault = t >= B.flicker && !breach, flash = breach && (t - B.alarm) % 1.7 < 1.25;
    screenCanvas.forEach((canvas, i) => {
      const g = canvas.getContext('2d')!, w = canvas.width, h = canvas.height;
      g.fillStyle = breach ? (flash && i === 1 ? '#4a0400' : '#120302') : i === 1 ? '#160d02' : '#021412';
      g.fillRect(0, 0, w, h);
      g.textBaseline = 'top';
      const ink = breach ? red : i === 1 ? amber : teal;
      g.fillStyle = ink; g.strokeStyle = ink; g.lineWidth = 2;
      if (i === 1) { // the subject: vitals, then the breach
        if (breach) {
          g.fillStyle = flash ? '#fff1e0' : red;
          g.font = 'bold 25px monospace'; g.fillText('CONTAINMENT', 9, 14);
          g.font = 'bold 38px monospace'; g.fillText('BREACH', 28, 42);
          g.fillStyle = red; g.font = 'bold 12px monospace';
          g.fillText(t >= B.open ? 'HATCH OPEN' : t >= B.thud2 ? 'HATCH SEAL FAILING' : 'EVACUATE TO SHELTER', 10, 86);
        } else {
          g.font = 'bold 12px monospace'; g.fillText('SUBJECT 07 · CHAMBER 2', 8, 8);
          g.font = fault ? 'bold 21px monospace' : 'bold 28px monospace';
          if (!fault || hash(step) > 0.5) g.fillText(fault ? 'SENSOR FAULT' : 'STABLE', fault ? 18 : 44, fault ? 30 : 26);
          g.beginPath(); // its heartbeat, scrolling: slow, then racing as the lights stutter
          for (let x = 0; x < w; x += 2) {
            const ph = ((x + t * 70) % 48) / 48, beat = ph < 0.06 ? -Math.sin(ph / 0.06 * Math.PI) * 18 : 0;
            const y = 82 + beat + (fault ? (hash(step * 31 + x) - 0.5) * 14 : 0);
            if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
        }
      } else if (i === 0) { // chamber pressure history, climbing
        g.font = 'bold 12px monospace'; g.fillText(breach ? 'PRESSURE  CRITICAL' : 'CHAMBER PRESSURE', 8, 8);
        for (let b = 0; b < 16; b++) {
          const at = t - (15 - b) * 0.25, v = 0.25 + 0.6 * ramp(at, B.flicker, B.open) + 0.06 * hash(Math.floor(at * 4) + b * 7);
          g.fillRect(8 + b * 11, h - 10 - v * 70, 8, v * 70);
        }
      } else { // camera inside the chamber: dark static, then lost
        g.font = 'bold 12px monospace'; g.fillText('CAM 02 · CHAMBER', 8, 8);
        const lost = t >= B.thud1;
        for (let y = 24; y < h; y += 8) for (let x = 0; x < w; x += 8) {
          const n = hash(step * 977 + x * 13 + y * 71);
          g.fillStyle = `rgba(${lost ? '200,200,190' : '60,90,85'},${(lost ? 0.55 : 0.25) * n})`; g.fillRect(x, y, 8, 8);
        }
        if (lost && hash(step) > 0.3) { g.fillStyle = red; g.font = 'bold 22px monospace'; g.fillText('SIGNAL LOST', 24, 52); }
      }
      screenMaps[i].needsUpdate = true;
    });
  }

  function poseArms(t: number): void {
    arms.visible = t >= B.turn - 0.1 && t < B.black; // only once you run: no hands hovering in the lab
    const stride = Math.sin(Math.PI * t * STEP_RATE);
    const running = ramp(t, B.turn, B.turn + 0.5) * (1 - ramp(t, B.arrive - 0.3, B.arrive + 0.2)) + ramp(t, B.enter, B.enter + 0.2) * (1 - ramp(t, B.enter + 0.4, B.lookBack)) * 0.5;
    const guard = ramp(t, B.open, B.open + 0.12) * (1 - ramp(t, B.turn - 0.3, B.turn + 0.3));
    const push = ramp(t, B.barge - 0.35, B.barge) * (1 - ramp(t, B.barge + 0.3, B.barge + 0.8));
    const opening = ramp(t, B.arrive - 0.2, B.doorOpen) * (1 - ramp(t, B.doorOpen + 0.6, B.enter));
    const pull = ramp(t, B.haul - 0.3, B.haul + 0.4) * (1 - ramp(t, B.slam + 0.05, B.slam + 0.4));
    const jolt = Math.exp(-Math.max(0, t - B.crash) * 6) * (t >= B.crash ? 1 : 0);
    const low = -(1 - ramp(t, B.open - 0.05, B.open + 0.15)) * 0.9;
    const reach = Math.max(push, opening * (1 - 0.6 * ramp(t, B.doorOpen, B.doorOpen + 0.6)), pull * (1 - 0.7 * ramp(t, B.haul + 0.4, B.slam)));
    pose(fp.arm_l, low + guard * 0.45 + running * stride * 0.22 + push * 0.3 + opening * 0.25 + pull * 0.25 - jolt * 0.35, (opening + pull) * 0.25);
    pose(fp.arm_r, low + guard * 0.4 - running * stride * 0.12 - jolt * 0.3);
    if (fp.arm_l) fp.arm_l.node.position.z = armRestZ - 0.26 * reach;
  }

  function renderAt(t: number): void {
    rig.apply(camera, t);
    // Eyes lock on: reading the console, the breach on screen, the hand on the frame (a slight push-in each time).
    const fixate = Math.max(
      ramp(t, 1.6, 2.3) * (1 - ramp(t, B.thud1 - 0.35, B.thud1)),
      ramp(t, B.grab - 0.1, B.grab + 0.35) * (1 - ramp(t, B.snatch - 0.05, B.snatch + 0.2)));
    if (fixate > 0) { camera.fov -= 18 * fixate; camera.updateProjectionMatrix(); }
    labSet.visible = t < B.forest + 1.8; corridorSet.visible = t > B.turn - 0.2 && t < B.forest + 2.3; forestSet.visible = t > B.barge - 0.4;

    // Fog and background per location.
    fogColor.copy(labFog).lerp(corridorFog, ramp(t, B.turn, B.turn + 1)).lerp(forestFog, ramp(t, B.barge, B.barge + 1));
    fog.color.copy(fogColor); background.copy(fogColor);
    fog.density = track(t, [[0, 0.035], [B.turn, 0.035], [B.turn + 1, 0.045], [B.barge, 0.045], [B.barge + 1, 0.052], [B.arrive, 0.052], [B.lookBack, 0.06]]);
    hemi.intensity = track(t, [[0, 0.18], [B.alarm, 0.08], [B.barge, 0.08], [B.barge + 1, 0.55], [B.slam, 0.55], [B.slam + 0.1, 0.02]]);
    hemi.color.set(t > B.barge ? 0x5a7890 : 0x6f8a9a);

    // Lab: steady lights, a stutter, then emergency red. Thuds shake the tube.
    const step = Math.floor(t * 18), flickering = t >= B.flicker && t < B.alarm;
    const ceiling = t < B.flicker ? 1 : flickering ? (hash(step) > 0.45 ? 0.15 + hash(step + 9) * 0.9 : 0.02) : 0;
    labLights.forEach(l => { l.intensity = labSet.visible ? ceiling * 13 : 0; }); // a 4 m ceiling
    labCeiling.forEach(m => glow(m, ceiling * 1.6));
    tank.position.set(LAB_TANK.x + shakeOf(t, [[B.thud1, 0.015], [B.thud2, 0.03], [B.thud3, 0.04], [B.open, 0.05]]), 0, LAB_TANK.z + shakeOf(t + 0.13, [[B.thud1, 0.01], [B.thud2, 0.02], [B.thud3, 0.03], [B.open, 0.04]]));
    const alarmOn = t >= B.alarm ? 1 : 0;
    statusLights.forEach((m, i) => glow(m, alarmOn ? 0.4 + 2.2 * pulse(t + i * 0.25, 2.4, 4) : 1.4, alarmOn ? 0xff2a1a : 0x37e0c8));
    tankWash.intensity = labSet.visible ? (alarmOn ? 2.5 : 5) : 0;
    hatchKey.intensity = labSet.visible ? alarmOn * (2.5 + 2.5 * pulse(t, 1.1, 4)) : 0;
    clawKey.intensity = labSet.visible && t >= B.grab - 0.3 ? 5 * (1 - ramp(t, B.turn + 0.4, B.turn + 1)) * (0.85 + 0.15 * hash(Math.floor(t * 20))) : 0;
    burstFlash.intensity = labSet.visible && t >= B.open ? 7 * Math.exp(-(t - B.open) * 12) : 0;
    consoleGlow.intensity = labSet.visible ? (0.35 + (t > B.alarm ? pulse(t, 2) * 0.3 : 0)) * (look === 'ironlung' ? 0.35 : 1) : 0;
    labScreens.forEach((m, i) => glow(m, t > B.alarm && i === 1 ? 0.06 + pulse(t, 2.2) * 0.25 : 0.12));

    // Hatch: dented outward by the thuds, then it bursts open on its hinge.
    if (hatchPanel) hatchPanel.visible = t < B.thud2;
    if (hatchBulge) { hatchBulge.visible = t >= B.thud2; hatchBulge.scale.set(1, 1, track(t, [[B.thud2, 0.35], [B.thud2 + 0.08, 1], [B.thud2 + 0.4, 0.85], [B.thud3, 0.85], [B.thud3 + 0.08, 1.3], [B.thud3 + 0.4, 1.15]])); }
    if (hatchDoor) hatchDoor.rotation.y = track(t, [[B.open - 0.01, 0], [B.open + 0.12, -1.8], [B.open + 0.28, -2.05], [B.open + 0.55, -1.85], [B.open + 0.9, -1.92]]);
    poseClaws(t);
    poseColleague(t);
    drawScreens(t);

    // Alarm beacons: the lab's fade once it's behind the runner; the corridor's are lit as soon as it can be seen.
    labAlarms.forEach((l, i) => { l.intensity = labSet.visible ? alarmOn * 9 * (1 - ramp(t, B.turn + 2, B.turn + 2.8)) * (0.12 + 0.88 * pulse(t + i * 0.37, 1.1, 4)) : 0; });
    corridorAlarms.forEach((l, i) => { l.intensity = corridorSet.visible ? alarmOn * 7 * (0.12 + 0.88 * pulse(t + i * 0.37, 1.1, 4)) : 0; });
    labAlarmMeshes.forEach((m, i) => glow(m, alarmOn * (0.4 + 2.4 * pulse(t + i * 0.37, 1.1, 4))));
    corridorAlarmMeshes.forEach((m, i) => glow(m, alarmOn * (0.4 + 2.4 * pulse(t + i * 0.37, 1.1, 4))));
    exitGlow.intensity = corridorSet.visible ? 0.7 : 0;

    // Doors: the exit is barged open; the shed door is pulled open, hauled shut, then dented.
    if (doorLeaf) doorLeaf.rotation.y = -1.5 * track(t, [[B.barge - 0.05, 0], [B.barge + 0.18, 1.08], [B.barge + 0.45, 0.94], [B.barge + 0.8, 1]]);
    if (shedDoor) shedDoor.rotation.y = t < B.haul ? -1.6 * track(t, [[B.doorOpen, 0], [B.doorOpen + 0.15, 0.08], [B.doorOpen + 0.9, 1]]) : -1.6 * (1 - Math.pow(clamp01((t - B.haul) / (B.slam - B.haul)), 3.2));
    if (dent) { dent.visible = t >= B.crash; dent.scale.set(1, 1, Math.max(0.01, track(t, [[B.crash, 0.01], [B.crash + 0.05, 1.2], [B.crash + 0.2, 1], [B.scrape, 1], [B.scrape + 0.8, 1.15]]))); }

    // Steam and dust (fading as the camera passes through).
    for (const s of steam) {
      const age = t - s.born, m = s.sprite.material as THREE.SpriteMaterial;
      if (age < 0 || age > s.life) { m.opacity = 0; s.sprite.visible = false; continue; }
      const k = age / s.life;
      s.sprite.visible = true;
      s.sprite.position.copy(s.at).addScaledVector(s.drift, age * (1.2 - k * 0.5));
      s.sprite.scale.setScalar(0.25 + k * s.size);
      m.opacity = s.peak * (1 - k) * ramp(age, 0, 0.12) * ramp(s.sprite.position.distanceTo(camera.position), 0.4, 1.6);
    }

    // Forest and shed.
    moon.intensity = forestSet.visible && t < B.slam ? 1.6 : 0;
    shelterLamp.intensity = forestSet.visible && t < B.slam ? 6 + 5 * ramp(t, B.arrive - 2, B.arrive) + 1.2 * hash(Math.floor(t * 9)) * (t > B.arrive - 3 ? 1 : 0) : 0;
    glow(lampBulb, t < B.slam ? 2.4 : 0.2);
    const crashFlicker = crashFlickerOf(t);
    vestibuleFill.intensity = t >= B.slam && t < B.black ? 22 * crashFlicker * (t >= B.lightDies ? 0.3 : 1) : 0;
    const dying = t >= B.lightDies ? (t < B.black ? (hash(Math.floor(t * 30)) > 0.55 ? 0.6 : 0.05) : 0) : 1;
    // At arm's length from the shed door the full beam would blow out to a hard white disc.
    const nearDoor = track(t, [[B.arrive - 1.2, 1], [B.arrive - 0.2, 0.035], [B.enter + 0.3, 0.035], [B.enter + 0.7, 0.6], [B.haul, 0.6], [B.slam, 0.008]]);
    flashlight.intensity = t >= B.flashlight && t < B.black ? (70 + 120 * ramp(t, B.barge, B.barge + 0.6) - 70 * ramp(t, B.lookBack, B.lookBack + 0.6)) * nearDoor * (t < B.flashlight + 0.08 ? 0.4 : 1) * (0.96 + 0.04 * hash(Math.floor(t * 24))) * dying * crashFlicker : 0;
    flashlight.angle = 0.36 + 0.24 * ramp(t, B.slam, B.slam + 0.4);
    glow(lens, t >= B.flashlight && t < B.black ? 2.5 * dying : 0.05);
    // Aim: ahead while running; down and away from the doorway (the shadow stays unlit); then at the door.
    const aimDown = ramp(t, B.lookBack, B.lookBack + 0.6) * (1 - ramp(t, B.slam - 0.1, B.slam + 0.4)), atDoor = ramp(t, B.slam - 0.1, B.slam + 0.4);
    flashlight.target.position.set((0.02 + Math.sin(t * 2.3) * 0.25 * (1 - aimDown) + aimDown * 0.9) * (1 - atDoor) - 0.16 * atDoor, (0.1 + Math.sin(t * 3.1) * 0.15 * (1 - aimDown) - aimDown * 2.4) * (1 - atDoor) + 0.12 * atDoor, (-9 + aimDown * 5) * (1 - atDoor) - 3 * atDoor);

    // The shadow: emerges far back along the route and rushes the door, but the door shuts with it
    // still ~7 m out in the fog, so it is never seen up close.
    shadow.visible = t >= B.shadow && t < B.slam + 0.02;
    if (shadow.visible) {
      const rush = clamp01((t - B.rush) / (B.slam - 0.05 - B.rush)), back = 20 - (t - B.shadow) * 0.6 - Math.pow(rush, 1.4) * 12;
      const p = back > 0 ? routeAt(routeLength - back) : SHED.clone().add(new THREE.Vector3(0, shelter.position.y, -1.2 + back));
      shadow.position.set(p.x, p.y + Math.abs(Math.sin(t * Math.PI * 4.2)) * 0.12 * rush, p.z);
      shadow.rotation.set(0.12 + rush * 0.25, Math.atan2(SHED.x - p.x, SHED.z - p.z), Math.sin(t * Math.PI * 2.1) * 0.05);
    }

    poseArms(t);
    rain.visible = forestSet.visible && t < B.slam;
    if (rain.visible) {
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      const wrap = (v: number, span: number) => ((v % span) + span) % span - span / 2;
      for (let i = 0, j = 0; i < dropCount * 3; i += 3, j += 6) {
        const x = cx + wrap(dropBase[i] - cx + t * 0.6, 18), y = cy - 2 + ((dropBase[i + 1] - t * 7) % 8 + 8) % 8, z = cz + wrap(dropBase[i + 2] - cz, 18);
        // No rain indoors (corridor, shed) and none close enough to the lens to read as a smear.
        const indoors = z < EXIT_Z + 0.2 || (z > SHED.z - 0.05 && z < SHED.z + 6.5 && Math.abs(x - SHED.x) < 3.6);
        const hide = indoors || (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 < 0.5;
        drops[j] = x; drops[j + 1] = hide ? -50 : y; drops[j + 2] = z;
        drops[j + 3] = x + streak.x; drops[j + 4] = hide ? -50 : y + streak.y; drops[j + 5] = z + streak.z;
      }
      dropGeometry.attributes.position.needsUpdate = true;
    }

    fadeMaterial.opacity = Math.max(1 - ramp(t, 0, 1.0), t >= B.black ? 1 : 0);
    post.render(scene, camera, t);
  }

  return {
    scene, camera, renderAt,
    dispose() { scene.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); post.dispose(); renderer.dispose(); },
  };
}
