import * as THREE from 'three';
import { box, group, mesh, type MaterialKey } from '../style';

// Opaque steel containment vessel. Contract: PROPS.containment_tank in ./index.ts.
// Origin floor centre, front hatch faces +Z, metres. Deliberately low detail: an octagonal
// hull on a plinth, one hazard band, a few pipes to the ceiling and a framed hatch.
// Heights: 0.00–0.30 plinth · 0.30–2.85 hull · 2.85–3.07 top cap · pipes to the ceiling at 3.20.
// The octagon has a flat face toward +Z (apothem HULL_A); the hatch sits flush on that face.

const SEG = 8;
const FLAT = -Math.PI / SEG; // thetaStart that centres a flat face on +Z
const HULL_R = 1.3; // vertex radius
const HULL_A = HULL_R * Math.cos(Math.PI / SEG); // ≈ 1.20, z of the front face
const PLINTH_H = 0.3;
const HULL_TOP = 2.85;
const CAP_TOP = 3.07;
const CEILING = 3.2;

const HATCH_Y = 1.65;
const HATCH_W = 0.9, HATCH_H = 1.12; // opening inside the frame
const FRAME = 0.045; // frame bar width
const PLATE_T = 0.03;

/** Octagonal prism with a flat face on +Z, spanning y0..y1. */
function prism(rTop: number, rBottom: number, y0: number, y1: number, key: MaterialKey, openEnded = false): THREE.Mesh {
  const m = mesh(new THREE.CylinderGeometry(rTop, rBottom, y1 - y0, SEG, 1, openEnded, FLAT), key);
  m.position.y = (y0 + y1) / 2;
  return m;
}

/** Vertical pipe from y0 to y1 at (x, z). */
function pipe(x: number, z: number, r: number, y0: number, y1: number, segs = 6): THREE.Mesh {
  const m = mesh(new THREE.CylinderGeometry(r, r, y1 - y0, segs, 1, true), 'metal_dark');
  m.position.set(x, (y0 + y1) / 2, z);
  return m;
}

function buildBody(): THREE.Group {
  return group('body',
    prism(1.5, 1.55, 0, PLINTH_H, 'metal_dark'),
    prism(HULL_R, HULL_R, PLINTH_H, HULL_TOP, 'metal', true),
    prism(HULL_R + 0.02, HULL_R + 0.02, PLINTH_H, PLINTH_H + 0.12, 'metal_dark', true),
    prism(HULL_R + 0.015, HULL_R + 0.015, 0.62, 0.78, 'hazard_yellow', true),
    prism(HULL_R + 0.02, HULL_R + 0.02, 2.62, HULL_TOP, 'metal_dark', true),
    prism(0.85, HULL_R, HULL_TOP, CAP_TOP, 'metal_dark'),
  );
}

function buildPipes(): THREE.Group {
  const d = (HULL_A + 0.1) * Math.SQRT1_2; // side pipes run up the two back-diagonal faces
  return group('pipes',
    pipe(0, 0, 0.24, CAP_TOP - 0.05, CEILING, 8),
    pipe(0.45, -0.35, 0.09, CAP_TOP - 0.1, CEILING),
    pipe(d, -d, 0.08, PLINTH_H, CEILING),
    pipe(-d, -d, 0.08, PLINTH_H, CEILING),
  );
}

/** Truncated four-sided pyramid: base HATCH_W × HATCH_H at z = 0, flat top pushed toward +Z. */
function bulgeGeometry(): THREE.BufferGeometry {
  const h = 0.17;
  const g = new THREE.CylinderGeometry(0.3, Math.SQRT1_2, h, 4, 1, false, Math.PI / 4);
  g.rotateX(Math.PI / 2); // +Y (top) -> +Z
  g.translate(0, 0, h / 2);
  g.scale(HATCH_W, HATCH_H, 1);
  // Off-centre impact: shift the top face up and slightly right.
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    if (pos.getZ(i) > h / 2) pos.setXY(i, pos.getX(i) + 0.04, pos.getY(i) + 0.08);
  }
  pos.needsUpdate = true;
  return g;
}

function buildHatch(): THREE.Object3D[] {
  const z = HULL_A;
  const fz = z + 0.02; // frame centre (spans z − 0.02 .. z + 0.06)
  const halfW = HATCH_W / 2, halfH = HATCH_H / 2;
  const frame = group('hatch_frame',
    box(HATCH_W + 2 * FRAME, FRAME, 0.08, 'metal_dark', [0, HATCH_Y + halfH + FRAME / 2, fz]),
    box(HATCH_W + 2 * FRAME, FRAME, 0.08, 'metal_dark', [0, HATCH_Y - halfH - FRAME / 2, fz]),
    box(FRAME, HATCH_H, 0.08, 'metal_dark', [-halfW - FRAME / 2, HATCH_Y, fz]),
    box(FRAME, HATCH_H, 0.08, 'metal_dark', [halfW + FRAME / 2, HATCH_Y, fz]),
  );

  // hatch_door pivots on its hinge at the −X edge; rotation.y = −1.9 swings it open toward +Z.
  // It carries the flat panel and the bulged version the thuds punch outward.
  const panel = box(HATCH_W, HATCH_H, PLATE_T, 'metal', [halfW, 0, 0.025 + PLATE_T / 2], 'hatch_panel');
  const bulge = group('hatch_bulge', mesh(bulgeGeometry(), 'metal'));
  bulge.position.set(halfW, 0, 0.025); // base on the panel's back plane; scale.z grows the bulge
  bulge.visible = false;
  const hinges = [-0.32, 0.32].map(y => box(0.05, 0.14, 0.06, 'metal_dark', [0, y, 0.05]));
  const door = group('hatch_door', panel, bulge, ...hinges);
  door.position.set(-halfW, HATCH_Y, z);

  // The opening behind the door is pure black, so nothing inside is ever seen.
  const hole = box(HATCH_W, HATCH_H, 0.03, 'void', [0, HATCH_Y, z - 0.005], 'hatch_hole');

  // Where the claw grips: the non-hinge (+X) side. The wrist sits just inside the dark opening
  // and the hand points out and to the right, so (with the claws prop at the scene's 1.8 scale)
  // the knuckles land on the frame's outer edge and the fingers curl around the hull's corner.
  // Basis: claw +X (finger spread) → up, +Z (fingers) → out-and-right, −Y (curl) → back along the hull.
  const clawMount = group('claw_mount');
  clawMount.position.set(halfW - 0.14, HATCH_Y + 0.08, z - 0.1);
  clawMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 1).normalize(), new THREE.Vector3(1, 0, 1).normalize()));

  return [frame, door, hole, clawMount];
}

function buildLights(): THREE.Mesh[] {
  return [-0.2, 0.2].map((x, i) => box(0.1, 0.06, 0.03, 'screen_teal', [x, 2.44, HULL_A + 0.015], `status_light_${i}`));
}

export function buildContainmentTank(): THREE.Group {
  return group('containment_tank', buildBody(), buildPipes(), ...buildHatch(), ...buildLights());
}
