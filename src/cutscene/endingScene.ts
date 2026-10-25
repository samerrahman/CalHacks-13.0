import * as THREE from 'three';
import { BASEMENT_DOOR } from './props/basementDoor';
import { STAIRS } from './props/basementStairs';
import { VAULT } from './props/basementVault';
import { applyLook, createPost, type Look } from './look';
import { facet, rng } from './style';
import { CameraRig, hash, pulse, ramp, track, type CameraKey, type Cutscene, type Impact, type PropSource } from './scene';
import { BEATS as B, SCOPE, STEP_RATE, contactAt, lastPing } from './ending';
import { createDisplay, drawSonar, drawStatus } from '../render/displays';
import type { RenderState } from '../render/state';

/** Loads one of the game's shelter GLBs (public/assets/models) with its animation clips. */
export type ModelSource = (name: string) => Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>;
type V3 = [number, number, number];

// World layout: the game's own shelter (placements copied from src/render/scene.ts), so the film
// opens on the room the player just left. As in the game there are no cameras: the sonar scope
// stands on the desk where the security monitor was, and the wall status unit hangs above the
// terminal. The basement door sits in the front wall left of the desk; its stairwell runs down
// behind that wall toward −Z into the vault. The sealed shelter door is behind you.
const ROOM: Record<string, [V3, number]> = {
  shelter: [[0, 0, 0], 0], sealed_door: [[-1.75, 0, 2.39], Math.PI], workdesk: [[0, 0, -1.8], 0], terminal: [[-0.62, 0.92, -1.8], 0],
  radio_speaker: [[-1.3, 0.92, -1.8], 0], machine_rack: [[2.67, 0, 0.05], -Math.PI / 2], emergency_switch: [[-0.7, 1.35, 2.36], Math.PI],
};
/** Basement door origin (floor centre of the doorway, room-side face of the front wall). */
export const BASEMENT_AT = new THREE.Vector3(-2.0, 0, -2.5);
/** Vault origin: the end of the stairwell's bottom landing. */
export const VAULT_AT = BASEMENT_AT.clone().add(new THREE.Vector3(0, -STAIRS.rise * STAIRS.steps, STAIRS.landingEnd - STAIRS.run * STAIRS.steps - STAIRS.bottomLength));
const SCOPE_AT = new THREE.Vector3(0.72, 1.34, -1.78);
const SEALED_AT = new THREE.Vector3(...ROOM.sealed_door[0]);
const OPEN = BASEMENT_DOOR.maxTravel - 0.02; // the most the side wall lets it open: just wide enough

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const find = (root: THREE.Object3D, name: string) => root.getObjectByName(name) ?? null;
const worldOf = (o: THREE.Object3D | null, fallback: V3) => o ? new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()) : new THREE.Vector3(...fallback);
function own(o: THREE.Object3D | null): void {
  o?.traverse(m => { if (m instanceof THREE.Mesh) m.material = (m.material as THREE.Material).clone(); });
}
function glow(o: THREE.Object3D | null, intensity: number, color?: number): void {
  o?.traverse(m => {
    if (m instanceof THREE.Mesh && 'emissiveIntensity' in m.material) { const mat = m.material as THREE.MeshStandardMaterial; mat.emissiveIntensity = intensity; if (color !== undefined) mat.emissive.setHex(color); }
  });
}
/** Yaw/pitch (degrees, CameraRig convention) from `from` toward `to`; yaw is unwrapped near `near`. */
function aim(from: V3, to: V3 | THREE.Vector3, near: number): { yaw: number; pitch: number } {
  const [x, y, z] = Array.isArray(to) ? to : [to.x, to.y, to.z], dx = x - from[0], dy = y - from[1], dz = z - from[2];
  let yaw = THREE.MathUtils.radToDeg(Math.atan2(-dx, -dz));
  while (yaw - near > 180) yaw -= 360;
  while (yaw - near < -180) yaw += 360;
  return { yaw, pitch: THREE.MathUtils.radToDeg(Math.atan2(dy, Math.hypot(dx, dz))) };
}
const key = (t: number, pos: V3, to: V3 | THREE.Vector3, near: number, extra: Partial<CameraKey> = {}): CameraKey => ({ t, pos, ...aim(pos, to, near), ...extra });

/** How far the leaf has slid open (m): it jerks loose, grinds along, stalls at each blow, and once
 * released drops shut under its counterweight. */
export function travelAt(t: number): number {
  if (t >= B.release) return OPEN * (1 - Math.pow(clamp01((t - B.release) / (B.shut - B.release)), 2));
  return track(t, [[B.crack, 0], [B.crack + 0.12, 0.03], [B.crack + 0.5, 0.035], [B.scope, 0.1], [B.hit1 - 0.1, 0.24], [B.hit1 + 0.3, 0.245], [B.hit2, 0.3], [B.hit2 + 0.3, 0.303], [B.hit3, 0.36], [B.squeeze - 0.1, OPEN]]);
}

function puffTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function canvasTexture(width: number, height: number, look: Look): { canvas: HTMLCanvasElement; map: THREE.CanvasTexture } {
  const canvas = Object.assign(document.createElement('canvas'), { width, height }), map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  if (look === 'ironlung') map.magFilter = map.minFilter = THREE.NearestFilter;
  return { canvas, map };
}

