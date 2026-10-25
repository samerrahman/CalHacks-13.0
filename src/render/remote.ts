import * as THREE from 'three';
import { createDisplay, drawRemote } from './displays';
import type { RenderState } from './state';

export type RemoteTarget = 'remote' | 'quiet' | 'restore';

/** First-person right hand holding the isolation remote. It rides on the camera: resting in the
 * lower-right corner, raised to the centre when opened, and lowered out of view during inspection.
 * Built from primitives; every mesh is tagged with `userData.lockInRemote` for picking. */
export function createRemote() {
  const group = new THREE.Group(), body = new THREE.Group(); group.name = 'player_remote'; group.add(body);
  const skin = new THREE.MeshStandardMaterial({ color: 0x9a7559, roughness: .85, flatShading: true });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x1b201b, roughness: .95 });
  const shell = new THREE.MeshStandardMaterial({ color: 0x272b22, roughness: .55, metalness: .25 });
  const bezel = new THREE.MeshStandardMaterial({ color: 0x0d0f0b, roughness: .4 });
  const quietCap = new THREE.MeshStandardMaterial({ color: 0xb4562a, emissive: 0xd8632c, emissiveIntensity: 0, roughness: .45 });
  const restoreCap = new THREE.MeshStandardMaterial({ color: 0x55703a, emissive: 0x8fb45a, emissiveIntensity: 0, roughness: .45 });
  const ledOn = new THREE.MeshBasicMaterial({ color: 0xa9c06c }), ledOff = new THREE.MeshBasicMaterial({ color: 0x1d2119 });
  const display = createDisplay(512, 384, false);
  function part(geometry: THREE.BufferGeometry, material: THREE.Material, pos: [number, number, number], target: RemoteTarget = 'remote', parent: THREE.Object3D = body, rot: [number, number, number] = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...pos); mesh.rotation.set(...rot); mesh.userData.lockInRemote = target; parent.add(mesh); return mesh;
  }
  // Controller: face points toward +z (the camera when raised).
  part(new THREE.BoxGeometry(.062, .135, .026), shell, [0, 0, 0]);
  part(new THREE.BoxGeometry(.054, .046, .003), bezel, [0, .03, .0135]);
  part(new THREE.PlaneGeometry(.05, .0375), new THREE.MeshBasicMaterial({ map: display.texture, toneMapped: false }), [0, .03, .0152]);
  part(new THREE.CylinderGeometry(.003, .004, .05, 8), shell, [.022, .09, -.004]);
  const leds = [-.012, 0, .012].map(x => part(new THREE.SphereGeometry(.0032, 10, 8), ledOff, [x, .0595, .0135]));
  const quiet = part(new THREE.CylinderGeometry(.0145, .0155, .009, 28), quietCap, [0, -.014, .015], 'quiet', body, [Math.PI / 2, 0, 0]);
  const restore = part(new THREE.CylinderGeometry(.0095, .0105, .007, 24), restoreCap, [0, -.046, .014], 'restore', body, [Math.PI / 2, 0, 0]);
  part(new THREE.TorusGeometry(.0165, .0018, 6, 28), bezel, [0, -.014, .0132]);
  // Blocky right hand: hand block behind the right edge, curled fingers as one block on the left edge,
  // a thumb block on the right edge (clear of the buttons), and a square sleeve.
  part(new THREE.BoxGeometry(.072, .075, .03), skin, [.02, -.058, -.025]);
  part(new THREE.BoxGeometry(.018, .074, .032), skin, [-.038, -.044, -.002]);
  part(new THREE.BoxGeometry(.018, .044, .018), skin, [.039, -.03, .01], 'remote', body, [0, 0, .28]);
  part(new THREE.BoxGeometry(.078, .2, .072), sleeve, [.045, -.17, -.05], 'remote', body, [.35, 0, -.45]);
  // A faint warm glow so the hand reads in the dark room; the screen carries it through blackout.
  const glow = new THREE.PointLight(0xc9905a, .12, .5, 2); glow.position.set(-.04, .05, .14); group.add(glow);

  const rest = { pos: new THREE.Vector3(.14, -.095, -.3), rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(.32, -.42, .12)) };
  const open = { pos: new THREE.Vector3(0, .012, -.27), rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(.05, 0, 0)) };
  const away = { pos: new THREE.Vector3(.2, -.36, -.3), rot: rest.rot };
  group.position.copy(rest.pos); group.quaternion.copy(rest.rot);

  return {
    group,
    /** World positions of the two buttons, for tutorial arrows. */
    anchors(target: THREE.Vector3, which: 'quiet' | 'restore') { return (which === 'quiet' ? quiet : restore).getWorldPosition(target); },
    draw(state: RenderState) { drawRemote(display, state); },
    update(state: RenderState, delta: number, reducedMotion: boolean, inspecting: boolean) {
      const r = state.remote, pose = inspecting ? away : r?.open ? open : rest, blend = reducedMotion ? 1 : 1 - Math.exp(-delta * 9);
      group.position.lerp(pose.pos, blend); group.quaternion.slerp(pose.rot, blend);
      const powered = state.power === 'on', hold = Math.max(0, Math.min(1, r?.restoreHold ?? 0));
      leds.forEach((led, i) => { led.material = i < (r?.cells ?? 0) ? ledOn : ledOff; });
      quietCap.emissiveIntensity = powered && r?.quietReady ? .55 : 0; quiet.position.z = state.power === 'quiet' ? .0115 : .015;
      restoreCap.emissiveIntensity = powered ? 0 : (r?.restoreReady ? (reducedMotion ? .6 : .5 + Math.sin(state.time * 3) * .2) : .08) + hold * .9; restore.position.z = hold > 0 ? .0115 : .014;
      glow.intensity = powered ? .12 : .05;
    },
    dispose() { display.texture.dispose(); },
  };
}
