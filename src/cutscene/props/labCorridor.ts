import * as THREE from 'three';
import { box, group, jitter, mesh, rng, type MaterialKey } from '../style';

// lab_corridor — 12 m service corridor the researcher sprints down (shot "corridor", t = 11–17 s).
// Contract (./index.ts): interior x −1.2..1.2, y 0..2.6, z 0..12, origin at the floor centre of the
// lab end, open at both ends (lab doorway at z = 0, exit_door prop closes z = 12).
//
// Runner looks toward +Z, so screen-left is +X and screen-right is −X. Layout along the run:
//   z 1     junction box + conduit (+X)
//   z 3     side door 0 (−X)
//   z 4.25  steam_vent_0 on the +X steam pipe flange, gate valve with yellow handwheel
//   z 5     warning sign (−X)
//   z 6     overturned cart + spilled papers on the +X half; clear lane x −1.11..−0.2 on −X
//   z 7.75  steam_vent_1 on the −X main pipe flange
//   z 9     side door 1 (+X)
//   z 10.6  dangling broken cable (+X), z 11 fire cabinet (−X)
// alarm_light_0..5 hang from the ceiling grating at z = 1, 3, … 11.

const L = 12;
const STATIONS = [0.07, 2, 4, 6, 8, 10, L - 0.07]; // pilaster / ceiling-beam frames
const RIBS = [0.4, 0.62, 1.36, 1.58, 1.8];        // horizontal wall-panel ribs (centre heights)
const UP = new THREE.Vector3(0, 1, 0);

type Side = 1 | -1;

/** Box from min/max bounds. */
function bx(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, key: MaterialKey, name?: string): THREE.Mesh {
  return box(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), key, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], name);
}
/** Box against a side wall; a and b are distances from the centreline (|x|). */
function sbx(s: Side, a: number, b: number, y0: number, y1: number, z0: number, z1: number, key: MaterialKey, name?: string): THREE.Mesh {
  return bx(s * a, s * b, y0, y1, z0, z1, key, name);
}

function cylinder(r: number, len: number, seg: number, key: MaterialKey, axis: 'x' | 'y' | 'z', at: [number, number, number], name?: string, open = false): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, open);
  if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  const m = mesh(g, key, name);
  m.position.set(...at);
  return m;
}

function ring(r: number, tube: number, seg: number, key: MaterialKey, axis: 'x' | 'y' | 'z', at: [number, number, number]): THREE.Mesh {
  const g = new THREE.TorusGeometry(r, tube, 3, seg);
  if (axis === 'y') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateY(Math.PI / 2);
  const m = mesh(g, key);
  m.position.set(...at);
  return m;
}

/** Flat convex polygons merged into one single-sided decal mesh facing `normal`. */
function polys(list: THREE.Vector3[][], normal: THREE.Vector3, key: MaterialKey, name?: string): THREE.Mesh {
  const pos: number[] = [], ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (const p of list) for (let i = 1; i < p.length - 1; i++) {
    const a = p[0];
    let b = p[i], c = p[i + 1];
    if (ab.subVectors(b, a).cross(ac.subVectors(c, a)).dot(normal) < 0) [b, c] = [c, b];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = mesh(g, key, name);
  m.castShadow = false;
  return m;
}
const onFloor = (pts: [number, number][], y: number) => pts.map(([x, z]) => new THREE.Vector3(x, y, z));
const rect = (x0: number, x1: number, z0: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/** Clip a convex XZ polygon to xa ≤ x ≤ xb (Sutherland–Hodgman, two planes). */
function clipX(pts: [number, number][], xa: number, xb: number): [number, number][] {
  const cut = (src: [number, number][], inside: (x: number) => boolean, edge: number) => {
    const out: [number, number][] = [];
    src.forEach((cur, i) => {
      const prev = src[(i + src.length - 1) % src.length];
      const hit = (): [number, number] => { const t = (edge - prev[0]) / (cur[0] - prev[0]); return [edge, prev[1] + t * (cur[1] - prev[1])]; };
      if (inside(cur[0])) { if (!inside(prev[0])) out.push(hit()); out.push(cur); } else if (inside(prev[0])) out.push(hit());
    });
    return out;
  };
  return cut(cut(pts, x => x >= xa, xa), x => x <= xb, xb);
}

/** Irregular blob outline (stains, puddles). */
function blob(cx: number, cz: number, rx: number, rz: number, n: number, seed: number): [number, number][] {
  const random = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2, k = 0.7 + random() * 0.45;
    return [cx + Math.cos(a) * rx * k, cz + Math.sin(a) * rz * k] as [number, number];
  });
}

