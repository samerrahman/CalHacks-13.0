import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, group, jitter, mesh, rng, type MaterialKey } from '../style';

// Exit door at the far end of the lab corridor. Contract: PROPS.exit_door in ./index.ts.
//
// Local frame: origin on the floor at the centre of the 1.1 × 2.1 doorway, in the plane of
// the door. The wall section is 3 wide × 2.8 tall and fills z −0.3..0: its inside (corridor)
// face is at z = −0.3, its outside (forest) face at z = 0. The leaf sits flush with the
// outside face and its hinge line is the outside corner of the hinge jamb (x = −0.55, z = 0),
// so rotation.y = −1.4 swings it out toward +Z without passing through the wall.
//
// Seen from the corridor (looking toward +Z) world −X is on the viewer's right, so the hinge
// side is on the right and the latch side, push-bar case and hazard band are on the left.

type P2 = [number, number];
type V3 = [number, number, number];

const HINGE_X = -0.55;
const LEAF = { x0: 0.01, x1: 1.09, y0: 0.03, y1: 2.095, z0: -0.06, z1: -0.005 }; // leaf-local
const WIN = { cx: 0.55, cy: 1.62, w: 0.3, h: 0.4 }; // leaf-local window opening
const WALL_IN = -0.3; // inside face of the wall cladding

// ---------- geometry helpers (geometry is baked into place so small parts merge) ----------

const v2 = (pts: P2[]) => pts.map(([x, y]) => new THREE.Vector2(x, y));
const rect = (x0: number, y0: number, x1: number, y1: number): P2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** Inverted-U outline around a doorway (inner half-width/top, outer half-width/top). */
const uOutline = (hi: number, ti: number, ho: number, to: number, bottom = 0): P2[] =>
  [[-ho, bottom], [-hi, bottom], [-hi, ti], [hi, ti], [hi, bottom], [ho, bottom], [ho, to], [-ho, to]];

function place(g: THREE.BufferGeometry, at: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]): THREE.BufferGeometry {
  return g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)));
}
const boxG = (w: number, h: number, d: number, at: V3, rot?: V3) => place(new THREE.BoxGeometry(w, h, d), at, rot);
/** Box spanning two corners. */
const spanG = (a: V3, b: V3) => boxG(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);

/** Outline in XY extruded from z0 to z1. With a chamfer the outline stays the silhouette and
 * the two faces are inset, so edges catch light as single bevel facets. */
function slabG(outline: P2[], z0: number, z1: number, chamfer = 0, holes: P2[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(v2(outline));
  for (const h of holes) shape.holes.push(new THREE.Path(v2(h)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: z1 - z0 - 2 * chamfer, curveSegments: 1, steps: 1,
    bevelEnabled: chamfer > 0, bevelThickness: chamfer, bevelSize: chamfer, bevelOffset: -chamfer, bevelSegments: 1,
  });
  return g.translate(0, 0, z0 + chamfer);
}

/** Bar with a chamfered rectangular cross-section running along X, centred on `at`. */
function barXG(length: number, h: number, d: number, chamfer: number, at: V3): THREE.BufferGeometry {
  const c = chamfer, y = h / 2, z = d / 2;
  const profile: P2[] = [[-z + c, -y], [z - c, -y], [z, -y + c], [z, y - c], [z - c, y], [-z + c, y], [-z, y - c], [-z, -y + c]];
  const g = slabG(profile, -length / 2, length / 2);
  g.rotateY(Math.PI / 2); // extrusion axis Z → X, profile x → −Z (symmetric)
  return g.translate(...at);
}

/** Flat bar between two points in the XY plane (for sign pictograms). */
function bar2G(a: P2, b: P2, width: number, depth: number, z: number): THREE.BufferGeometry {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) + width * 0.6;
  return boxG(len, width, depth, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z], [0, 0, Math.atan2(dy, dx)]);
}

/** Flat polygon decal at depth z, facing −Z (inside) or +Z (outside). Points are given in
 * the same XY coordinates the decal lands on. */
