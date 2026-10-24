import * as THREE from 'three';
import { box, group, mesh, type MaterialKey } from '../style';

// Shadow figure: a vague, near-black silhouette only ever glimpsed through thick fog, rushing
// toward the camera. Deliberately blocky and featureless. Contract: see PROPS in ./index.ts.
// Origin on the ground between the feet, runs toward +Z, about 2.5 m tall.

type V3 = [number, number, number];
const UP = new THREE.Vector3(0, 1, 0);

/** A low-segment tapered prism spanning from `a` to `b` (radii ra at a, rb at b). */
function limb(a: V3, b: V3, ra: number, rb: number, key: MaterialKey = 'creature_skin', sides = 4): THREE.Mesh {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
  const dir = to.clone().sub(from), length = dir.length();
  const geometry = rb > 0
    ? new THREE.CylinderGeometry(rb, ra, length, sides)
    : new THREE.ConeGeometry(ra, length, sides);
  geometry.rotateY(Math.PI / sides); // flat faces front/side instead of a diamond cross-section
  const m = mesh(geometry, key);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  return m;
}

export function buildShadowFigure(): THREE.Group {
  // Key joints (metres). Hips sit just ahead of the origin; the spine bends forward into a hunch.
  const hipL: V3 = [0.16, 1.18, 0.02], hipR: V3 = [-0.16, 1.18, -0.02];
  const kneeL: V3 = [0.17, 0.78, 0.5], footL: V3 = [0.18, 0.04, 0.52];   // leading leg, planted
  const kneeR: V3 = [-0.17, 0.62, -0.18], footR: V3 = [-0.18, 0.2, -0.56]; // trailing leg, pushing off
  const waist: V3 = [0, 1.2, 0.02], chest: V3 = [0, 1.78, 0.3], hump: V3 = [0, 2.36, 0.74];
  const shoulderL: V3 = [0.34, 2.16, 0.8], shoulderR: V3 = [-0.34, 2.14, 0.76];
  const handL: V3 = [0.42, 1.62, 2.05], handR: V3 = [-0.46, 1.38, 1.9];

  const figure = group('figure',
    // pelvis
    box(0.42, 0.2, 0.26, 'creature_skin', [0, 1.2, 0]),
    // legs: long and thin, mid-stride
    limb(hipL, kneeL, 0.1, 0.07),
    limb(kneeL, footL, 0.07, 0.04),
    limb(hipR, kneeR, 0.1, 0.07),
    limb(kneeR, footR, 0.07, 0.04),
    // torso: narrow abdomen into a broad hunched back, leaning hard forward
    limb(waist, chest, 0.2, 0.32),
    limb(chest, hump, 0.32, 0.36),
    // bony shoulder yoke the arms hang from
    box(0.8, 0.16, 0.22, 'creature_skin', [0, 2.15, 0.78]),
    // arms: very long, reaching forward, ending in a tapering claw point
    limb(shoulderL, handL, 0.08, 0.05),
    limb(shoulderR, handR, 0.08, 0.05),
    limb(handL, [0.44, 1.5, 2.45], 0.07, 0),
    limb(handR, [-0.48, 1.24, 2.3], 0.07, 0),
  );

  // small featureless head, thrust forward and slung low below the hump
  const head = box(0.2, 0.26, 0.24, 'creature_skin', [0, 2.16, 1.02]);
  head.rotation.x = 0.5;
  figure.add(head);

  return group('shadow_figure', figure);
}