// ─── shell, floor, ceiling ──────────────────────────────────────────────────────────────

function structure(): THREE.Group {
  const g = group('structure',
    bx(-1.32, 1.32, -0.25, -0.12, 0, L, 'concrete_dark', 'floor_slab'),
    bx(-1.32, 1.32, 2.6, 2.75, 0, L, 'concrete_dark', 'ceiling_slab'),
    bx(-1.32, -1.2, -0.25, 2.75, 0, L, 'concrete_dark', 'shell_nx'),
    bx(1.2, 1.32, -0.25, 2.75, 0, L, 'concrete_dark', 'shell_px'),
  );
  // Portal frames: wall pilasters + ceiling beams.
  for (const z of STATIONS) {
    g.add(bx(-1.2, 1.2, 2.48, 2.6, z - 0.07, z + 0.07, 'metal_dark'));
    for (const s of [1, -1] as Side[]) g.add(sbx(s, 1.11, 1.2, -0.07, 2.6, z - 0.07, z + 0.07, 'metal'));
  }
  // Cantilever pipe struts on the interior frames; pipes rest on their top (y 2.26).
  for (const z of STATIONS.slice(1, -1)) for (const s of [1, -1] as Side[]) g.add(sbx(s, 0.66, 1.11, 2.22, 2.26, z - 0.03, z + 0.03, 'metal_dark'));
  // Ceiling grating between the pipe runs: side rails, longitudinal slats, cross members that carry the alarms.
  const grating = group('ceiling_grating');
  for (const s of [1, -1] as Side[]) grating.add(sbx(s, 0.6, 0.65, 2.44, 2.48, 0, L, 'metal_dark'));
  for (let i = 0; i < 8; i++) { const x = -0.56 + i * 0.16; grating.add(bx(x - 0.02, x + 0.02, 2.465, 2.48, 0, L, 'metal_dark')); }
  for (let z = 1; z < L; z += 2) grating.add(bx(-0.6, 0.6, 2.45, 2.465, z - 0.03, z + 0.03, 'metal'));
  g.add(grating);
  return g;
}