function decalG(points: P2[], z: number, facing: 1 | -1): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(new THREE.Shape(v2(facing < 0 ? points.map(([x, y]) => [-x, y] as P2) : points)), 1);
  if (facing < 0) g.rotateY(Math.PI);
  return g.translate(0, 0, z);
}
/** Flat polygon on the floor at height y; points are (x, z). */
function floorDecalG(points: P2[], y: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(new THREE.Shape(v2(points.map(([x, z]) => [x, -z] as P2))), 1);
  g.rotateX(-Math.PI / 2);
  return g.translate(0, y, 0);
}

/** Sutherland–Hodgman clip of a convex polygon to an axis-aligned rectangle. */
function clipRect(poly: P2[], x0: number, y0: number, x1: number, y1: number): P2[] {
  let out = poly;
  for (const [axis, v, sign] of [[0, x0, 1], [0, x1, -1], [1, y0, 1], [1, y1, -1]] as const) {
    const input = out; out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length];
      const ina = (a[axis] - v) * sign >= 0, inb = (b[axis] - v) * sign >= 0;
      if (ina) out.push(a);
      if (ina !== inb) { const t = (v - a[axis]) / (b[axis] - a[axis]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    if (!out.length) break;
  }
  return out;
}

/** 45° hazard stripes clipped to a rectangle: lines y = slope·x + c, one stripe per period. */
function stripes(x0: number, y0: number, x1: number, y1: number, period: number, width: number, slope: 1 | -1): P2[][] {
  const cs = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => y - slope * x);
  const lo = Math.min(...cs), hi = Math.max(...cs), polys: P2[][] = [];
  for (let c = lo - (lo % period) - period; c < hi; c += period) {
    const quad: P2[] = [[x0, c + slope * x0], [x1, c + slope * x1], [x1, c + width + slope * x1], [x0, c + width + slope * x0]];
    const p = clipRect(quad, x0, y0, x1, y1);
    if (p.length >= 3) polys.push(p);
  }
  return polys;
}

/** Irregular blob (paint chip, rust patch, grime) around (cx, cy). */
function blob(cx: number, cy: number, rx: number, ry: number, n: number, random: () => number): P2[] {
  const pts: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + random() * 0.5, r = 0.65 + random() * 0.45;
    pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
  }
  return pts;
}

/** Merge many small parts into one faceted mesh (position only; normals come from facet()). */
function merged(parts: THREE.BufferGeometry[], key: MaterialKey, name: string): THREE.Mesh {
  const clean = parts.map(p => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    return g;
  });
  const g = mergeGeometries(clean);
  if (!g) throw new Error(`exit_door: could not merge ${name}`);
  return mesh(g, key, name);
}

// ---------- wall ----------