export async function createEnding(renderer: THREE.WebGLRenderer, prop: PropSource, model: ModelSource, look: Look = 'ironlung'): Promise<Cutscene> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030405);
  scene.fog = new THREE.FogExp2(0x030405, 0.06);
  const fog = scene.fog as THREE.FogExp2;
  const camera = new THREE.PerspectiveCamera(68, renderer.domElement.width / renderer.domElement.height, 0.04, 120);
  scene.add(camera);
  const textures = new THREE.TextureLoader();
  const image = async (url: string) => { const t = await textures.loadAsync(url); t.colorSpace = THREE.SRGBColorSpace; return t; };

  // ---------- the shelter, from the game's own models ----------
  const room: Record<string, THREE.Object3D> = {}, clips: Record<string, THREE.AnimationClip[]> = {};
  for (const [name, [pos, rotation]] of Object.entries(ROOM)) {
    const { scene: asset, animations } = await model(name);
    asset.position.set(...pos); asset.rotation.y = rotation; own(asset); scene.add(asset);
    room[name] = asset; clips[name] = animations;
  }
  const shelter = room.shelter;
  // Cut the two doorways the game never needs: the basement door's in the front wall and, for the
  // breach, the sealed door's in the back wall. Same wall material, so the look textures them alike.
  const wallMaterial = (find(shelter, 'end_wall_-1') as THREE.Mesh | null)?.material as THREE.Material;
  const wallPiece = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const m = new THREE.Mesh(facet(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)), wallMaterial);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); m.castShadow = m.receiveShadow = true; scene.add(m); return m;
  };
  for (const n of ['end_wall_-1', 'end_wall_1', 'front_rib_-2.7']) { const o = find(shelter, n); if (o) o.visible = false; }
  const W = BASEMENT_DOOR.width / 2, bx = BASEMENT_AT.x;
  wallPiece(-3.2, bx - W, 0, 3, -2.7, -2.5); wallPiece(bx + W, 3.2, 0, 3, -2.7, -2.5); wallPiece(bx - W, bx + W, BASEMENT_DOOR.height, 3, -2.7, -2.5);
  const hole = [SEALED_AT.x - 0.66, SEALED_AT.x + 0.66];
  wallPiece(-3.2, hole[0], 0, 3, 2.5, 2.7); wallPiece(hole[1], 3.2, 0, 3, 2.5, 2.7); wallPiece(hole[0], hole[1], 2.6, 3, 2.5, 2.7);

  // Desk lamp and wall plates, as in the game.
  const steel = (find(room.workdesk, 'desk_top') as THREE.Mesh | null)?.material as THREE.Material;
  const part = (size: V3, at: V3, mat: THREE.Material) => { const m = new THREE.Mesh(facet(new THREE.BoxGeometry(...size)), mat); m.position.set(...at); m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
  part([0.25, 0.035, 0.22], [-1.35, 0.945, -1.96], steel); part([0.027, 0.77, 0.027], [-1.35, 1.32, -1.96], steel); part([0.36, 0.08, 0.23], [-1.26, 1.72, -1.83], steel);
  const lampFace = part([0.29, 0.015, 0.18], [-1.26, 1.672, -1.83], new THREE.MeshStandardMaterial({ color: 0x82745a, emissive: 0xe29049, emissiveIntensity: 0.5 }));
  const plate = async (svg: string, at: V3, width: number, rotation = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 460 / 720), new THREE.MeshStandardMaterial({ map: await image(`/assets/decals/${svg}.svg`), color: 0xa29a7c, roughness: 0.9 }));
    m.position.set(...at); m.rotation.y = rotation; scene.add(m); return m;
  };
  await plate('protocol_card', [-0.8, 1.55, -2.32], 0.62); await plate('door_label', [-1.75, 2.2, 2.255], 0.7, Math.PI);
  // The sonar scope: a steel drum, a bezel ring and a round screen, on a stand.
  const brass = new THREE.MeshStandardMaterial({ color: 0x5e4a30, roughness: 0.55, metalness: 0.5 });
  const scope = new THREE.Group(); scope.position.copy(SCOPE_AT); scene.add(scope);
  const drum = new THREE.Mesh(facet(new THREE.CylinderGeometry(0.37, 0.39, 0.16, 40)), steel); drum.rotation.x = Math.PI / 2; drum.castShadow = drum.receiveShadow = true; scope.add(drum);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.028, 10, 48), brass); bezel.position.z = 0.085; scope.add(bezel);
  for (const x of [-0.22, 0.22]) { const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 10), brass); bolt.rotation.x = Math.PI / 2; bolt.position.set(x, -0.27, 0.085); scope.add(bolt); }
  const stand = new THREE.Mesh(facet(new THREE.BoxGeometry(0.16, 0.1, 0.14)), steel); stand.position.set(0, -0.37, 0); scope.add(stand);
  // The wall status unit: deadline clock, isolation cells and the exposure needle.
  part([0.52, 0.64, 0.05], [-0.8, 2.05, -2.31], steel);

  // ---------- the basement door and the stairs behind it ----------
  const door = await prop('basement_door'); door.position.copy(BASEMENT_AT); own(door); scene.add(door);
  const stairs = await prop('basement_stairs'); stairs.position.copy(BASEMENT_AT); own(stairs); scene.add(stairs);
  const leaf = find(door, 'door_leaf'), leafDent = find(door, 'leaf_dent'), beaconLens = find(door, 'beacon_lens');
  const bolts = [0, 1, 2, 3].map(i => find(door, `lock_bolt_${i}`)), lockLamps = [0, 1, 2, 3].map(i => find(door, `lock_lamp_${i}`));
  const boltRest = bolts.map(b => b?.position.x ?? 0), lever = find(stairs, 'close_lever');
  {
    const label = find(door, 'door_label') as THREE.Mesh | null, { canvas, map } = canvasTexture(124, 30, look), g = canvas.getContext('2d')!;
    g.fillStyle = '#b9b29a'; g.fillRect(0, 0, 124, 30); g.fillStyle = '#1b1c18'; g.font = 'bold 19px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BASEMENT', 62, 16);
    if (label) label.material = new THREE.MeshStandardMaterial({ map, roughness: 0.9 });
  }
  // The stairwell side of the doorway carries its own four drop bolts, which shoot home after the slam.
  const innerBolts = BASEMENT_DOOR.lockHeights.map(y => {
    const b = new THREE.Mesh(facet(new THREE.BoxGeometry(0.34, 0.06, 0.06)), steel);
    b.position.set(bx + W + 0.2, y, -2.74); b.castShadow = true; scene.add(b); return b;
  });
  BASEMENT_DOOR.lockHeights.forEach(y => part([0.12, 0.12, 0.08], [bx + W + 0.22, y, -2.74], steel));

  // ---------- the vault at the bottom of the stairs ----------
  const vault = await prop('basement_vault'); vault.position.copy(VAULT_AT); own(vault); scene.add(vault);
  const bottomVoid = find(stairs, 'bottom_void'); if (bottomVoid) bottomVoid.visible = false;
  const breachedTank = find(vault, 'tank_breached'), sealedTank = find(vault, 'tank_sealed');
  // glTF keeps no visibility: the breached hatch is bulged, the sealed one flat.
  const breachedBulge = breachedTank && find(breachedTank, 'hatch_bulge'), sealedBulge = sealedTank && find(sealedTank, 'hatch_bulge');
  if (breachedBulge) breachedBulge.visible = true; if (sealedBulge) sealedBulge.visible = false;
  const tankLights = (tank: THREE.Object3D | null) => [0, 1].map(i => tank && find(tank, `status_light_${i}`));
  const breachedLights = tankLights(breachedTank), sealedLights = tankLights(sealedTank), vaultBulb = find(vault, 'vault_lamp_bulb');
  {
    const sign = find(vault, 'vault_sign') as THREE.Mesh | null, { canvas, map } = canvasTexture(256, 128, look), g = canvas.getContext('2d')!;
    g.fillStyle = '#b9b29a'; g.fillRect(0, 0, 256, 128);
    for (const y of [0, 112]) for (let x = -16; x < 256; x += 22) { g.fillStyle = '#1b1c18'; g.beginPath(); g.moveTo(x, y + 16); g.lineTo(x + 11, y); g.lineTo(x + 22, y); g.lineTo(x + 11, y + 16); g.fill(); }
    g.fillStyle = '#1b1c18'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 13px monospace'; g.fillText('SPECIMEN VAULT', 128, 28);
    g.font = 'bold 27px monospace'; g.fillText('KEEP ALL FOUR', 128, 58); g.fillText('LOCKS ENGAGED', 128, 88);
    if (sign) sign.material = new THREE.MeshStandardMaterial({ map, roughness: 0.9 });
  }
  const VAULT_SIGN = VAULT.sign.at, [hx, hz, hyaw] = VAULT.breached;

  // ---------- the creature ----------
  const creature = await prop('shadow_figure'); own(creature); scene.add(creature); creature.rotation.order = 'YXZ';
  // The one the four locks were holding: standing in the vault's far corner.
  const lurker = await prop('shadow_figure'); scene.add(lurker); lurker.rotation.order = 'YXZ'; lurker.scale.setScalar(1.1);
  // Black and a little glossy, so the torch shows its shape but never its skin; two pale glints on
  // the head's front face stay visible when the torch is off.
  const ink = new THREE.MeshStandardMaterial({ color: 0x090b0b, roughness: 0.4, metalness: 0.15 }), eyeGlint = new THREE.MeshBasicMaterial({ color: 0xd6e4dc });
  lurker.traverse(o => { if (o instanceof THREE.Mesh) o.material = ink; });
  for (const x of [-0.055, 0.055]) { const eye = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.02, 0.01), eyeGlint); eye.position.set(x, 2.1, 1.13); eye.rotation.x = 0.5; lurker.add(eye); }
  const claws = await prop('claws'); own(claws); scene.add(claws); claws.rotation.order = 'YXZ';
  const talons = [0, 1, 2, 3].map(i => { const n = find(claws, `talon_${i}`); return n ? { node: n, rest: n.rotation.clone() } : null; });
  const forearm = find(claws, 'forearm');

  // The sealed door: its dent clip creases the leaf at each blow; at the breach the leaf, braces and
  // bolts fall into the room about the threshold. The pivot's inner frame equals the root's, so the
  // clip's local transforms stay valid after the parts are moved under it.
  const sealed = room.sealed_door, sealedRoot = find(sealed, 'sealed_door_root') ?? sealed;
  const hinge = new THREE.Group(), hingeInner = new THREE.Group();
  hinge.position.set(0, 0.07, 0.13); hingeInner.position.set(0, -0.07, -0.13); hinge.add(hingeInner); sealedRoot.add(hinge);
  sealed.updateMatrixWorld(true);
  for (const child of [...sealedRoot.children]) if (child !== hinge && !/^door_(frame|header|threshold|backing)/.test(child.name)) hingeInner.attach(child);
  const backing = find(sealed, 'door_backing');
  const mixer = new THREE.AnimationMixer(sealed), dentClip = clips.sealed_door.find(c => c.name === 'dent');
  const dent = dentClip ? mixer.clipAction(dentClip) : null;
  if (dent) { dent.setLoop(THREE.LoopOnce, 1); dent.clampWhenFinished = true; dent.play(); dent.paused = true; }
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(3, 3.2), new THREE.MeshBasicMaterial({ color: 0x56707a, fog: false }));
  outside.position.set(SEALED_AT.x, 1.5, 3.3); outside.rotation.y = Math.PI; scene.add(outside);

  scene.updateMatrixWorld(true);

  // ---------- screens ----------
  const terminalScreen = find(room.terminal, 'terminal_screen') as THREE.Mesh | null;
  const TERM = worldOf(terminalScreen, [-0.62, 1.2, -1.78]), MON: V3 = [SCOPE_AT.x, SCOPE_AT.y, SCOPE_AT.z + 0.08];
  const term = canvasTexture(192, 120, look);
  if (terminalScreen) terminalScreen.material = new THREE.MeshBasicMaterial({ map: term.map });
  // The scope and the status unit are drawn by the game's own display code (src/render/displays.ts).
  const sonar = createDisplay(768, 768), status = createDisplay(640, 800, false);
  const sonarScreen = new THREE.Mesh(new THREE.CircleGeometry(0.32, 64), new THREE.MeshBasicMaterial({ map: sonar.texture, toneMapped: false })); sonarScreen.position.z = 0.082; scope.add(sonarScreen);
  const statusScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.575), new THREE.MeshBasicMaterial({ map: status.texture, toneMapped: false }));
  statusScreen.position.set(-0.8, 2.05, -2.282); scene.add(statusScreen);

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0x59644c, 0x070807, 0.25); scene.add(hemi);
  const overhead = new THREE.PointLight(0x836342, 2.4, 5, 2); overhead.position.set(0.2, 2.65, -0.65); scene.add(overhead);
  const deskLamp = new THREE.PointLight(0xf09b56, 4.5, 2.8, 2); deskLamp.position.set(-1.28, 1.6, -1.54); scene.add(deskLamp);
  const task = new THREE.SpotLight(0xffb976, 9, 3.4, 0.62, 0.8, 1.8); task.position.set(-1.3, 1.68, -1.62); task.target.position.set(-0.6, 0.95, -1.65);
  task.castShadow = true; task.shadow.mapSize.set(512, 512); scene.add(task, task.target);
  const emergency = new THREE.PointLight(0xda6e36, 1.4, 2.6, 2); emergency.position.set(-0.7, 1.57, 2.18); scene.add(emergency);
  const screenGlow = new THREE.PointLight(0x86d49a, 0.8, 1.8, 2); screenGlow.position.set(0.6, 1.3, -1.4); scene.add(screenGlow);
  const alarmBulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0x330604, emissive: 0xff2a10, emissiveIntensity: 0.3 }));
  alarmBulb.position.set(1.05, 2.3, -2.25); scene.add(alarmBulb);
  const alarm = new THREE.PointLight(0xff2a10, 0, 5, 2); alarm.position.set(1.05, 2.3, -2.05); scene.add(alarm);
  // The beacon on the door motor: two back-to-back spots turning about it.
  const beaconAt = worldOf(find(door, 'beacon'), [bx + 0.66, 2.5, -2.35]);
  const beams = [0, 1].map(() => { const s = new THREE.SpotLight(0xff9530, 0, 9, 0.42, 0.5, 1.2); s.position.copy(beaconAt); scene.add(s, s.target); return s; });
  const beaconGlow = new THREE.PointLight(0xff9530, 0, 2.6, 2); beaconGlow.position.copy(beaconAt).add(new THREE.Vector3(0, 0, 0.25)); scene.add(beaconGlow);
  const doorLamp = new THREE.PointLight(0xd8a060, 3.2, 3.0, 2); doorLamp.position.set(bx + 0.2, 2.2, -1.9); scene.add(doorLamp);
  const shelterRed = new THREE.PointLight(0xff3a20, 0, 3.2, 2); shelterRed.position.set(SEALED_AT.x, 2.65, 1.85); scene.add(shelterRed);
  const clawKey = new THREE.PointLight(0xc8dcff, 0, 2.4, 2); clawKey.position.set(SEALED_AT.x - 0.3, 2.0, 1.55); scene.add(clawKey);
  // Red caged lamps in the stairwell; they show through the gap as soon as it opens.
  const stairLamps = [0, 1].map(i => { const l = new THREE.PointLight(0xff2a14, 0, 4.5, 2); l.position.copy(worldOf(find(stairs, `lamp_${i}_bulb`), [0, 0, 0])); scene.add(l); return l; });
  const squeezeFill = new THREE.PointLight(0xff5a28, 0, 2.6, 2); squeezeFill.position.set(bx + 0.1, 1.9, -3.1); scene.add(squeezeFill);
  const gapSpill = new THREE.PointLight(0xff9530, 0, 2.2, 2); gapSpill.position.set(bx + W - OPEN / 2, 1.7, -1.95); scene.add(gapSpill);
  const slitRed = new THREE.PointLight(0xff3a1a, 0, 5.5, 1.4); slitRed.position.set(bx + W - OPEN / 2, 1.5, -2.65); scene.add(slitRed);
  const rim = new THREE.PointLight(0xa8bcd0, 0, 4.5, 1.5); scene.add(rim);
  const moon = new THREE.PointLight(0x8fa6bc, 0, 9, 1.4); moon.position.set(SEALED_AT.x, 2.1, 2.95); scene.add(moon);
  // The vault's one lamp, dim red on the back wall: enough to rim whatever stands in front of it.
  const vaultRed = new THREE.PointLight(0xff2a14, 0, 6.5, 1.4); vaultRed.position.copy(VAULT_AT).add(new THREE.Vector3(2.3, 2.2, -VAULT.depth + 0.35)); scene.add(vaultRed);
  const flashlight = new THREE.SpotLight(0xfff1d6, 0, 14, 0.42, 0.55, 1.6);
  flashlight.position.set(0.18, -0.22, -0.4); flashlight.target.position.set(0.02, -0.4, -6); flashlight.castShadow = true; flashlight.shadow.mapSize.set(512, 512); flashlight.shadow.bias = -0.0015;
  camera.add(flashlight, flashlight.target);
  // Torch spill: what the beam's edge and its bounce show of the room around the hot spot.
  const spill = new THREE.PointLight(0xffe8c8, 0, 6, 2); spill.position.set(0.1, -0.1, -0.3); camera.add(spill);
  const arms = await prop('fp_arms'); camera.add(arms); own(arms);
  arms.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
  const fpArm = (n: string) => { const node = find(arms, n); return node ? { node, rest: node.rotation.clone() } : null; };
  const armL = fpArm('arm_l'), armR = fpArm('arm_r'), lens = find(arms, 'flashlight_lens'), armRestZ = armL?.node.position.z ?? 0;
  const unlitVoid = new THREE.MeshBasicMaterial({ color: 0x000000 }), unlitTorch = new THREE.MeshBasicMaterial({ color: 0x15191b });
  scene.traverse(o => { if (o instanceof THREE.Mesh && (o.material as THREE.Material).name === 'void') o.material = unlitVoid; });
  find(arms, 'flashlight')?.traverse(o => { if (o instanceof THREE.Mesh && o.name !== 'flashlight_lens') o.material = unlitTorch; });

  // Dust shaken loose by the blows, and the cloud the breach blows in.
  const puff = puffTexture(), dust: { sprite: THREE.Sprite; at: THREE.Vector3; born: number; drift: THREE.Vector3; life: number; size: number; peak: number }[] = [];
  const emit = (at: THREE.Vector3, born: number, count: number, seed: number, drift: (r: () => number) => THREE.Vector3, life = 2, size = 1, peak = 0.3, spacing = 0.05) => {
    const r = rng(seed);
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0x8c7d68, transparent: true, depthWrite: false, opacity: 0 }));
      scene.add(sprite); dust.push({ sprite, at: at.clone().add(new THREE.Vector3((r() - 0.5) * 0.9, 0, (r() - 0.5) * 0.3)), born: born + i * spacing, drift: drift(r), life, size, peak });
    }
  };
  const fall = (r: () => number) => new THREE.Vector3((r() - 0.5) * 0.3, -0.5 - r() * 0.5, (r() - 0.5) * 0.3);
  for (const [at, seed] of [[B.hit1, 61], [B.hit2, 62], [B.hit3, 63]] as const) emit(new THREE.Vector3(SEALED_AT.x, 2.85, 2.2), at + 0.03, 6, seed, fall, 2.2, 0.9, 0.28);
  emit(new THREE.Vector3(-0.4, 2.9, -0.6), B.hit1 + 0.05, 5, 64, fall, 2.4, 1.1, 0.2);
  emit(new THREE.Vector3(bx - 0.3, 2.1, -2.3), B.crack, 5, 65, r => new THREE.Vector3(0.2 + r() * 0.3, -0.2 - r() * 0.3, 0.3 + r() * 0.3), 1.6, 0.6, 0.25);
  emit(new THREE.Vector3(SEALED_AT.x, 1.3, 2.3), B.breach + 0.02, 14, 66, r => new THREE.Vector3((r() - 0.5) * 1.6, (r() - 0.3) * 0.6, -1.2 - r() * 1.5), 2.6, 2.2, 0.32, 0.03);
  emit(new THREE.Vector3(bx + W - 0.1, 1.2, -2.75), B.shut + 0.02, 6, 67, r => new THREE.Vector3((r() - 0.5) * 0.4, (r() - 0.5) * 0.5, -0.5 - r() * 0.5), 1.6, 0.6, 0.3);
  for (const [at, seed] of [[B.pound1, 68], [B.pound2, 69]] as const) emit(new THREE.Vector3(bx, 2.35, -2.95), at + 0.03, 5, seed, fall, 2, 0.6, 0.26);

  // Full-frame fade attached to the camera.
  const fade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthTest: false, depthWrite: false }));
  fade.position.z = -0.06; fade.renderOrder = 999; camera.add(fade);
  const fadeMaterial = fade.material as THREE.MeshBasicMaterial;

  await applyLook(scene, look);
  const post = createPost(renderer, look);

  // ---------- camera ----------
  const DOORC: V3 = [bx, 1.05, -2.45], UPPER: V3 = [bx + 0.3, 2.0, -2.4], SEALC: V3 = [SEALED_AT.x, 1.35, 2.3], CORNER: V3 = [SEALED_AT.x - 0.55, 2.3, 2.25];
  const GAPC: V3 = [bx + W - OPEN / 2, 1.2, -2.6], THROUGH: V3 = [bx + W - OPEN / 2, 1.35, -2.4], DOWN: V3 = [bx, -0.6, -5.6];
  const LEVER = worldOf(lever, [bx + 0.6, 1.27, -2.95]);
  // Vault-local points (origin at the vault entrance) in world space.
  const V = (x: number, y: number, z: number): V3 => [VAULT_AT.x + x, VAULT_AT.y + y, VAULT_AT.z + z];
  const HATCH = V(hx + 0.9 * Math.sin(hyaw), 1.2, hz + 0.9 * Math.cos(hyaw)), SIGN = V(VAULT_SIGN[0], VAULT_SIGN[1], VAULT_SIGN[2]), FLOOR = V(-0.35, 0.05, -1.7);
  // Where it stands, and where each flicker of the torch finds it: closer along the line to you.
  const EYE = V(-0.1, 1.6, -0.55), LURK = new THREE.Vector3(...V(1.9, 0, -5.4)), toYou = new THREE.Vector3(EYE[0], LURK.y, EYE[2]).sub(LURK).normalize();
  const lurkAt = (d: number) => LURK.clone().addScaledVector(toYou, d), LURK_HEAD: V3 = [LURK.x + toYou.x * 0.95, LURK.y + 1.75, LURK.z + toYou.z * 0.95];
  const tread = (z: number) => Math.max(-STAIRS.rise * STAIRS.steps, Math.min(0, (z - (BASEMENT_AT.z + STAIRS.landingEnd)) * STAIRS.rise / STAIRS.run));
  const down = (t: number, z: number, ahead: number, extra: Partial<CameraKey> = {}): CameraKey => key(t, [bx + 0.03 * Math.sin(z * 3), tread(z) + 1.6, z], [bx, tread(z - 1.8) + 0.5, z - 1.8 - ahead], 360, { run: 0.32, breath: 0.55, ...extra });
  const rig = new CameraRig([
    // Close on the terminal while the command is typed; the clunk; then the beacon and the door.
    key(0, [-0.36, 1.43, -0.98], TERM, 0),
    key(2.4, [-0.42, 1.41, -1.08], TERM, 0),
    key(B.turnDoor, [-0.44, 1.42, -1.06], TERM, 0),
    key(B.turnDoor + 1.0, [-1.15, 1.58, -0.55], DOORC, 0),
    key(B.crack + 0.4, [-1.4, 1.6, -0.5], DOORC, 15),
    key(B.heard, [-1.45, 1.6, -0.5], UPPER, 15),
    // The growl outside: to the sonar scope, and close on it as the contact comes in.
    key(B.toScope + 0.35, [-0.3, 1.5, -0.9], [0.5, 1.3, -1.8], 0, { breath: 0.3 }),
    key(B.scope, [0.7, 1.43, -0.98], MON, 0),
    key(B.near, [0.71, 1.42, -1.06], MON, 0),
    key(B.near + 0.55, [0.62, 1.46, -0.98], MON, 0, { breath: 0.6 }),
    // Footsteps arriving: spin to the shelter door, hold for the blow, back to the basement door.
    key(B.whip + 0.4, [0.25, 1.55, -0.75], [-2, 1.4, 1.5], 100, { breath: 0.7 }),
    key(B.whip + 1.0, [0.1, 1.58, -0.6], SEALC, 140, { breath: 0.8 }),
    key(B.hit1 + 0.4, [0.08, 1.57, -0.62], SEALC, 147, { breath: 0.9 }),
    key(B.backToDoor + 0.3, [-0.4, 1.58, -0.6], [-1.6, 1.3, -1.9], 100, { breath: 0.9 }),
    key(B.backToDoor + 0.8, [-1.2, 1.58, -0.6], GAPC, 40, { breath: 0.9 }),
    key(B.hit2 + 0.5, [-1.35, 1.58, -0.95], GAPC, 15, { breath: 1 }),
    // Over the shoulder: the claws through the corner. Then the gap is wide enough.
    key(B.lookBack + 0.55, [-1.4, 1.58, -1.05], SEALC, 90, { breath: 1 }),
    key(B.hit3 + 0.9, [-1.42, 1.57, -1.1], CORNER, 174, { breath: 1 }),
    key(B.go + 0.5, [-1.6, 1.57, -1.75], GAPC, 100, { run: 0.4, breath: 1 }),
    // Sideways through the slit, the leaf edge and the jamb sliding past either side.
    key(B.squeeze, [-1.72, 1.56, -2.12], [-1.8, 1.2, -3.4], 19, { roll: 4, breath: 1 }),
    key(B.squeeze + 0.7, [-1.74, 1.53, -2.52], [-2.2, 1.0, -3.6], 4, { roll: 12, breath: 1 }),
    key(B.squeeze + 1.2, [-1.78, 1.55, -2.85], [-1.9, 0.2, -4.5], 20, { roll: 5, breath: 1 }),
    key(B.through, [-1.85, 1.58, -3.2], [-1.9, 0.0, -5.0], 5, { breath: 1 }),
    // Turn round to the slit: the room beyond, the shelter door at its far end.
    key(B.through + 0.5, [-1.86, 1.6, -3.3], [-3.5, 1.4, -3.3], 60, { breath: 1 }),
    key(B.through + 1.0, [-1.86, 1.6, -3.38], THROUGH, 150, { breath: 1 }),
    key(B.breach - 0.2, [-1.86, 1.6, -3.4], THROUGH, 187, { breath: 1 }),
    // A glance down at the lever, the pull, and back to the slit as it drops.
    key(B.lever - 0.15, [-1.84, 1.58, -3.38], LEVER, 200, { breath: 1 }),
    key(B.lever + 0.2, [-1.82, 1.56, -3.36], LEVER, 222, { breath: 1 }),
    key(B.release + 0.12, [-1.84, 1.58, -3.4], THROUGH, 200, { breath: 1 }),
    key(B.shut + 0.6, [-1.86, 1.57, -3.52], THROUGH, 187, { breath: 1 }),
    key(B.pound1 - 0.5, [-1.86, 1.58, -3.46], DOORC, 187, { breath: 1 }),
    key(B.scrape + 1.6, [-1.88, 1.57, -3.56], DOORC, 187, { breath: 0.9 }),
    key(B.turnAway, [-1.9, 1.58, -3.56], DOORC, 187, { breath: 0.9 }),
    // Away from the door and down into the dark.
    key(B.turnAway + 0.8, [-1.95, 1.6, -3.68], DOWN, 300, { breath: 0.8 }),
    down(B.descend, -3.85, 0, { run: 0.2 }),
    down(B.descend + 1.45, -4.95, 0.3),
    down(B.descend + 2.9, -6.05, 0.5),
    down(B.bottom - 0.1, -7.25, 0.8, { run: 0.2 }),
    // The vault: the torch on the wet floor, the burst tank, the sign. Then the breathing, and the
    // turn toward it. Held still while it stands there; nearer each time the torch comes back.
    key(B.bottom + 0.5, [bx, VAULT_AT.y + 1.6, VAULT_AT.z + 0.85], V(-0.3, 0.4, -2.0), 360, { run: 0.15, breath: 0.6 }),
    key(B.enter, V(0, 1.6, 0.15), FLOOR, 380, { breath: 0.6 }),
    key(B.enter + 0.9, V(-0.05, 1.6, -0.15), HATCH, 380, { breath: 0.5 }),
    key(B.sign - 1.0, V(-0.08, 1.59, -0.35), HATCH, 380, { breath: 0.5 }),
    key(B.sign, V(-0.1, 1.6, -0.5), SIGN, 400, { breath: 0.4 }),
    key(B.turn, V(-0.1, 1.6, -0.52), SIGN, 400, { breath: 0.15 }),
    key(B.reveal, EYE, LURK_HEAD, 340, { breath: 0.3 }),
    key(B.flick, V(-0.1, 1.59, -0.58), LURK_HEAD, 340, { breath: 0.4 }),
    key(B.out, V(-0.1, 1.57, -0.62), LURK_HEAD, 340, { breath: 0.6 }),
    key(B.end, V(-0.1, 1.57, -0.62), LURK_HEAD, 340),
  ], [
    { t: B.engage, strength: 0.35 }, { t: B.crack, strength: 0.2 }, { t: B.hit1, strength: 1.3, kick: 0.08 }, { t: B.hit2, strength: 1.0, kick: 0.05 }, { t: B.hit3, strength: 1.2, kick: 0.1 },
    { t: B.breach, strength: 0.7 }, { t: B.release, strength: 0.3 }, { t: B.shut, strength: 1.7, kick: 0.18 },
    ...[0, 0.27, 0.54, 0.81].map(dt => ({ t: B.bolts + dt, strength: 0.15 })),
    { t: B.pound1, strength: 0.9, kick: 0.06 }, { t: B.pound2, strength: 0.8, kick: 0.04 }, { t: B.scrape, strength: 0.2 }, { t: B.pound3, strength: 0.3 }, { t: B.pound4, strength: 0.15 },
    { t: B.flick + 0.12, strength: 0.25 }, { t: B.lunge, strength: 0.9, kick: -0.06 },
  ] satisfies Impact[], STEP_RATE);

  // ---------- per-frame drawing ----------
  const green = '#7dff9a', amber = '#ffb347', red = '#ff3a26';
  function drawTerminal(t: number): void {
    const g = term.canvas.getContext('2d')!, w = term.canvas.width, h = term.canvas.height, engaged = t >= B.engage, open = travelAt(t);
    g.fillStyle = '#031008'; g.fillRect(0, 0, w, h); g.textBaseline = 'top';
    g.fillStyle = green; g.font = 'bold 11px monospace'; g.fillText('BASEMENT ACCESS · SHELTER 04', 6, 5);
    for (let i = 0; i < 4; i++) { g.fillStyle = green; g.fillRect(8 + i * 45, 21, 38, 9); }
    g.font = 'bold 10px monospace'; g.fillText('LOCKS 4/4 RELEASED', 6, 35); g.fillText('DECOY HEARTBEAT: SENT', 6, 48);
    if (!engaged) {
      const typed = '> ENGAGE DOOR MOTOR'.slice(0, Math.max(0, Math.floor((t - B.type) / 0.11) + 1)), cursor = Math.floor(t * 3) % 2 ? '_' : '';
      g.fillStyle = amber; g.font = 'bold 12px monospace'; g.fillText(t >= B.type ? typed + cursor : cursor, 6, 70);
    } else {
      const flash = Math.floor(t * 4) % 2 === 0;
      g.fillStyle = amber; g.font = 'bold 12px monospace'; g.fillText('DOOR MOTOR ENGAGED', 6, 66);
      g.strokeStyle = amber; g.lineWidth = 1; g.strokeRect(6.5, 83.5, w - 13, 9); g.fillRect(8, 85, (w - 16) * open / OPEN, 6);
      g.font = 'bold 10px monospace'; g.fillText(`OPEN ${String(Math.round(open * 100)).padStart(2, '0')} cm`, 6, 96);
      if (flash) { g.fillStyle = red; g.fillText('!! MOTOR NOISE 112 dB !!', 6, 108); }
    }
  }
  // The scope shows the range the sweep last sampled, as in the game, but sweeps every SCOPE.period
  // (the game's display turns once per 4 s of its clock). The status unit's exposure needle swings
  // into the red once the motor runs.
  const BEARING = SCOPE.bearing;
  function drawScreens(t: number): void {
    const sweepClock = 400 + 4 * (t - SCOPE.start) / SCOPE.period;
    drawSonar(sonar, { time: sweepClock, power: 'on', creature: { sensorDistance: contactAt(lastPing(t)), sensorBearing: BEARING } } as RenderState);
    const exposure = track(t, [[0, 38], [B.engage, 40], [B.engage + 1.4, 88], [B.crack + 1, 100]]);
    drawStatus(status, { time: t, power: 'on', survival: { secondsLeft: Math.max(0, Math.round(71 - t)), cells: 1, maxCells: 3, exposure } } as RenderState);
  }

  const flickerOf = (t: number) => {
    for (const [at, len] of [[B.hit1, 0.5], [B.hit2, 0.45], [B.hit3, 0.6], [B.breach, 0.8]] as const) if (t >= at && t < at + len) return hash(Math.floor(t * 40)) > 0.45 ? 1 : 0.12;
    return 1;
  };
  const shake = (t: number, hits: number[], amp: number) => hits.reduce((s, at) => { const dt = t - at; return dt < 0 || dt > 0.8 ? s : s + Math.sin(dt * 70) * amp * Math.exp(-dt * 8); }, 0);

  function renderAt(t: number): void {
    rig.apply(camera, t);
    const fovCut = track(t, [[B.toScope + 0.5, 0], [B.scope, -12], [B.whip - 0.2, -12], [B.whip + 0.1, 0], [B.hit3 + 0.1, 0], [B.hit3 + 0.9, -22], [B.go, -22], [B.go + 0.5, 0]]);
    camera.fov += fovCut; camera.updateProjectionMatrix();

    // The basement door: locks released, the leaf grinding open, then dropped shut and pounded.
    const open = travelAt(t);
    if (leaf) leaf.position.x = -open;
    bolts.forEach((b, i) => { if (b) b.position.x = boltRest[i] + BASEMENT_DOOR.lockTravel; });
    lockLamps.forEach(m => glow(m, 1.8, 0x3dff6e));
    innerBolts.forEach((b, i) => { b.position.x = bx + W + 0.2 - 0.18 * ramp(t, B.bolts + i * 0.27, B.bolts + i * 0.27 + 0.08); });
    if (leafDent) { leafDent.visible = t >= B.pound1; leafDent.scale.set(1, 1, Math.max(0.01, track(t, [[B.pound1, 0.01], [B.pound1 + 0.06, 0.7], [B.pound1 + 0.3, 0.55], [B.pound2, 0.55], [B.pound2 + 0.06, 1.1], [B.pound2 + 0.3, 1]]))); }
    if (lever) lever.rotation.x = -1.25 * ramp(t, B.lever + 0.1, B.release);
    if (leaf) leaf.position.z = shake(t, [B.pound1, B.pound2, B.pound3], 0.012);

    // The shelter door: shaken and creased by each blow, then flung in.
    const crease = track(t, [[B.hit1, 0], [B.hit1 + 0.12, 0.45], [B.hit2, 0.45], [B.hit2 + 0.12, 0.7], [B.hit3, 0.7], [B.hit3 + 0.15, 1]]);
    if (dent && dentClip) { dent.time = crease * dentClip.duration; mixer.update(0); }
    sealed.position.set(SEALED_AT.x + shake(t, [B.hit1, B.hit2, B.hit3], 0.015), 0, SEALED_AT.z + shake(t + 0.05, [B.hit1, B.hit2, B.hit3], 0.02));
    const fallen = t < B.breach ? 0 : Math.min(1.42, 1.42 * Math.pow((t - B.breach) / 0.32, 2)) - (t > B.breach + 0.32 ? 0.12 * Math.exp(-(t - B.breach - 0.32) * 9) * Math.sin((t - B.breach - 0.32) * 30) : 0);
    hinge.rotation.x = fallen;
    if (backing) backing.visible = t < B.breach;
    outside.visible = t >= B.breach;

    // Claws: through the top corner from the third blow until the breach; then through the slit at the last moment.
    const corner = t >= B.hit3 && t < B.breach, slit = t >= B.shut - 0.22 && t < B.shut + 0.03;
    claws.visible = corner || slit;
    if (corner) {
      const out = ramp(t, B.hit3, B.hit3 + 0.15);
      claws.position.set(SEALED_AT.x - 0.5, 2.34 - 0.04 * Math.sin(t * 9) * ramp(t, B.hit3 + 0.3, B.hit3 + 0.6), SEALED_AT.z + 0.25 - 0.55 * out);
      claws.rotation.set(0.55, Math.PI + 0.4, 0.35 + Math.sin(t * 6) * 0.05);
      claws.scale.setScalar(2);
      const grip = track(t, [[B.hit3, -0.3], [B.hit3 + 0.25, 1.1], [B.hit3 + 0.6, 0.7], [B.hit3 + 0.9, 1.25], [B.go, 1.0], [B.breach, 1.3]]);
      talons.forEach((f, i) => { if (f) f.node.rotation.set(f.rest.x + grip + Math.sin(t * 13 + i * 1.7) * 0.06, f.rest.y, f.rest.z); });
      if (forearm) forearm.scale.z = 1;
    } else if (slit) {
      const reach = ramp(t, B.shut - 0.22, B.shut - 0.06), edge = bx + W - open; // the hand thrusts through the closing slit
      claws.position.set(Math.max(edge + 0.07, bx + W - 0.1), 1.32, -2.2 - 0.45 * reach);
      claws.rotation.set(0.05, Math.PI, 0); claws.scale.setScalar(1.3);
      talons.forEach((f, i) => { if (f) f.node.rotation.set(f.rest.x - 0.35 + 0.15 * Math.sin(t * 20 + i), f.rest.y, f.rest.z); });
      if (forearm) forearm.scale.z = 1.6;
    }

    // The creature: in through the broken doorway and straight across the room at the slit.
    creature.visible = t >= B.breach + 0.05 && t < B.shut + 0.05;
    if (creature.visible) {
      const k = clamp01((t - B.breach - 0.05) / (B.shut - B.breach - 0.2)), z = 3.0 - 2.85 * Math.pow(k, 1.15), stride = Math.sin(t * Math.PI * 2 * 3.2);
      creature.position.set(bx + W - OPEN / 2 + 0.25 * (1 - k), Math.abs(stride) * 0.1, z);
      creature.rotation.set(0.35 + 0.15 * k, Math.PI, stride * 0.06);
      creature.scale.set(stride < 0 ? -1.05 : 1.05, 1.05, 1.05);
    }

    // Lights: the room, the beacon, the blows' flicker, the moonlight through the breach, the stairwell.
    const flicker = flickerOf(t), engaged = t >= B.engage, roomOn = t < B.shut;
    const sag = 1 - 0.45 * ramp(t, B.hit1, B.hit1 + 0.4) - 0.3 * ramp(t, B.hit2, B.hit2 + 0.4);
    overhead.intensity = roomOn ? 2.4 * flicker * sag * (t >= B.hit2 ? 0.4 : 1) : 0;
    deskLamp.intensity = roomOn ? 4.5 * flicker * sag : 0; task.intensity = roomOn ? 9 * flicker * sag : 0; glow(lampFace, roomOn ? 0.5 * flicker * sag : 0);
    doorLamp.intensity = roomOn ? 3.2 * flicker : 0;
    emergency.intensity = roomOn ? 1.4 : 0; screenGlow.intensity = roomOn ? 0.8 * flicker : 0;
    const siren = engaged ? 0.15 + 0.85 * pulse(t, 0.9, 4) : 0;
    alarm.intensity = roomOn ? 2.5 * siren : 0; glow(alarmBulb, 0.3 + 2.6 * siren);
    shelterRed.intensity = roomOn && engaged ? 3.5 * siren * flicker : 0;
    clawKey.intensity = t >= B.hit3 && t < B.breach ? 5 * (0.85 + 0.15 * hash(Math.floor(t * 20))) : 0;
    const spin = (t - B.engage) * Math.PI * 2 * 1.1;
    beams.forEach((b, i) => {
      const a = spin + i * Math.PI;
      b.intensity = engaged && t < B.release ? 30 : 0;
      b.target.position.copy(beaconAt).add(new THREE.Vector3(Math.cos(a) * 3, -0.55, Math.sin(a) * 3 + 0.8));
    });
    beaconGlow.intensity = engaged && t < B.release ? 3 + 2 * pulse(t, 1.1, 2) : 0;
    glow(beaconLens, engaged && t < B.release ? 1.4 + 2.0 * pulse(t, 2.2, 3) : 0.15);
    moon.intensity = t >= B.breach ? 18 * ramp(t, B.breach, B.breach + 0.15) : t >= B.hit3 ? 1 : 0;
    const red = t < B.crack ? 0 : t < B.through ? 1.5 + 3.5 * open / OPEN : 3.2;
    squeezeFill.intensity = 6 * ramp(t, B.squeeze - 0.3, B.squeeze) * (1 - ramp(t, B.through, B.through + 0.6));
    gapSpill.intensity = 5 * ramp(t, B.go, B.squeeze) * (1 - ramp(t, B.through, B.through + 0.4));
    slitRed.intensity = t < B.shut ? 5 * ramp(t, B.breach, B.breach + 0.3) : 0;
    rim.intensity = creature.visible ? 7 : 0; rim.position.copy(creature.position).add(new THREE.Vector3(0.3, 2.8, 1.1));
    stairLamps.forEach((l, i) => { l.intensity = (i === 0 ? red : t > B.turnAway ? 5 : 0.4 * red) * (0.92 + 0.08 * hash(Math.floor(t * 9) + i * 13)); });
    // Once the door is shut the flashlight comes on for the way down. In the vault it fails: off,
    // back on with the shape nearer, off again, on as it lunges, then gone.
    const dark = (t >= B.flick && t < B.flick + 0.12) || (t >= B.lunge - 0.08 && t < B.lunge);
    const torch = t >= B.turnAway + 0.5 && t < B.out && !dark;
    flashlight.intensity = torch ? 26 * (0.96 + 0.04 * hash(Math.floor(t * 24))) : 0;
    flashlight.angle = t >= B.bottom ? 0.56 : 0.42; flashlight.penumbra = t >= B.bottom ? 0.75 : 0.55;
    spill.intensity = torch ? (t >= B.bottom - 0.5 ? 1.1 : 0.3) : 0;
    glow(lens, torch ? 2.5 : 0.05);
    fog.density = t < B.through ? 0.055 : 0.08;

    // Arms: the left hand reaches for the lever; the right holds the torch on the stairs.
    arms.visible = t >= B.lever - 0.35 && t < B.out;
    const reach = ramp(t, B.lever - 0.3, B.lever + 0.05) * (1 - ramp(t, B.release + 0.2, B.release + 0.7)), pull = ramp(t, B.lever + 0.1, B.release);
    const holding = ramp(t, B.turnAway + 0.2, B.turnAway + 0.6), stride = Math.sin(Math.PI * t * STEP_RATE) * ramp(t, B.descend, B.descend + 0.4);
    if (armL) { armL.node.rotation.set(armL.rest.x - 0.9 + reach * 1.45 - pull * 0.45, armL.rest.y - reach * 0.6, armL.rest.z); armL.node.position.z = armRestZ - 0.3 * reach; }
    if (armR) armR.node.rotation.set(armR.rest.x - 0.9 + holding * 0.8 - stride * 0.06, armR.rest.y, armR.rest.z);

    // Screens (the room is out of sight once the basement door is shut).
    if (t < B.shut + 1) { drawTerminal(t); term.map.needsUpdate = true; drawScreens(t); }

    // The vault: the burst tank's lights blink red, the sealed one's glow steady. The shape stands
    // at the back, rimmed by the red lamp, and comes at you between flickers of the torch.
    breachedLights.forEach(l => glow(l, 0.3 + 1.6 * pulse(t, 0.7, 6), 0xff2a1a)); sealedLights.forEach(l => glow(l, 0.9));
    glow(vaultBulb, 0.6 + 0.15 * hash(Math.floor(t * 7)));
    vaultRed.intensity = t >= B.bottom - 1 && t < B.out ? 3.2 * (0.9 + 0.1 * hash(Math.floor(t * 7) + 5)) : 0;
    lurker.visible = t >= B.turn && t < B.out;
    if (lurker.visible) {
      const near = t >= B.lunge ? 2.4 + 0.7 * ramp(t, B.lunge, B.out) : t >= B.flick + 0.12 ? 1.9 : 0;
      lurker.position.copy(lurkAt(near));
      lurker.rotation.set(t >= B.lunge ? 0.45 : 0.08, Math.atan2(toYou.x, toYou.z), t < B.flick ? 0.12 * ramp(t, B.reveal + 0.2, B.flick) : 0.05);
    }

    // Dust.
    for (const d of dust) {
      const age = t - d.born, m = d.sprite.material as THREE.SpriteMaterial;
      if (age < 0 || age > d.life) { m.opacity = 0; d.sprite.visible = false; continue; }
      const k = age / d.life;
      d.sprite.visible = true; d.sprite.position.copy(d.at).addScaledVector(d.drift, age * (1.2 - k * 0.5)); d.sprite.scale.setScalar(0.2 + k * d.size);
      m.opacity = d.peak * (1 - k) * ramp(age, 0, 0.12) * ramp(d.sprite.position.distanceTo(camera.position), 0.3, 1.2);
    }

    fadeMaterial.opacity = t >= B.out ? 1 : 1 - ramp(t, 0, 0.9);
    post.render(scene, camera, t);
  }

  return {
    scene, camera, renderAt,
    dispose() { scene.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); sonar.texture.dispose(); status.texture.dispose(); post.dispose(); renderer.dispose(); },
  };
}
