import * as THREE from 'three';
import { box, group } from '../style';

// A colleague in a lab coat: blocky and featureless, about 150 triangles. Contract: PROPS.researcher
// in ./index.ts. Origin on the ground between the feet, facing +Z, about 1.75 tall.
// Joints are groups at their pivots so the scene can pose them: body (hips), torso (waist),
// head (neck), arm_l / arm_r (shoulders), leg_l / leg_r (hips). Positive rotation.x on a limb
// swings it forward (toward +Z); on torso it leans forward.

export function buildResearcher(): THREE.Group {
  const leg = (side: number) => {
    const g = group(side > 0 ? 'leg_l' : 'leg_r',
      box(0.13, 0.82, 0.14, 'cable', [0, -0.41, 0]),
      box(0.13, 0.07, 0.24, 'rubber', [0, -0.835, 0.04]));
    g.position.set(side * 0.1, 0.87, 0);
    return g;
  };
  const arm = (side: number) => {
    const g = group(side > 0 ? 'arm_l' : 'arm_r',
      box(0.1, 0.58, 0.11, 'labcoat', [0, -0.29, 0]),
      box(0.08, 0.1, 0.09, 'skin', [0, -0.63, 0]));
    g.position.set(side * 0.27, 0.56, 0);
    return g;
  };
  const clipboard = box(0.22, 0.3, 0.02, 'paper', [0, -0.62, 0.08], 'clipboard');
  const armR = arm(-1); armR.add(clipboard);
  const head = group('head',
    box(0.2, 0.24, 0.22, 'skin', [0, 0.14, 0]),
    box(0.22, 0.08, 0.24, 'rubber', [0, 0.28, -0.01]));
  head.position.y = 0.62;
  const torso = group('torso',
    box(0.44, 0.62, 0.24, 'labcoat', [0, 0.3, 0]),
    head, arm(1), armR);
  const skirt = box(0.46, 0.4, 0.26, 'labcoat', [0, -0.12, 0]); // coat tails to the knee
  const body = group('body', skirt, torso);
  body.position.y = 0.87;
  return group('researcher', body, leg(1), leg(-1));
}