function buildWall(): THREE.Group {
  // Structural concrete core around a 1.24 × 2.17 rough opening.
  const core = merged([
    spanG([-1.5, 0, -0.28], [-0.62, 2.8, 0]),
    spanG([0.62, 0, -0.28], [1.5, 2.8, 0]),
    spanG([-0.62, 2.17, -0.28], [0.62, 2.8, 0]),
  ], 'concrete', 'wall_core');

  // Corridor-side cladding panels with 1 cm seams showing the concrete behind.
  const cz0 = WALL_IN, cz1 = -0.28, panels: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const xa = s * 1.5, xb = s * 0.7;
    panels.push(spanG([Math.min(xa, xb), 0.16, cz0], [Math.max(xa, xb), 1.24, cz1]));
    panels.push(spanG([Math.min(xa, xb), 1.25, cz0], [Math.max(xa, xb), 2.8, cz1]));
  }
  panels.push(spanG([-0.69, 2.25, cz0], [0.69, 2.8, cz1]));
  const cladding = merged(panels, 'lab_panel', 'wall_cladding');

  const skirting = merged([
    slabG(rect(-1.5, 0, -0.7, 0.15), WALL_IN - 0.01, cz1, 0.006),
    slabG(rect(0.7, 0, 1.5, 0.15), WALL_IN - 0.01, cz1, 0.006),
  ], 'metal_dark', 'wall_skirting');

  // Emergency door-release box on the latch-side wall (viewer's left), hand height.
  const release = merged([
    slabG(rect(0.86, 1.12, 1.02, 1.32), WALL_IN - 0.045, WALL_IN, 0.008),
  ], 'hazard_yellow', 'release_box');
  const releaseButton = mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.02, 7), 'rubber', 'release_button');
  releaseButton.rotation.x = Math.PI / 2;
  releaseButton.position.set(0.94, 1.235, WALL_IN - 0.054);

  const stoopGeom = jitter(new THREE.BoxGeometry(1.7, 0.24, 0.9, 1, 1, 1), 0.03, 4103);
  // Keep the top face flat at y = 0.02 so the swinging leaf (bottom at y = 0.03) never clips it.
  // Pin the back face into the wall so no gap opens at the threshold.
  const sp = stoopGeom.getAttribute('position');
  for (let i = 0; i < sp.count; i++) { if (sp.getY(i) > 0) sp.setY(i, 0.12); if (sp.getZ(i) < 0) sp.setZ(i, -0.47); }
  const stoop = mesh(stoopGeom.translate(0, -0.1, 0.45), 'concrete_dark', 'stoop');

  return group('wall', core, cladding, skirting, release, releaseButton, stoop);
}

// ---------- frame ----------

function buildFrame(): THREE.Group {
  const random = rng(4201);
  const lining = mesh(slabG(uOutline(0.55, 2.1, 0.62, 2.17), WALL_IN, 0), 'steel_teal', 'jamb');
  const casingIn = mesh(slabG(uOutline(0.55, 2.1, 0.69, 2.24), WALL_IN - 0.024, WALL_IN, 0.008), 'steel_teal', 'casing_inside');
  const casingOut = mesh(slabG(uOutline(0.55, 2.1, 0.67, 2.22), 0, 0.016), 'steel_teal', 'casing_outside');
  // Door stop: the leaf closes against it from the outside.
  const stop = mesh(slabG(uOutline(0.535, 2.085, 0.55, 2.1, 0.025), -0.1, -0.062), 'steel_teal', 'door_stop');

  // Threshold plate with sloped edges, extruded along X.
  // Profile x is −z because rotateY(π/2) maps the extrusion axis to X and profile x to −Z.
  const thresholdGeom = slabG([[0.31, 0], [-0.02, 0], [0, 0.025], [0.285, 0.025]], -0.55, 0.55);
  thresholdGeom.rotateY(Math.PI / 2);
  const threshold = mesh(thresholdGeom, 'metal', 'threshold');

  // Hinge knuckles on the hinge line (exposed on the outside, as on any out-swinging door).
  const hinges = [0.3, 1.06, 1.82].map((y, i) => {
    const k = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.15, 6), 'metal', `hinge_${i}`);
    k.position.set(HINGE_X, y, 0);
    return k;
  });
  // Shoe of the door-closer arm, screwed to the soffit of the head frame.
  const shoe = box(0.07, 0.036, 0.07, 'metal_dark', [HINGE_X + 0.72, 2.082, -0.205], 'closer_shoe');

  // Weathered paint: chips down to rust where hands, carts and boots hit the casing.
  const chipZ = WALL_IN - 0.029, chips: THREE.BufferGeometry[] = [];
  const chipAt: [number, number, number, number][] = [
    [0.62, 0.12, 0.03, 0.05], [0.66, 0.42, 0.018, 0.035], [-0.63, 0.08, 0.03, 0.04], [-0.6, 0.62, 0.012, 0.03],
    [0.61, 1.08, 0.02, 0.06], [0.64, 1.55, 0.012, 0.025], [-0.66, 1.35, 0.015, 0.03], [0.25, 2.2, 0.05, 0.016],
    [-0.4, 2.21, 0.035, 0.012], [-0.64, 2.12, 0.025, 0.04],
  ];
  for (const [x, y, rx, ry] of chipAt) chips.push(decalG(blob(x, y, rx, ry, 5, random), chipZ, -1));
  const rust = merged(chips, 'rust', 'frame_rust');

  return group('frame', lining, casingIn, casingOut, stop, threshold, ...hinges, shoe, rust);
}