function floor(): THREE.Group {
  const g = group('floor', bx(-0.88, 0.88, -0.12, 0, 0, L, 'lab_floor', 'walkway'));
  for (const s of [1, -1] as Side[]) {
    const tag = s > 0 ? 'px' : 'nx';
    // Drain trench along the wall base with a steel grate flush to the floor.
    g.add(sbx(s, 0.88, 1.2, -0.12, -0.07, 0, L, 'mud', `trench_${tag}`));
    const grate = group(`grate_${tag}`);
    for (const a of [0.905, 0.965, 1.025, 1.085]) grate.add(sbx(s, a - 0.009, a + 0.009, -0.035, 0, 0, L, 'metal'));
    const bars: THREE.Vector3[][] = [];
    for (let z = 0.2; z < L; z += 0.4) bars.push([new THREE.Vector3(s * 0.885, -0.035, z), new THREE.Vector3(s * 1.15, -0.035, z), new THREE.Vector3(s * 1.15, 0, z), new THREE.Vector3(s * 0.885, 0, z)]);
    grate.add(polys(bars, new THREE.Vector3(0, 0, -1), 'metal_dark', `grate_bars_${tag}`)); // faces the runner (−Z)
    g.add(grate);
  }
  // Decal layers (≥ 5 mm apart): stains 0.004 · seams/lines/bands 0.009 · stripes/puddle 0.014.
  const stains = [blob(-0.3, 2.2, 0.35, 0.6, 7, 3), blob(0.4, 7.4, 0.3, 0.5, 7, 5), blob(-0.45, 9.6, 0.25, 0.4, 6, 7), blob(0.2, 11.0, 0.4, 0.3, 7, 9)];
  g.add(polys(stains.map(p => onFloor(p, 0.004)), UP, 'concrete_stain', 'floor_stains'));
  const seams = [2, 4, 6, 8, 10].map(z => onFloor(rect(-0.79, 0.79, z - 0.006, z + 0.006), 0.009));
  g.add(polys(seams, UP, 'hazard_black', 'floor_seams'));
  const lines = [1, -1].map(s => onFloor(rect(s * 0.79, s * 0.85, 0.45, L - 0.45), 0.009));
  g.add(polys(lines, UP, 'hazard_yellow', 'hazard_lines'));
  // Diagonal hazard bands at both thresholds.
  const bands: [number, number][] = [[0.15, 0.45], [L - 0.45, L - 0.15]], stripes: THREE.Vector3[][] = [];
  g.add(polys(bands.map(([za, zb]) => onFloor(rect(-0.88, 0.88, za, zb), 0.009)), UP, 'hazard_black', 'hazard_bands'));
  for (const [za, zb] of bands) {
    const d = zb - za;
    for (let x0 = -0.88 - d - 0.12; x0 < 0.88; x0 += 0.24) {
      const clipped = clipX([[x0, za], [x0 + 0.12, za], [x0 + 0.12 + d, zb], [x0 + d, zb]], -0.88, 0.88);
      if (clipped.length >= 3) stripes.push(onFloor(clipped, 0.014));
    }
  }
  g.add(polys(stripes, UP, 'hazard_yellow', 'hazard_stripes'));
  // Glossy puddle under the leaking steam flange — catches the strobes.
  g.add(polys([onFloor(blob(0.5, 4.35, 0.42, 0.55, 9, 11), 0.014)], UP, 'water', 'puddle'));
  return g;
}

// ─── walls ──────────────────────────────────────────────────────────────────────────────

function wall(s: Side, gaps: [number, number][]): THREE.Group {
  const g = group(s > 0 ? 'wall_px' : 'wall_nx');
  const runs: [number, number][] = [];
  let z = 0;
  for (const [a, b] of gaps) { runs.push([z, a]); z = b; }
  runs.push([z, L]);
  for (const [za, zb] of runs) {
    g.add(
      sbx(s, 1.15, 1.2, -0.07, 0.22, za, zb, 'metal_dark'),   // kick plate
      sbx(s, 1.17, 1.2, 0.22, 2.06, za, zb, 'lab_panel'),     // panel skin
      sbx(s, 1.16, 1.17, 0.92, 1.08, za, zb, 'steel_teal'),   // painted waist band
      sbx(s, 1.13, 1.2, 2.06, 2.1, za, zb, 'metal_dark'),     // cap rail
    );
    for (const y of RIBS) g.add(sbx(s, 1.145, 1.17, y - 0.0225, y + 0.0225, za, zb, 'metal'));
  }
  return g;
}

/** Closed steel side door recessed in the wall, blank number plate on the leaf. */
function sideDoor(index: number, s: Side, zc: number): THREE.Group {
  const g = group(`side_door_${index}`);
  const hinge = -1, handle = 1; // hinge toward the lab, handle toward the exit
  g.add(
    sbx(s, 1.12, 1.2, 0, 2.18, zc - 0.555, zc - 0.475, 'metal_dark'),
    sbx(s, 1.12, 1.2, 0, 2.18, zc + 0.475, zc + 0.555, 'metal_dark'),
    sbx(s, 1.12, 1.2, 2.1, 2.18, zc - 0.475, zc + 0.475, 'metal_dark'),
    sbx(s, 1.16, 1.2, 0.01, 2.1, zc - 0.47, zc + 0.47, 'deep_steel', `side_door_${index}_leaf`),
    sbx(s, 1.15, 1.16, 1.36, 1.74, zc - 0.14, zc + 0.14, 'metal_dark'),          // vision panel frame
    sbx(s, 1.145, 1.15, 1.39, 1.71, zc - 0.11, zc + 0.11, 'water'),               // dark wired glass
    sbx(s, 1.15, 1.16, 0.06, 0.3, zc - 0.43, zc + 0.43, 'metal'),                 // kick plate
    sbx(s, 1.15, 1.16, 1.83, 1.99, zc - 0.17, zc + 0.17, 'metal_dark'),           // plate backing
    sbx(s, 1.145, 1.15, 1.845, 1.975, zc - 0.155, zc + 0.155, 'cream', `door_plate_${index}`),
    sbx(s, 1.13, 1.16, 0.95, 1.09, zc + handle * 0.36 - 0.025, zc + handle * 0.36 + 0.025, 'metal'), // rose
    sbx(s, 1.1, 1.13, 1.03, 1.06, zc + handle * 0.36 - 0.13, zc + handle * 0.36 + 0.02, 'metal'),     // lever
  );
  for (const y of [0.3, 1.05, 1.8]) g.add(sbx(s, 1.145, 1.16, y - 0.06, y + 0.06, zc + hinge * 0.47 - 0.012, zc + hinge * 0.47 + 0.012, 'metal'));
  return g;
}

