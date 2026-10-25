import * as THREE from 'three';
import type { PlayerView } from './player';

type Joints = { legL: number; legR: number; armL: number; armR: number; spreadL: number; spreadR: number; nod: number; glance: number; bob: number };
const REST: Joints = { legL: 0, legR: 0, armL: 0, armR: 0, spreadL: .06, spreadR: -.06, nod: 0, glance: 0, bob: 0 };

export interface Researcher {
  root: THREE.Group;
  /** Places and poses the figure; `dt` blends between poses, so a station change never snaps limbs. */
  update(view: PlayerView, dt: number, seconds: number, reducedMotion: boolean): void;
  triangles: number;
}

/** A blocky researcher for the spectator's CCTV: lab coat, dark trousers, glasses. Plain boxes
 * (under 200 triangles) pivoted at hips, shoulders and neck; nothing is loaded. */
export function createResearcher(): Researcher {
  const material = (color: number, roughness = .85) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
  const coat = material(0x8a867a), trousers = material(0x262a29, .9), skin = material(0x7a604e, .8), dark = material(0x161514, .95), badge = material(0x7f9a78, .6);
  const root = new THREE.Group(), body = new THREE.Group(); root.name = 'spectator_researcher'; root.add(body);
  let triangles = 0;
  const box = (parent: THREE.Object3D, size: [number, number, number], at: [number, number, number], mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat); mesh.position.set(...at); parent.add(mesh); triangles += 12; return mesh;
  };
  const pivot = (x: number, y: number) => { const group = new THREE.Group(); group.position.set(x, y, 0); body.add(group); return group; };
  const legL = pivot(.1, .84), legR = pivot(-.1, .84), armL = pivot(.29, 1.37), armR = pivot(-.29, 1.37), neck = pivot(0, 1.42);
  for (const leg of [legL, legR]) { box(leg, [.15, .78, .17], [0, -.39, 0], trousers); box(leg, [.16, .07, .27], [0, -.805, .04], dark); }
  box(body, [.44, .58, .26], [0, 1.12, 0], coat); box(body, [.47, .24, .28], [0, .74, 0], coat); box(body, [.07, .09, .012], [.12, 1.27, .136], badge);
  for (const arm of [armL, armR]) { box(arm, [.13, .55, .15], [0, -.27, 0], coat); box(arm, [.11, .11, .12], [0, -.6, 0], skin); }
  box(neck, [.25, .27, .25], [0, .16, 0], skin); box(neck, [.27, .08, .27], [0, .32, -.01], dark); box(neck, [.27, .16, .06], [0, .22, -.12], dark); box(neck, [.21, .035, .02], [0, .19, .13], dark);
  // A soft contact shadow keeps the figure on the floor under the camera's flat light.
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.3, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .45, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .004; root.add(shadow); triangles += 12;
  const joints: Joints = { ...REST };

  function target(view: PlayerView, t: number, still: boolean): Joints {
    const wave = (hz: number, phase = 0) => still ? 0 : Math.sin((t * hz + phase) * Math.PI * 2);
    if (view.walking) {
      const swing = Math.sin(view.stride * Math.PI * 2);
      return { ...REST, legL: swing * .55, legR: -swing * .55, armL: -swing * .4, armR: swing * .4, bob: Math.abs(swing) * .025 };
    }
    if (!view.working) return { ...REST, armL: wave(.25) * .03, armR: -wave(.25) * .03, glance: wave(.07, .2) * .45, bob: wave(.25) * .004 };
    // Working: typing at the terminal, tapping the radar screen, or hauling the lever.
    if (view.station === 'terminal') return { ...REST, armL: -1 + wave(3.1) * .07, armR: -1 + wave(3.1, .5) * .07, spreadL: -.12, spreadR: .12, nod: .22 + wave(.3) * .03 };
    if (view.station === 'cameras') return { ...REST, armL: -1.25 + Math.max(0, wave(.9)) * .14, armR: -.35, spreadL: -.18, spreadR: .02, nod: .12, glance: wave(.18) * .12 };
    return { ...REST, armL: -1.35 + (still ? 0 : .3 * (.5 + .5 * wave(.5))), armR: -.2, spreadL: -.03, nod: -.05, bob: still ? 0 : .01 * (.5 + .5 * wave(.5)) };
  }

  return {
    root, get triangles() { return triangles; },
    update(view, dt, seconds, reducedMotion) {
      root.position.set(view.x, 0, view.z); root.rotation.y = view.heading;
      const goal = target(view, seconds, reducedMotion), k = reducedMotion ? 1 : 1 - Math.exp(-12 * Math.max(0, dt));
      for (const key of Object.keys(joints) as (keyof Joints)[]) joints[key] += (goal[key] - joints[key]) * k;
      legL.rotation.x = joints.legL; legR.rotation.x = joints.legR;
      armL.rotation.set(joints.armL, 0, joints.spreadL); armR.rotation.set(joints.armR, 0, joints.spreadR);
      neck.rotation.set(joints.nod, joints.glance, 0); body.position.y = joints.bob;
    },
  };
}
