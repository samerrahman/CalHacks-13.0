import * as THREE from 'three';
import { box, group, mesh } from '../style';

// First-person viewmodel in camera space (origin = camera, forward = −Z, up = +Y). Kept very
// simple and dark so it never draws the eye: a sleeve and a gloved hand per arm, and the
// flashlight in the right hand. Contract: PROPS.fp_arms in ./index.ts.
// arm_* pivot near the elbows (out of frame); negative rotation.x lowers an arm out of view.

export function buildFpArms(): THREE.Group {
  const lens = box(0.03, 0.03, 0.01, 'flashlight_lens', [0, 0, -0.225], 'flashlight_lens');
  const body = mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.22, 6).rotateX(Math.PI / 2).translate(0, 0, -0.11), 'metal_dark');
  const flashlight = group('flashlight', body, lens);

  const handR = group('hand_r', box(0.075, 0.06, 0.1, 'glove', [0, -0.01, 0.01]), flashlight);
  handR.position.set(-0.12, 0.22, -0.4);
  const armR = group('arm_r', box(0.09, 0.09, 0.42, 'deep_steel', [-0.06, 0.11, -0.2]), handR);
  armR.position.set(0.32, -0.5, -0.02);

  const handL = group('hand_l', box(0.08, 0.025, 0.11, 'glove', [0, 0, -0.02]));
  handL.position.set(0.11, 0.2, -0.4);
  const armL = group('arm_l', box(0.09, 0.09, 0.42, 'deep_steel', [0.055, 0.1, -0.2]), handL);
  armL.position.set(-0.33, -0.52, 0);

  return group('fp_arms', armL, armR);
}