function fireCabinet(s: Side, zc: number): THREE.Group {
  const g = group('fire_cabinet');
  const w = 0.31; // half width
  g.add(
    sbx(s, 1.125, 1.145, 0.8, 1.8, zc - w, zc + w, 'metal_dark'),                 // back
    sbx(s, 0.95, 1.125, 1.775, 1.8, zc - w, zc + w, 'rust'),                      // top
    sbx(s, 0.95, 1.125, 0.8, 0.825, zc - w, zc + w, 'rust'),                      // bottom
    sbx(s, 0.95, 1.125, 0.825, 1.775, zc - w, zc - w + 0.025, 'rust'),            // sides
    sbx(s, 0.95, 1.125, 0.825, 1.775, zc + w - 0.025, zc + w, 'rust'),
    sbx(s, 0.94, 0.95, 1.72, 1.8, zc - w, zc + w, 'rust'),                        // door frame
    sbx(s, 0.94, 0.95, 0.8, 0.88, zc - w, zc + w, 'rust'),
    sbx(s, 0.94, 0.95, 0.88, 1.72, zc - w, zc - w + 0.06, 'rust'),
    sbx(s, 0.94, 0.95, 0.88, 1.72, zc + w - 0.06, zc + w, 'rust'),
    sbx(s, 0.952, 0.956, 0.88, 1.72, zc - w + 0.06, zc + w - 0.06, 'glass', 'fire_cabinet_glass'),
    sbx(s, 0.93, 0.94, 1.25, 1.33, zc + w - 0.05, zc + w - 0.02, 'metal'),        // latch
    sbx(s, 1.16, 1.17, 1.86, 1.98, zc - 0.2, zc + 0.2, 'cream', 'fire_cabinet_sign'),
  );
  // Extinguisher and hose reel inside, seen through the glass.
  const ex = s * 1.04, ez = zc - 0.13;
  g.add(
    cylinder(0.068, 0.44, 8, 'rust', 'y', [ex, 1.07, ez]),
    mesh(new THREE.CylinderGeometry(0.03, 0.068, 0.06, 8).translate(ex, 1.32, ez), 'rust'),
    bx(ex - 0.02, ex + 0.02, 1.35, 1.41, ez - 0.02, ez + 0.02, 'metal_dark'),
    bx(ex - 0.012, ex + 0.012, 1.38, 1.4, ez - 0.02, ez + 0.09, 'metal_dark'),     // lever
    cylinder(0.012, 0.3, 5, 'rubber', 'y', [ex - s * 0.07, 1.17, ez + 0.05]),        // hose
  );
  const rz = zc + 0.13;
  g.add(
    cylinder(0.115, 0.09, 8, 'rubber', 'x', [s * 1.05, 1.47, rz]),
    cylinder(0.04, 0.12, 6, 'metal', 'x', [s * 1.05, 1.47, rz]),
  );
  return g;
}

// ─── services: pipes, cable tray ────────────────────────────────────────────────────────