// ---------- door leaf (all coordinates leaf-local: x from the hinge line) ----------

function buildLeaf(): THREE.Group {
  const random = rng(4301), L = LEAF;
  const hole = rect(WIN.cx - WIN.w / 2, WIN.cy - WIN.h / 2, WIN.cx + WIN.w / 2, WIN.cy + WIN.h / 2);
  const slab = mesh(slabG(rect(L.x0, L.y0, L.x1, L.y1), L.z0, L.z1, 0.006, [hole]), 'metal', 'door_slab');

  // Wired-glass vision panel: glass, a 6 cm wire grid in its mid-plane, steel beads both sides.
  const glass = box(WIN.w + 0.01, WIN.h + 0.01, 0.006, 'glass', [WIN.cx, WIN.cy, (L.z0 + L.z1) / 2], 'window_glass');
  const midZ = (L.z0 + L.z1) / 2, wires: THREE.BufferGeometry[] = [];
  for (let i = -2; i <= 2; i++) {
    const x = WIN.cx + i * 0.06;
    const strip = rect(x - 0.0018, WIN.cy - WIN.h / 2, x + 0.0018, WIN.cy + WIN.h / 2);
    wires.push(decalG(strip, midZ, -1), decalG(strip, midZ, 1));
  }
  for (let j = -3; j <= 3; j++) {
    const y = WIN.cy + j * 0.06;
    const strip = rect(WIN.cx - WIN.w / 2, y - 0.0018, WIN.cx + WIN.w / 2, y + 0.0018);
    wires.push(decalG(strip, midZ, -1), decalG(strip, midZ, 1));
  }
  const wire = merged(wires, 'metal', 'window_wire');
  const beadOutline = rect(WIN.cx - WIN.w / 2 - 0.035, WIN.cy - WIN.h / 2 - 0.035, WIN.cx + WIN.w / 2 + 0.035, WIN.cy + WIN.h / 2 + 0.035);
  const beads = merged([
    slabG(beadOutline, L.z0 - 0.016, L.z0, 0.006, [hole]),
    slabG(beadOutline, L.z1, L.z1 + 0.012, 0, [hole]),
  ], 'metal_dark', 'window_bead');

  // Kick plate, scuffed.
  const kick = mesh(slabG(rect(0.05, 0.05, 1.05, 0.3), L.z0 - 0.006, L.z0, 0.002), 'metal_dark', 'kick_plate');
  const scuffs = merged([
    decalG(blob(0.32, 0.12, 0.09, 0.035, 6, random), L.z0 - 0.011, -1),
    decalG(blob(0.74, 0.17, 0.12, 0.03, 6, random), L.z0 - 0.011, -1),
    decalG(blob(0.55, 0.09, 0.05, 0.02, 5, random), L.z0 - 0.011, -1),
  ], 'concrete_stain', 'kick_scuffs');

  // Hazard band along the latch edge of the inside face.
  const band = { x0: 0.965, x1: 1.065, y0: 0.34, y1: 2.04 };
  const hazardBack = mesh(slabG(rect(band.x0, band.y0, band.x1, band.y1), L.z0 - 0.004, L.z0), 'hazard_black', 'hazard_band');
  const hazard = merged(stripes(band.x0, band.y0, band.x1, band.y1, 0.11, 0.055, 1).map(p => decalG(p, L.z0 - 0.009, -1)), 'hazard_yellow', 'hazard_stripes');

  // Rust bleeding from the window corners and along the bottom rail.
  const rust = merged([
    decalG([[WIN.cx - 0.17, WIN.cy - 0.22], [WIN.cx - 0.15, WIN.cy - 0.22], [WIN.cx - 0.155, WIN.cy - 0.4], [WIN.cx - 0.165, WIN.cy - 0.48]], L.z0 - 0.005, -1),
    decalG([[WIN.cx + 0.15, WIN.cy - 0.22], [WIN.cx + 0.175, WIN.cy - 0.22], [WIN.cx + 0.17, WIN.cy - 0.32], [WIN.cx + 0.16, WIN.cy - 0.36]], L.z0 - 0.005, -1),
    decalG(blob(0.2, 0.345, 0.08, 0.03, 6, random), L.z0 - 0.005, -1),
    decalG(blob(0.86, 0.34, 0.06, 0.025, 5, random), L.z0 - 0.005, -1),
    decalG(blob(0.12, 1.4, 0.025, 0.07, 5, random), L.z0 - 0.005, -1),
  ], 'rust', 'door_rust');

  // Panic hardware: static rail, hinge-end bracket and latch case; the touch bar moves.
  const barY = 1.0;
  const housing = merged([
    spanG([0.1, barY - 0.035, L.z0 - 0.03], [0.8, barY + 0.035, L.z0]),
    slabG(rect(0.055, barY - 0.06, 0.13, barY + 0.06), L.z0 - 0.068, L.z0, 0.01),
    slabG(rect(0.78, barY - 0.072, 0.955, barY + 0.075), L.z0 - 0.078, L.z0, 0.014),
  ], 'metal_dark', 'push_bar_housing');
  const latch = box(0.012, 0.06, 0.03, 'metal_dark', [L.x1 + 0.003, barY, (L.z0 + L.z1) / 2], 'latch_bolt');
  const padZ = L.z0 - 0.03 - 0.0185;
  const pushBar = group('push_bar',
    mesh(barXG(0.64, 0.05, 0.035, 0.009, [0, 0, 0]), 'metal', 'push_bar_pad'),
    box(0.56, 0.02, 0.005, 'rubber', [0, 0, -0.02], 'push_bar_grip'),
  );
  pushBar.position.set(0.455, barY, padZ);

  // Door closer (parallel arm): body on the top rail, arm folded under the head frame.
  const body = mesh(slabG(rect(0.07, 1.945, 0.37, 2.025), L.z0 - 0.062, L.z0, 0.012), 'metal', 'closer_body');
  const spindle = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), 'metal_dark', 'closer_spindle');
  spindle.position.set(0.33, 2.035, L.z0 - 0.03);
  const elbow: V3 = [0.25, 0, -0.04]; // relative to the spindle
  const shoeEnd: V3 = [0.72 - 0.33, 0.018, -0.205 - (L.z0 - 0.03)]; // where the shoe hangs on the soffit
  const armLen = Math.hypot(elbow[0], elbow[2]);
  const arm = group('closer_arm', box(armLen + 0.02, 0.014, 0.018, 'metal_dark', [armLen / 2, 0, 0]));
  arm.position.set(0.33, 2.05, L.z0 - 0.03);
  arm.rotation.y = -Math.atan2(elbow[2], elbow[0]);
  const fdx = shoeEnd[0] - elbow[0], fdz = shoeEnd[2] - elbow[2], foreLen = Math.hypot(fdx, fdz);
  const fore = group('closer_forearm', box(foreLen + 0.02, 0.012, 0.016, 'metal_dark', [foreLen / 2, 0, 0]));
  fore.position.set(armLen, 0.014, 0);
  fore.rotation.y = -Math.atan2(fdz, fdx) - arm.rotation.y;
  arm.add(fore);

  const leaf = group('door_leaf', slab, glass, wire, beads, kick, scuffs, hazardBack, hazard, rust, housing, latch, pushBar, body, spindle, arm);
  leaf.position.set(HINGE_X, 0, 0);
  return leaf;
}

