import * as THREE from 'three';
import { box, group, mesh, type MaterialKey } from '../style';

// The stairwell behind the basement door (ending film only). Contract: PROPS.basement_stairs in
// ./index.ts. Same origin as basement_door: the floor at the centre of the doorway in the wall's
// room-side face; everything here lies toward −Z, behind the 0.2 m wall. A short landing, a
// straight flight down, and a bottom landing that runs on into black. Two caged red lamps, a
// handrail, and the EMERGENCY CLOSE lever on the right wall beside the doorway.

export const STAIRS = { halfWidth: 0.65, ceiling: 2.45, rise: 0.19, run: 0.26, steps: 14, landingEnd: -1.35 } as const;

type V3 = [number, number, number];
const UP = new THREE.Vector3(0, 1, 0);
/** A thin bar from a to b. */
function bar(a: V3, b: V3, r: number, key: MaterialKey): THREE.Mesh {
  const from = new THREE.Vector3(...a), dir = new THREE.Vector3(...b).sub(from);
  const m = mesh(new THREE.CylinderGeometry(r, r, dir.length(), 6), key);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  return m;
}

function cagedLamp(name: string, at: V3, side: 1 | -1): THREE.Group {
  const lamp = group(name, box(0.03, 0.16, 0.12, 'metal_dark', [0, 0, 0]), box(0.08, 0.1, 0.08, 'alarm_red', [side * -0.05, 0, 0], `${name}_bulb`));
  for (const dz of [-0.045, 0.045]) lamp.add(box(0.1, 0.012, 0.012, 'metal_dark', [side * -0.05, 0.055, dz]), box(0.1, 0.012, 0.012, 'metal_dark', [side * -0.05, -0.055, dz]));
  lamp.position.set(...at);
  return lamp;
}

export function buildBasementStairs(): THREE.Group {
  const { halfWidth: W, ceiling: C, rise: R, run: N, steps, landingEnd: L } = STAIRS;
  const drop = R * steps, bottomZ = L - N * steps, bottomY = -drop, wallLength = -bottomZ + 1.5;
  const parts: THREE.Object3D[] = [
    box(2 * W, 0.06, -L - 0.2, 'lab_floor', [0, -0.03, (L - 0.2) / 2]),
    box(2 * W, 0.06, 1.3, 'lab_floor', [0, bottomY - 0.03, bottomZ - 0.65]),
    // Side walls and the end wall of the top landing (above the flight).
    box(0.14, C - bottomY + 0.2, wallLength, 'concrete_dark', [-W - 0.07, (C + bottomY) / 2, -0.2 - wallLength / 2]),
    box(0.14, C - bottomY + 0.2, wallLength, 'concrete_dark', [W + 0.07, (C + bottomY) / 2, -0.2 - wallLength / 2]),
    box(2 * W + 0.28, 0.12, -L - 0.2, 'concrete', [0, C + 0.06, (L - 0.2) / 2]),
    box(2 * W + 0.28, 0.12, 1.4, 'concrete', [0, bottomY + C + 0.06, bottomZ - 0.65]),
    // The bottom runs on into darkness.
    box(2 * W, C, 0.02, 'void', [0, bottomY + C / 2, bottomZ - 1.3]),
  ];
  // The ceiling over the flight follows it down.
  const slope = Math.atan2(drop, N * steps), span = Math.hypot(drop, N * steps);
  const roof = box(2 * W + 0.28, 0.12, span, 'concrete', [0, C + 0.06 - drop / 2, (L + bottomZ) / 2]); roof.rotation.x = -slope;
  parts.push(roof);
  // Grated treads with risers, and a stringer under each side.
  for (let i = 0; i < steps; i++) {
    const y = -(i + 1) * R, z0 = L - i * N;
    parts.push(box(2 * W - 0.04, 0.035, N, 'metal_dark', [0, y - 0.0175, z0 - N / 2]), box(2 * W - 0.04, R, 0.02, 'rust', [0, y + R / 2, z0 - 0.01]));
  }
  for (const side of [-1, 1]) {
    const s = box(0.05, 0.22, span, 'metal_dark', [side * (W - 0.03), -drop / 2 - 0.12, (L + bottomZ) / 2]); s.rotation.x = -slope;
    parts.push(s);
  }
  // Handrail on the right wall: along the landing, then down with the stairs.
  const x = W - 0.06, h = 0.95;
  parts.push(bar([x, h, -0.25], [x, h, L], 0.022, 'metal'), bar([x, h, L], [x, bottomY + h, bottomZ], 0.022, 'metal'));
  for (const [y, z] of [[h, -0.3], [h, L], [bottomY + h, bottomZ]] as [number, number][]) parts.push(bar([x, y, z], [W, y, z], 0.015, 'metal'));
  // A conduit along the landing ceiling.
  parts.push(box(0.05, 0.05, -L - 0.25, 'metal_dark', [-W + 0.09, C - 0.08, (L - 0.2) / 2]), box(0.03, 0.03, -L - 0.25, 'cable', [-W + 0.16, C - 0.06, (L - 0.2) / 2]));

  // EMERGENCY CLOSE: a yellow backplate, a sign and a lever pivoting at its base (rotation.x < 0 pulls it toward the stairs).
  const handle = box(0.035, 0.3, 0.035, 'rust', [0, 0.15, 0]), grip = box(0.05, 0.08, 0.05, 'alarm_red', [0, 0.32, 0], 'close_lever_grip');
  const lever = group('close_lever', handle, grip); lever.position.set(W - 0.05, 1.12, -0.55);
  parts.push(box(0.02, 0.42, 0.22, 'hazard_yellow', [W - 0.01, 1.25, -0.55]), box(0.012, 0.09, 0.26, 'cream', [W - 0.012, 1.55, -0.55], 'close_sign'), lever);

  parts.push(cagedLamp('lamp_0', [-W + 0.02, 2.08, -0.85], -1), cagedLamp('lamp_1', [W - 0.02, bottomY + 2.05, bottomZ - 0.45], 1));
  return group('basement_stairs', ...parts);
}