type Flange = { z: number; key?: MaterialKey };
/** Pipe run along +Z. The group origin is on the pipe axis at z = 0. */
function pipe(name: string, x: number, y: number, r: number, seg: number, key: MaterialKey, flanges: Flange[]): THREE.Group {
  const g = group(name, cylinder(r, L, seg, key, 'z', [0, 0, L / 2], `${name}_run`));
  for (const f of flanges) for (const dz of [-0.022, 0.022]) g.add(cylinder(r * 1.3 + 0.016, 0.026, seg, f.key ?? 'metal_dark', 'z', [0, 0, f.z + dz]));
  g.position.set(x, y, 0);
  return g;
}

function pipes(): THREE.Group[] {
  // +X (screen-left): steam pipe with the leaking flange and a gate valve; return line by the wall.
  const steam = pipe('pipe_steam_px', 0.86, 2.335, 0.075, 8, 'metal', [{ z: 4.25, key: 'rust' }, { z: 9.6 }]);
  for (const z of [3.65, 5.3]) steam.add(cylinder(0.082, 0.08, 8, 'hazard_yellow', 'z', [0, 0, z], undefined, true));
  const valve = group('valve_px',
    box(0.15, 0.15, 0.13, 'metal_dark'),
    cylinder(0.028, 0.08, 6, 'metal_dark', 'y', [0, 0.11, 0]),
    ring(0.065, 0.008, 10, 'hazard_yellow', 'y', [0, 0.16, 0]),
    box(0.13, 0.012, 0.012, 'hazard_yellow', [0, 0.16, 0]),
    box(0.012, 0.012, 0.13, 'hazard_yellow', [0, 0.16, 0]),
  );
  valve.position.set(0, 0, 4.6);
  steam.add(valve);
  const ret = pipe('pipe_return_px', 1.04, 2.305, 0.045, 6, 'rust', [{ z: 6.9 }]);
  // −X (screen-right): big teal main with the second leaking flange, drain line and a conduit.
  const main = pipe('pipe_main_nx', -0.98, 2.36, 0.1, 8, 'steel_teal', [{ z: 2.9 }, { z: 7.75, key: 'rust' }, { z: 10.9 }]);
  const drain = pipe('pipe_drain_nx', -0.76, 2.31, 0.05, 6, 'metal', [{ z: 5.1 }]);
  const conduit = pipe('pipe_conduit_nx', -1.085, 2.15, 0.022, 6, 'metal_dark', []);
  return [steam, ret, main, drain, conduit];
}

