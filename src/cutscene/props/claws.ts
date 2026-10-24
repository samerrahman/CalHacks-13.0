import * as THREE from 'three';
import { box, group, jitter, mesh, type MaterialKey } from '../style';

// The only part of the monster ever seen: a hand reaching out of the dark to grip the tube's
// doorframe. Contract: PROPS.claws in ./index.ts. Origin at the wrist; +Z points out of the
// opening; the forearm runs back to −Z into the darkness. Each finger talon_0..3 pivots at its
// knuckle and its segments are nested groups, so rotating talon_i.rotation.x curls the whole
// finger (positive curls toward −Y).

/** Tapered limb segment along +Z from z = 0 to z = length. */
function segment(length: number, r0: number, r1: number, key: MaterialKey, sides = 5, seed = 0): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r1, r0, length, sides, 1).rotateX(Math.PI / 2).translate(0, 0, length / 2);
  return mesh(seed ? jitter(g, 0.006, seed) : g, key);
}

function finger(i: number, x: number, scale: number): THREE.Group {
  const lengths = [0.12, 0.1, 0.13].map(l => l * scale);
  const tip = group(`talon_${i}_tip`, segment(lengths[2], 0.03, 0.002, 'talon', 4));
  tip.position.z = lengths[1]; tip.rotation.x = 0.6;
  const middle = group(`talon_${i}_mid`, segment(lengths[1], 0.037, 0.03, 'claw_skin', 5, 40 + i), tip);
  middle.position.z = lengths[0]; middle.rotation.x = 0.5;
  const knuckle = mesh(new THREE.IcosahedronGeometry(0.045, 0), 'creature_flesh');
  const talon = group(`talon_${i}`, knuckle, segment(lengths[0], 0.044, 0.037, 'claw_skin', 5, 30 + i), middle);
  talon.position.set(x, 0, 0.15);
  talon.rotation.set([0.05, 0.18, 0.24, 0.1][i], (x / 0.088) * -0.26, 0); // fanned, unevenly curled
  return talon;
}

export function buildClaws(): THREE.Group {
  const arm = segment(0.95, 0.1, 0.08, 'claw_skin', 6, 11);
  arm.position.z = -0.95;
  const sinews = [-0.03, 0.03].map(x => box(0.02, 0.02, 0.7, 'creature_flesh', [x, 0.08, -0.45]));
  const forearm = group('forearm', arm, ...sinews); // pivots at the wrist: scale.z stretches it back into the dark
  const palm = mesh(jitter(new THREE.BoxGeometry(0.21, 0.08, 0.17, 2, 1, 2), 0.012, 12), 'claw_skin');
  palm.position.set(0, 0, 0.075);
  const fingers = [-0.088, -0.03, 0.03, 0.088].map((x, i) => finger(i, x, i === 0 || i === 3 ? 0.85 : 1));
  return group('claws', forearm, palm, ...fingers);
}