// ---------- exit sign ----------

function buildExitSign(): THREE.Object3D[] {
  const at: V3 = [0, 2.43, WALL_IN - 0.074];
  const housing = mesh(slabG(rect(-0.25, at[1] - 0.115, 0.25, at[1] + 0.115), WALL_IN - 0.07, WALL_IN, 0.012), 'metal_dark', 'exit_sign_housing');
  const conduit = merged([
    place(new THREE.CylinderGeometry(0.013, 0.013, 0.235, 6), [0.16, 2.6625, WALL_IN - 0.02]),
    spanG([0.13, at[1] + 0.105, WALL_IN - 0.05], [0.19, at[1] + 0.135, WALL_IN]),
  ], 'metal_dark', 'exit_sign_conduit');

  // Glowing face; the pictogram is a child so it moves/hides with the sign.
  const sign = box(0.45, 0.19, 0.008, 'exit_green', at, 'exit_sign');
  // Pictogram in viewer coordinates (u right, v up); local x = −u because the face looks −Z.
  const pz = -0.004 - 0.005 - 0.002, D = 0.004;
  const P = ([u, v]: P2): P2 => [-u, v];
  const limbs: [P2, P2, number][] = [
    [[-0.012, -0.006], [0.012, 0.038], 0.024], // torso
    [[0.012, 0.032], [0.036, 0.012], 0.012], [[0.036, 0.012], [0.062, 0.03], 0.011], // front arm
    [[0.006, 0.032], [-0.016, 0.014], 0.012], [[-0.016, 0.014], [-0.038, -0.006], 0.011], // back arm
    [[-0.012, -0.006], [0.018, -0.03], 0.014], [[0.018, -0.03], [0.012, -0.068], 0.012], // front leg
    [[-0.012, -0.006], [-0.03, -0.038], 0.014], [[-0.03, -0.038], [-0.066, -0.05], 0.012], // back leg
  ];
  const figureParts = limbs.map(([a, b, w]) => bar2G(P(a), P(b), w, D, pz));
  const head = P([0.022, 0.06]);
  figureParts.push(place(new THREE.CylinderGeometry(0.0145, 0.0145, D, 7), [head[0], head[1], pz], [Math.PI / 2, 0, 0]));
  const figure = merged(figureParts, 'light_panel', 'exit_sign_figure');
  const doorSym = mesh(slabG(rect(-0.175, -0.072, -0.09, 0.072), pz - D / 2, pz + D / 2, 0, [rect(-0.163, -0.06, -0.102, 0.06)]), 'light_panel', 'exit_sign_door');
  const arrowPts: P2[] = ([[-0.19, -0.012], [-0.13, -0.012], [-0.13, -0.034], [-0.09, 0], [-0.13, 0.034], [-0.13, 0.012], [-0.19, 0.012]] as P2[]).map(P);
  const arrow = mesh(slabG(arrowPts, pz - D / 2, pz + D / 2), 'light_panel', 'exit_sign_arrow');
  sign.add(figure, doorSym, arrow);
  return [housing, conduit, sign];
}

// ---------- floor marking in front of the door (corridor side) ----------

function buildFloorMarking(): THREE.Mesh {
  const x0 = -0.66, x1 = 0.66, z0 = -1.2, z1 = -0.36, b = 0.045, y = 0.006, random = rng(4501);
  const parts = [
    floorDecalG(rect(x0, z0, x1, z0 + b), y),
    floorDecalG(rect(x0, z0 + b, x0 + b, z1), y),
    floorDecalG(rect(x1 - b, z0 + b, x1, z1), y),
    ...stripes(x0 + b + 0.03, z0 + b + 0.03, x1 - b - 0.03, z1, 0.15, 0.055, -1).map(p => floorDecalG(p, y)),
  ];
  // Worn: nudge the outline points a little so the paint edges are not ruler-straight.
  for (const g of parts) {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + (random() - 0.5) * 0.008);
  }
  return merged(parts, 'hazard_yellow', 'floor_marking');
}

export function buildExitDoor(): THREE.Group {
  return group('exit_door', buildWall(), buildFrame(), buildLeaf(), ...buildExitSign(), buildFloorMarking());
}