function cableTray(): THREE.Group {
  const s = 1;
  const g = group('cable_tray',
    sbx(s, 0.82, 1.1, 2.12, 2.13, 0, L, 'metal'),
    sbx(s, 0.82, 0.832, 2.12, 2.2, 0, L, 'metal'),
    sbx(s, 1.088, 1.1, 2.12, 2.2, 0, L, 'metal'),
  );
  for (const [x, r] of [[0.87, 0.02], [0.93, 0.016], [0.985, 0.022], [1.045, 0.017]] as const) g.add(cylinder(r, L, 5, 'cable', 'z', [x, 2.13 + r, L / 2], undefined, true));
  // A loop that has slipped out of the tray and sags above the cart.
  const droop = new THREE.CatmullRomCurve3([[0.9, 2.15, 6.15], [0.84, 1.98, 6.55], [0.78, 1.8, 7.05], [0.83, 1.95, 7.6], [0.92, 2.15, 8.05]].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  g.add(mesh(new THREE.TubeGeometry(droop, 10, 0.016, 4, false), 'cable', 'cable_droop'));
  // Broken cable hanging from the tray; pivot at the tray so the scene can sway it.
  const hang = new THREE.CatmullRomCurve3([[0, 0, 0], [0.01, -0.2, 0.02], [-0.03, -0.42, 0.0], [-0.02, -0.58, -0.03]].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const dangle = group('cable_dangle',
    mesh(new THREE.TubeGeometry(hang, 8, 0.014, 4, false), 'cable'),
    box(0.03, 0.06, 0.03, 'metal', [-0.02, -0.6, -0.03]),
  );
  dangle.position.set(0.95, 2.12, 10.6);
  g.add(dangle);
  return g;
}

// ─── fixtures ───────────────────────────────────────────────────────────────────────────

/** Caged alarm dome hanging from a grating cross member. Group origin on the floor below it. */
function alarmFixture(i: number, z: number): THREE.Group {
  const y0 = 2.45; // underside of the cross member
  const profile = [new THREE.Vector2(0, -0.12), new THREE.Vector2(0.048, -0.106), new THREE.Vector2(0.071, -0.062), new THREE.Vector2(0.076, 0)];
  const dome = mesh(new THREE.LatheGeometry(profile, 8), 'alarm_red', `alarm_light_${i}`);
  dome.position.set(0, y0 - 0.02, 0);
  dome.castShadow = false;
  const g = group(`alarm_fixture_${i}`,
    cylinder(0.095, 0.02, 8, 'metal_dark', 'y', [0, y0 - 0.01, 0]),
    dome,
    ring(0.09, 0.0055, 8, 'metal_dark', 'y', [0, y0 - 0.07, 0]),
  );
  for (const [x, zz] of [[0.09, 0], [-0.09, 0], [0, 0.09], [0, -0.09]]) g.add(box(0.009, 0.14, 0.009, 'metal_dark', [x, y0 - 0.08, zz]));
  g.add(box(0.189, 0.009, 0.009, 'metal_dark', [0, y0 - 0.15, 0]), box(0.009, 0.009, 0.189, 'metal_dark', [0, y0 - 0.15, 0]));
  g.position.set(0, 0, z);
  return g;
}

function junctionBox(s: Side, zc: number): THREE.Group {
  return group('junction_box',
    sbx(s, 1.0, 1.145, 1.22, 1.62, zc - 0.16, zc + 0.16, 'metal'),
    sbx(s, 0.99, 1.0, 1.25, 1.59, zc - 0.13, zc + 0.13, 'metal_dark'),           // cover
    cylinder(0.018, 0.5, 6, 'metal_dark', 'y', [s * 1.07, 1.87, zc]),             // conduit up to the tray
    polys([[[1.51, -0.06], [1.51, 0.06], [1.56, 0.06], [1.56, -0.06]].map(([y, dz]) => new THREE.Vector3(s * 0.985, y, zc + dz))], new THREE.Vector3(-s, 0, 0), 'hazard_yellow'),
  );
}

function warningSign(s: Side, zc: number): THREE.Group {
  const n = new THREE.Vector3(-s, 0, 0), at = (a: number) => (y: number, dz: number) => new THREE.Vector3(s * a, y, zc + dz);
  const tri = (a: number, inset: number) => [at(a)(1.33 + inset * 0.6, -0.17 + inset), at(a)(1.33 + inset * 0.6, 0.17 - inset), at(a)(1.62 - inset * 1.2, 0)];
  const quad = (a: number, y0: number, y1: number, w: number) => [at(a)(y0, -w), at(a)(y0, w), at(a)(y1, w), at(a)(y1, -w)];
  return group('warning_sign',
    polys([tri(1.14, 0)], n, 'hazard_black'),
    polys([tri(1.135, 0.03)], n, 'hazard_yellow'),
    polys([quad(1.13, 1.42, 1.53, 0.012), quad(1.13, 1.375, 1.397, 0.012)], n, 'hazard_black'),
  );
}

// ─── the obstacle: overturned cart and spill ────────────────────────────────────────────

/** Lab trolley lying on its side: wheels toward +x, top toward −x, length along z, width along +y. */
function cart(): THREE.Group {
  const g = group('cart',
    bx(-0.195, -0.165, 0, 0.5, -0.45, 0.45, 'metal'),           // lower shelf
    bx(-0.835, -0.805, 0, 0.5, -0.45, 0.45, 'metal'),           // upper shelf
    bx(-0.885, -0.835, 0, 0.02, -0.45, 0.45, 'metal_dark'),     // shelf lips
    bx(-0.885, -0.835, 0.48, 0.5, -0.45, 0.45, 'metal_dark'),
    bx(-1.075, -1.05, 0.0, 0.5, -0.45, -0.42, 'rubber'),        // push handle
  );
  for (const y of [0.0125, 0.4875]) {
    for (const z of [-0.4375, 0.4375]) g.add(bx(-0.92, -0.06, y - 0.0125, y + 0.0125, z - 0.0125, z + 0.0125, 'metal'));
    g.add(bx(-1.05, -0.92, y - 0.0125, y + 0.0125, -0.45, -0.425, 'metal'));
  }
  for (const y of [0.045, 0.455]) for (const z of [-0.4, 0.4]) {
    g.add(bx(-0.06, -0.01, y - 0.02, y + 0.02, z - 0.02, z + 0.02, 'metal_dark'));
    g.add(cylinder(0.04, 0.026, 6, 'rubber', 'y', [0.02, y, z]));
  }
  g.position.set(0.96, 0, 6.0);
  g.rotation.y = 0.27;
  return g;
}

function debris(): THREE.Group {
  const g = group('debris');
  const place = (o: THREE.Object3D, x: number, y: number, z: number, ry: number, rx = 0, rz = 0) => { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o; };
  place(box(0.42, 0.24, 0.3, 'steel_teal', [0, 0, 0], 'crate'), 0.62, 0.14, 6.95, 0.7, 0, 0.32);
  place(box(0.42, 0.02, 0.3, 'metal_dark'), 0.5, 0.01, 7.25, 0.9);                       // crate lid
  place(box(0.27, 0.045, 0.31, 'cream', [0, 0, 0], 'binder'), 0.22, 0.0225, 5.3, 0.5);
  place(box(0.27, 0.035, 0.31, 'steel_teal'), 0.35, 0.0175, 7.55, -0.35);
  place(cylinder(0.05, 0.26, 7, 'metal', 'x', [0, 0, 0], 'canister'), 0.12, 0.05, 6.7, -0.8);                    // sample canister
  place(box(0.23, 0.012, 0.32, 'metal_dark', [0, 0, 0], 'clipboard'), -0.5, 0.006, 5.05, 0.25);
  // Papers: crumpled A4 sheets fanned out from the cart, no two overlapping.
  const random = rng(4242), centres: [number, number][] = [];
  for (let tries = 0; centres.length < 18 && tries < 400; tries++) {
    const x = -0.85 + random() * 1.7, z = 4.6 + random() * 3.8;
    if (centres.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < 0.34)) continue;
    if (x > 0.05 && z > 5.45 && z < 6.65 && x < 1.0) continue;                             // under the cart
    if (Math.hypot(x + 0.5, z - 5.05) < 0.3) continue;                                     // clipboard
    centres.push([x, z]);
    const sheet = new THREE.PlaneGeometry(0.21, 0.297, 2, 2).rotateX(-Math.PI / 2);
    const m = mesh(jitter(sheet, 0.016, 100 + centres.length), 'paper');
    m.castShadow = false;
    place(m, x, 0.025, z, random() * Math.PI * 2);
  }
  return g;
}

// ─── assembly ───────────────────────────────────────────────────────────────────────────

function steamVent(i: number, at: [number, number, number], dir: [number, number, number]): THREE.Group {
  const g = group(`steam_vent_${i}`);
  g.position.set(...at);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...dir).normalize()); // local +Z = jet direction
  return g;
}

export function buildLabCorridor(): THREE.Group {
  const root = group('lab_corridor',
    structure(),
    floor(),
    wall(1, [[9 - 0.555, 9 + 0.555]]),
    wall(-1, [[3 - 0.555, 3 + 0.555]]),
    ...pipes(),
    cableTray(),
    sideDoor(0, -1, 3),
    sideDoor(1, 1, 9),
    fireCabinet(-1, 11),
    junctionBox(1, 1),
    warningSign(-1, 5),
    cart(),
    debris(),
  );
  for (let i = 0; i < 6; i++) root.add(alarmFixture(i, 1 + i * 2));
  // Steam jets leave the leaking flange gaps, aimed inward and down across the run.
  root.add(steamVent(0, [0.807, 2.282, 4.25], [-0.75, -0.6, 0.1]));
  root.add(steamVent(1, [-0.909, 2.289, 7.75], [0.75, -0.6, -0.1]));
  return root;
}
