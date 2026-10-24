import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { group, jitter, mesh, rng, type MaterialKey } from '../style';

// FOREST KIT — night pine forest the camera runs through (t = 18–31 s).
// Contracts: see PROPS in ./index.ts. Everything is built from THREE primitives that are
// re-shaped in place, then merged per material so each prop is a handful of draw calls.

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const TAU = Math.PI * 2;
const lerp = THREE.MathUtils.lerp;
/** 0 below a, 1 above b, smooth in between. */
const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

type SweepOptions = {
  /** The last spine point is a cone tip (no wasted triangles there). */
  tip?: boolean;
  /** No end caps. */
  open?: boolean;
  /** Direction the cross-section's second axis should lean toward (default +Y). */
  hint?: THREE.Vector3;
  /** Per-vertex tweak: ring index (0 = first spine point), index around the ring, and whether it is
   * a cap centre → [radius scale, offset along the spine tangent]. Must be deterministic. */
  mod?: (ring: number, around: number, centre: boolean) => [number, number];
};

/** A CylinderGeometry bent along a spine: ring i sits at spine[i] with radius radii[i]
 * (number, or [side, up] for an elliptical section). Used for trunks, roots, branches, logs, fronds. */
function sweep(spine: THREE.Vector3[], radii: Array<number | [number, number]>, radial: number, o: SweepOptions = {}): THREE.BufferGeometry {
  const segs = spine.length - 1;
  const g = new THREE.CylinderGeometry(o.tip ? 0 : 1, 1, 1, radial, segs, o.open ?? false);
  const frames = spine.map((_, i) => {
    const t = spine[Math.min(segs, i + 1)].clone().sub(spine[Math.max(0, i - 1)]).normalize();
    let hint = o.hint ?? UP;
    if (Math.abs(t.dot(hint)) > 0.95) hint = Math.abs(t.y) > 0.7 ? V(0, 0, 1) : UP;
    const n = t.clone().cross(hint).normalize();
    return { t, n, b: n.clone().cross(t) };
  });
  const pos = g.getAttribute('position');
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
    const i = Math.round((y + 0.5) * segs);
    const ringR = o.tip ? 1 - i / segs : 1;
    const rr = ringR > 1e-6 ? Math.hypot(x, z) / ringR : 0;
    const theta = Math.atan2(x, z);
    const around = Math.round((((theta + TAU) % TAU) / TAU) * radial) % radial;
    const rad = radii[Math.min(i, radii.length - 1)];
    const [rx, rz] = typeof rad === 'number' ? [rad, rad] : rad;
    const [s, along] = o.mod ? o.mod(i, around, rr < 0.5) : [1, 0];
    const f = frames[i], c = spine[i];
    const a = Math.sin(theta) * rr * rx * s, b = Math.cos(theta) * rr * rz * s;
    pos.setXYZ(k, c.x + f.n.x * a + f.b.x * b + f.t.x * along, c.y + f.n.y * a + f.b.y * b + f.t.y * along, c.z + f.n.z * a + f.b.z * b + f.t.z * along);
  }
  pos.needsUpdate = true;
  return g;
}

/** Position-only, non-indexed merge (attributes must match for mergeGeometries). */
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map(p => {
    const flat = p.index ? p.toNonIndexed() : p, only = new THREE.BufferGeometry();
    only.setAttribute('position', flat.getAttribute('position'));
    return only;
  }));
}

function fromTriangles(values: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
  return g;
}

/** Copies the upward-facing triangles of a non-indexed geometry, pushed outward a little,
 * as a moss layer. `push(v)` moves one vertex; `keep(normalY, centroid)` picks triangles. */
function mossLayer(g: THREE.BufferGeometry, keep: (ny: number, c: THREE.Vector3) => boolean, push: (v: THREE.Vector3) => void): THREE.BufferGeometry {
  const pos = g.getAttribute('position'), out: number[] = [];
  const a = V(), b = V(), c = V(), n = V(), e = V(), centroid = V();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(e.subVectors(a, b));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    if (!keep(n.y, centroid)) continue;
    for (const v of [a, b, c]) { const w = v.clone(); push(w); out.push(w.x, w.y, w.z); }
  }
  return fromTriangles(out);
}

/** Splits a non-indexed geometry's triangles into material buckets. */
function splitBy(g: THREE.BufferGeometry, pick: (n: THREE.Vector3, c: THREE.Vector3) => MaterialKey): Map<MaterialKey, THREE.BufferGeometry> {
  const flat = g.index ? g.toNonIndexed() : g, pos = flat.getAttribute('position'), buckets = new Map<MaterialKey, number[]>();
  const a = V(), b = V(), c = V(), n = V(), e = V(), centroid = V();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(e.subVectors(a, b)).normalize();
    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    const key = pick(n, centroid);
    let list = buckets.get(key);
    if (!list) { list = []; buckets.set(key, list); }
    list.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  return new Map([...buckets].map(([k, v]) => [k, fromTriangles(v)]));
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// PINE TREE — trunk base at the origin, 9–14 m. Nodes: trunk (bark mesh: trunk, root flare,
// dead stubs), foliage (group: foliage_pine + foliage_dark drooping tiers).

export function buildPineTree(seed: number): THREE.Group {
  const r = rng(seed * 7919 + 377);
  const rand = (a: number, b: number) => a + (b - a) * r();
  // Character: the salt above makes seeds 11 / 23 / 37 read clearly differently
  // (12.5 m sparse 8 tiers / 9.1 m dense 5 tiers / 14 m medium 6 tiers).
  const H = 9 + 5 * r(), tiers = 5 + Math.floor(r() * 4), sparse = r();
  const r0 = 0.11 + 0.014 * H;
  const bareTop = lerp(2.6, 4.3, sparse) + (H - 9) * 0.12;
  const bark: THREE.BufferGeometry[] = [], pine: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = [];

  // Trunk: flared, slightly crooked, tapering to a point inside the crown.
  const ys = [-0.25, 0.22, 1.1, bareTop, lerp(bareTop, H, 0.5), H * 0.96];
  const spine = ys.map((y, i) => V(i > 1 ? rand(-0.07, 0.07) : 0, y, i > 1 ? rand(-0.07, 0.07) : 0));
  const radii = [r0 * 1.6, r0 * 1.18, r0, r0 * 0.8, r0 * 0.42, 0];
  const lobes = Array.from({ length: 7 }, () => rand(0.8, 1.22));
  bark.push(jitter(sweep(spine, radii, 7, { tip: true, open: true, mod: (i, k) => [i === 0 ? lobes[k] : i === 1 ? lerp(1, lobes[k], 0.45) : 1, 0] }), r0 * 0.14, seed * 13 + 1));
  const at = (y: number): { c: THREE.Vector3; rad: number } => {
    let i = 0;
    while (i < ys.length - 2 && y > ys[i + 1]) i++;
    const u = THREE.MathUtils.clamp((y - ys[i]) / (ys[i + 1] - ys[i]), 0, 1);
    return { c: spine[i].clone().lerp(spine[i + 1], u), rad: lerp(radii[i], radii[i + 1], u) };
  };

  // Root flare: a few buttress roots diving into the ground.
  const rootCount = 3 + Math.floor(r() * 2);
  for (let i = 0; i < rootCount; i++) {
    const a = (i / rootCount) * TAU + rand(-0.45, 0.45), len = r0 * rand(2.3, 3.6);
    const p = (d: number, y: number) => V(Math.sin(a) * d, y, Math.cos(a) * d);
    bark.push(sweep([p(r0 * 0.3, 0.45), p(r0 * 1.3, 0.13), p(len, -0.12)], [[r0 * 0.3, r0 * 0.46], [r0 * 0.2, r0 * 0.24]], 4, { tip: true, open: true }));
  }

  // Dead stub branches on the bare trunk (and a couple poking out under the lowest tier).
  const stubs = 3 + Math.floor(r() * 3) + (sparse > 0.5 ? 1 : 0);
  for (let i = 0; i < stubs; i++) {
    const y = lerp(1.25, bareTop + 0.7, (i + r() * 0.8) / stubs), a = rand(0, TAU);
    const len = lerp(0.3, 1.15, ((i + 1) / stubs) * rand(0.55, 1));
    const dir = V(Math.sin(a), rand(-0.5, -0.05), Math.cos(a)).normalize();
    const { c, rad } = at(y);
    const base = c.clone().add(V(Math.sin(a) * rad * 0.3, 0, Math.cos(a) * rad * 0.3));
    const mid = base.clone().addScaledVector(dir, len * 0.55).add(V(rand(-0.05, 0.05), rand(-0.07, 0.04), rand(-0.05, 0.05)));
    const end = base.clone().addScaledVector(dir, len);
    const thick = 0.022 + 0.03 * len;
    bark.push(sweep([base, mid, end], [thick, thick * 0.55], 4, { tip: true, open: true }));
    if (len > 0.6) {
      const fork = V(dir.z * (r() < 0.5 ? 1 : -1), rand(0.1, 0.5), -dir.x).normalize().add(dir).normalize();
      bark.push(sweep([mid, mid.clone().addScaledVector(fork, len * 0.38)], [thick * 0.45], 3, { tip: true, open: true }));
    }
  }

  // Foliage: drooping star-shaped tiers. Each tier is a cone whose rim alternates hanging branch
  // tips and notches, with the underside pushed up into a hollow (seen from the path below).
  const Rb = lerp(2.5, 1.7, sparse) * Math.sqrt(H / 11.5);
  for (let i = 0; i < tiers; i++) {
    const u = i / (tiers - 1);
    const base = lerp(bareTop + 0.5, H - 2.4, Math.pow(u, 0.92));
    const R = lerp(Rb, 0.62, Math.pow(u, 0.85)) * rand(0.88, 1.12);
    const h = lerp(0.82, 0.64, sparse) * R + 0.4;
    let clumps = R > 1.6 ? 6 : R > 0.95 ? 5 : 4;
    if (sparse > 0.6 && clumps > 4) clumps--;
    const radial = clumps * 2;
    const droop = Array.from({ length: radial }, () => h * rand(0.2, 0.36) * lerp(1, 1.35, sparse));
    const reach = Array.from({ length: radial }, (_, k) => (k % 2 ? lerp(0.68, 0.46, sparse) * rand(0.85, 1.15) : rand(0.9, 1.08)));
    const g = sweep([V(0, 0, 0), V(0, h * 0.28, 0), V(0, h * 0.6, 0), V(0, h, 0)], [R, R * 0.8, R * 0.47], radial, {
      tip: true,
      mod: (ring, k, centre) => {
        if (ring === 0) return centre ? [0, h * 0.42] : [reach[k], k % 2 ? h * 0.05 : -droop[k]];
        if (ring === 1) return [k % 2 ? lerp(reach[k], 1, 0.55) : 1.05, k % 2 ? 0 : -droop[k] * 0.3];
        return [1, 0];
      },
    });
    jitter(g, R * 0.1, seed * 101 + i);
    const { c } = at(base);
    const m = new THREE.Matrix4().compose(
      c.clone().add(V(rand(-0.08, 0.08), base, rand(-0.08, 0.08))).setY(base),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(-0.07, 0.07), rand(0, TAU), rand(-0.07, 0.07))),
      V(1, 1, 1),
    );
    g.applyMatrix4(m);
    (r() < lerp(0.8, 0.25, u) ? dark : pine).push(g);
  }
  const top = at(H - 2);
  pine.push(jitter(sweep([V(top.c.x, H - 2.1, top.c.z), V(top.c.x + rand(-0.05, 0.05), H - 1.0, top.c.z + rand(-0.05, 0.05)), V(top.c.x + rand(-0.08, 0.08), H, top.c.z + rand(-0.08, 0.08))], [0.34, 0.16], 5, { tip: true, open: true }), 0.06, seed * 7 + 5));

  // Slight lean, growing with height so the base stays planted.
  const leanA = rand(0, TAU), lean = rand(0.015, 0.045);
  const bend = (g: THREE.BufferGeometry) => {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const f = Math.pow(Math.max(0, pos.getY(i)) / H, 1.6) * H * lean;
      pos.setXYZ(i, pos.getX(i) + Math.sin(leanA) * f, pos.getY(i), pos.getZ(i) + Math.cos(leanA) * f);
    }
    return g;
  };
  const foliage = group('foliage', mesh(bend(merged(pine)), 'pine', 'foliage_pine'));
  if (dark.length) foliage.add(mesh(bend(merged(dark)), 'pine_dark', 'foliage_dark'));
  return group(`pine_tree_${seed}`, mesh(bend(merged(bark)), 'bark', 'trunk'), foliage);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// ROCK — about 1.2 m boulder, origin at ground contact (bottom sunk 6 cm), moss cap on top.

export function buildRock(): THREE.Group {
  const main = jitter(new THREE.IcosahedronGeometry(0.62, 1), 0.22, 71).scale(1, 0.7, 0.86);
  const chunk = jitter(new THREE.IcosahedronGeometry(0.36, 0), 0.16, 72).scale(1.1, 0.85, 0.95).rotateY(0.7).translate(0.46, -0.1, 0.3);
  const g = merged([main, chunk]);
  const pos = g.getAttribute('position'), floor = -0.27;
  for (let i = 0; i < pos.count; i++) pos.setY(i, Math.max(floor, pos.getY(i)) - floor - 0.06);
  pos.needsUpdate = true;
  const centre = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute).getCenter(V());
  const r = rng(73);
  const moss = mossLayer(g, ny => ny > 0.5 + 0.3 * r(), v => v.sub(centre).multiplyScalar(1.035).add(centre).add(V(0, 0.012, 0)));
  return group('rock', mesh(g, 'rock', 'rock_body'), mesh(moss, 'moss', 'rock_moss'));
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// FERN — about 0.8 m clump of arching, chevron-edged fronds. Origin at ground contact.

export function buildFern(): THREE.Group {
  const r = rng(601), rand = (a: number, b: number) => a + (b - a) * r();
  const outer: THREE.BufferGeometry[] = [], inner: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) {
    const young = i >= 7;
    const a = young ? ((i - 7) / 3) * TAU + 0.5 + rand(-0.3, 0.3) : (i / 7) * TAU + rand(-0.3, 0.3);
    const L = young ? rand(0.36, 0.44) : rand(0.44, 0.56);
    const e0 = young ? rand(1.3, 1.45) : rand(1.05, 1.25), e1 = young ? rand(0.0, 0.35) : rand(-0.7, -0.35);
    const dirH = V(Math.sin(a), 0, Math.cos(a)), side = V(Math.cos(a), 0, -Math.sin(a)), curl = rand(-0.04, 0.04);
    const pts = [dirH.clone().multiplyScalar(0.025).setY(-0.02)];
    for (let k = 1; k <= 5; k++) {
      const e = lerp(e0, e1, (k - 0.5) / 5);
      pts.push(pts[k - 1].clone().addScaledVector(dirH, Math.cos(e) * (L / 5)).add(V(0, Math.sin(e) * (L / 5), 0)).addScaledVector(side, curl * k * 0.2));
    }
    const w = (young ? 0.75 : 1) * rand(0.9, 1.1);
    const geo = sweep(pts, [[0.008, 0.006], [0.04 * w, 0.01], [0.062 * w, 0.011], [0.056 * w, 0.01], [0.038 * w, 0.008]], 3, {
      tip: true, open: true,
      // Side vertices pulled back toward the base → stacked chevrons that read as leaflets.
      mod: (ring, k) => [1, k > 0 && ring > 0 && ring < 5 ? -0.032 * w : 0],
    });
    (young || i % 3 === 1 ? inner : outer).push(geo);
  }
  return group('fern', mesh(merged(outer), 'moss', 'fronds'), mesh(merged(inner), 'pine', 'fronds_inner'));
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// FALLEN LOG — about 4 m along X, origin at the ground contact centre. −X end is a rotten hollow,
// +X end snapped into splinters; moss along the top, two dead branch stubs, bracket fungus.

export function buildFallenLog(): THREE.Group {
  const r = rng(801), rand = (a: number, b: number) => a + (b - a) * r();
  const n = 9, R = 0.27, radial = 9;
  const spine = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return V(lerp(-2, 2, t), R - 0.06 - 0.035 * Math.sin(t * Math.PI) + (i > 0 && i < n - 1 ? rand(-0.015, 0.015) : 0), 0.06 * Math.sin(t * 5.1 + 0.6));
  });
  const radii = spine.map((_, i) => R * lerp(1.06, 0.9, i / (n - 1)) * (i > 0 && i < n - 1 ? rand(0.95, 1.05) : 1));
  const jagA = Array.from({ length: radial }, () => rand(-0.05, 0.06));
  const jagB = Array.from({ length: radial }, (_, k) => (k % 2 ? rand(0.07, 0.24) : rand(-0.06, 0.04)));
  const log = sweep(spine, radii, radial, {
    mod: (i, k, centre) => {
      if (i === 0) return centre ? [0, 0.2] : [1, -jagA[k]];
      if (i === n - 1) return centre ? [0, 0.05] : [k % 2 ? 0.8 : 1, jagB[k]];
      return [1, 0];
    },
  });
  jitter(log, 0.035, 802);
  const body = log.toNonIndexed();
  // End grain: the hollow −X end is rotten (mud), the snapped +X end shows pale wood.
  const parts = splitBy(body, (nrm, c) => (c.x < -1.85 && nrm.x > 0.35 ? 'mud' : c.x > 1.93 && Math.abs(nrm.x) > 0.3 ? 'paper' : 'bark'));

  // Moss on the upper faces, patchy along the length, away from the broken ends.
  const moss = mossLayer(body, (ny, c) => ny > 0.42 + 0.25 * Math.sin(c.x * 2.3 + 0.8) && Math.abs(c.x) < 1.78, v => {
    const t = THREE.MathUtils.clamp((v.x + 2) / 4, 0, 1) * (n - 1), i = Math.min(n - 2, Math.floor(t));
    const axis = spine[i].clone().lerp(spine[i + 1], t - i);
    const out = V(0, v.y - axis.y, v.z - axis.z).normalize();
    v.addScaledVector(out, 0.028);
  });

  const bark: THREE.BufferGeometry[] = [parts.get('bark')!];
  const wood: THREE.BufferGeometry[] = [];
  // Splinters out of the snapped end.
  for (let i = 0; i < 4; i++) {
    const a = rand(0, TAU), o = V(2.02, spine[n - 1].y + Math.cos(a) * R * 0.55, spine[n - 1].z + Math.sin(a) * R * 0.55);
    wood.push(sweep([o, o.clone().add(V(rand(0.16, 0.34), rand(-0.04, 0.06), rand(-0.05, 0.05)))], [rand(0.025, 0.045)], 3, { tip: true, open: true }));
  }
  // Dead branch stubs.
  for (const [x, a, len] of [[-0.7, 0.5, 0.55], [0.85, 2.3, 0.35]] as const) {
    const i = Math.round(((x + 2) / 4) * (n - 1)), c = spine[i];
    const dir = V(0.35, Math.cos(a), Math.sin(a)).normalize();
    const b0 = c.clone().addScaledVector(dir, R * 0.6);
    bark.push(sweep([b0, b0.clone().addScaledVector(dir, len * 0.6).add(V(0.05, -0.03, 0)), b0.clone().addScaledVector(dir, len)], [0.06, 0.035], 5, { tip: true, open: true }));
  }
  // Bracket fungus on the shaded side.
  const fungus: THREE.BufferGeometry[] = [];
  for (const [x, y] of [[-0.35, 0.16], [-0.12, 0.26], [0.42, 0.12]] as const) {
    const i = Math.round(((x + 2) / 4) * (n - 1));
    fungus.push(new THREE.CylinderGeometry(0.11, 0.07, 0.035, 6, 1, false, 0, Math.PI).rotateY(Math.PI / 2).translate(x, y, spine[i].z - R * 0.85));
  }
  const g = group('fallen_log', mesh(merged(bark), 'bark', 'log'), mesh(moss, 'moss', 'log_moss'), mesh(merged([...wood, ...(parts.has('paper') ? [parts.get('paper')!] : [])]), 'paper', 'log_wood'), mesh(merged(fungus), 'cream', 'log_fungus'));
  if (parts.has('mud')) g.add(mesh(parts.get('mud')!, 'mud', 'log_rot'));
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// FOREST GROUND — 24 (x −12..12) × 50 (z 0..50), origin at the start centre. A 1.4 m dirt path
// winds along forestPathX(z); the ground is otherwise moss with needle-litter and mud patches,
// low hills that rise toward the side edges, roots across the path, puddles and stones.
// No trees: the scene scatters those (use forestGroundHeight to plant them).

const PATH_HALF = 0.7;
const PUDDLES = [
  { z: 9.6, dx: -0.12, rx: 0.45, rz: 0.8 },
  { z: 22.4, dx: 0.16, rx: 0.52, rz: 1.0 },
  { z: 35.1, dx: -0.06, rx: 0.4, rz: 0.65 },
];
const PUDDLE_WATER_Y = 0.006;

/** Centre line of the path: local x at local z. Starts and ends at x = 0 (exit door, shelter door at z ≈ 47.5). */
export function forestPathX(z: number): number {
  const w = smooth(0, 5, z) * (1 - smooth(43, 47.5, z));
  return w * (0.86 * Math.sin((z / 47.5) * TAU) + 0.24 * Math.sin(z * 0.37 + 1.1));
}

function puddleDepth(x: number, z: number): number {
  let m = 0;
  for (const p of PUDDLES) {
    const e = Math.hypot((x - forestPathX(p.z) - p.dx) / p.rx, (z - p.z) / p.rz);
    m = Math.max(m, 1 - smooth(0.3, 1, e));
  }
  return m;
}

function pathSurface(x: number, z: number): number {
  return 0.026 + 0.009 * Math.sin(z * 1.37 + x * 2.1) * Math.sin(z * 0.53 + 0.4) - 0.06 * puddleDepth(x, z);
}

/** Smooth ground height (±5 cm of the built mesh) for planting trees, rocks and ferns. */
export function forestGroundHeight(x: number, z: number): number {
  const d = Math.abs(x - forestPathX(z));
  const bank = 0.075 * smooth(PATH_HALF - 0.02, 1.1, d);
  const n = 0.45 * Math.sin(x * 0.53 + z * 0.29 + 0.6) + 0.33 * Math.sin(x * -0.83 + z * 0.61 + 2.3) + 0.22 * Math.sin(x * 1.7 + z * 1.3 + 4.1);
  const hills = smooth(1.1, 7, d) * 0.5 * (0.5 + 0.5 * n);
  const edge = Math.pow(smooth(4, 12, Math.abs(x)), 1.5) * (1.45 + 0.4 * Math.sin(z * 0.17 + Math.sign(x) * 1.9) + 0.22 * Math.sin(z * 0.41 + x));
  return pathSurface(x, z) + bank + hills + edge;
}

export function buildForestGround(): THREE.Group {
  const r = rng(4242), rand = (a: number, b: number) => a + (b - a) * r();
  // Columns: offsets from the path centre near the middle (dense), fixed x toward the edges.
  const cols = [-12, -9.4, -7.3, -5.6, -4.2, -3.1, -2.2, -1.5, -1.0, -PATH_HALF, -0.35, 0, 0.35, PATH_HALF, 1.0, 1.5, 2.2, 3.1, 4.2, 5.6, 7.3, 9.4, 12];
  const gx = cols.length - 1, gy = 72, L = 50;
  const PATH_FIRST = cols.indexOf(-PATH_HALF), PATH_LAST = cols.indexOf(PATH_HALF);
  const plane = new THREE.PlaneGeometry(1, 1, gx, gy).rotateX(-Math.PI / 2);
  const pos = plane.getAttribute('position');
  for (let k = 0; k < pos.count; k++) {
    const ix = k % (gx + 1), iy = Math.floor(k / (gx + 1)), off = cols[ix];
    const edgeRow = iy === 0 || iy === gy, edgeCol = ix === 0 || ix === gx;
    const z = (iy / gy) * L + (edgeRow ? 0 : rand(-0.22, 0.22));
    const spacing = Math.abs(cols[Math.min(gx, ix + 1)] - cols[Math.max(0, ix - 1)]) / 2;
    const lateral = edgeCol ? 0 : ix === PATH_FIRST || ix === PATH_LAST ? rand(-0.1, 0.1) : ix > PATH_FIRST && ix < PATH_LAST ? rand(-0.04, 0.04) : rand(-0.25, 0.25) * spacing;
    const x = off + lateral + forestPathX(z) * (1 - smooth(3, 9, Math.abs(off)));
    const onPath = ix >= PATH_FIRST && ix <= PATH_LAST;
    const y = forestGroundHeight(x, z) + (onPath ? rand(-0.004, 0.004) : rand(-0.03, 0.03) * smooth(1, 4, Math.abs(off)));
    pos.setXYZ(k, x, y, z);
  }
  // Material per triangle: path cells are dirt with mud around the puddles and in wet patches;
  // the rest is moss with needle-litter (dirt) and mud patches.
  const index = plane.getIndex()!, buckets = new Map<string, number[]>();
  const a = V(), c = V();
  for (let t = 0; t < index.count / 3; t++) {
    const cell = Math.floor(t / 2), ix = cell % gx;
    c.set(0, 0, 0);
    for (let j = 0; j < 3; j++) c.add(a.fromBufferAttribute(pos, index.getX(t * 3 + j)));
    c.multiplyScalar(1 / 3);
    const patch = Math.sin(c.x * 0.9 + c.z * 0.43) * Math.sin(c.z * 0.77 - c.x * 0.31 + 1.3);
    let key: string;
    if (ix >= PATH_FIRST && ix < PATH_LAST) {
      let wet = 0;
      for (const p of PUDDLES) wet = Math.max(wet, 1 - smooth(1.2, 1.9, Math.hypot((c.x - forestPathX(p.z) - p.dx) / p.rx, (c.z - p.z) / p.rz)));
      key = wet > 0.5 || Math.sin(c.z * 0.61 + 0.5) * Math.sin(c.x * 3.1 + c.z * 0.2) > 0.72 ? 'path:mud' : 'path:dirt';
    } else if (ix === PATH_FIRST - 1 || ix === PATH_LAST) {
      key = patch > 0.25 ? 'mud' : patch < -0.45 ? 'dirt' : 'moss';
    } else {
      key = patch > 0.42 ? 'dirt' : patch < -0.7 && Math.abs(c.x) < 5 ? 'mud' : 'moss';
    }
    let list = buckets.get(key);
    if (!list) { list = []; buckets.set(key, list); }
    for (let j = 0; j < 3; j++) { a.fromBufferAttribute(pos, index.getX(t * 3 + j)); list.push(a.x, a.y, a.z); }
  }
  const tris = (key: string) => fromTriangles(buckets.get(key) ?? []);
  const path = mesh(tris('path:dirt'), 'dirt', 'path');
  path.add(mesh(tris('path:mud'), 'mud', 'path_mud'));
  const root = group('forest_ground', mesh(tris('moss'), 'moss', 'ground_moss'), mesh(tris('dirt'), 'dirt', 'ground_litter'), mesh(tris('mud'), 'mud', 'ground_mud'), path);

  // Puddles: flat water discs that fill the dips in the path surface (their rims hide under it).
  PUDDLES.forEach((p, i) => {
    const disc = new THREE.CircleGeometry(1, 9).rotateX(-Math.PI / 2);
    const dp = disc.getAttribute('position');
    for (let k = 0; k < dp.count; k++) {
      const s = k === 0 ? 0 : rand(0.82, 1.02);
      dp.setXYZ(k, forestPathX(p.z) + p.dx + dp.getX(k) * p.rx * s, PUDDLE_WATER_Y, p.z + dp.getZ(k) * p.rz * s);
    }
    const water = mesh(disc, 'water', `puddle_${i}`);
    water.castShadow = false;
    root.add(water);
  });

  // Roots crossing the path from trees off to one side, diving back into the ground.
  const roots: THREE.BufferGeometry[] = [];
  for (const [z0, side, swing] of [[5.6, 1, 0.5], [13.9, -1, -0.35], [26.4, 1, 0.3], [31.2, -1, 0.6], [40.6, 1, -0.45]] as const) {
    const xs = forestPathX(z0) + side * rand(2.4, 3), xe = forestPathX(z0) - side * rand(1.3, 1.8), ph = rand(0, TAU);
    const pts: THREE.Vector3[] = [], rad: [number, number][] = [];
    for (let k = 0; k <= 7; k++) {
      const t = k / 7, w = lerp(0.085, 0.035, t);
      const x = lerp(xs, xe, t), z = lerp(z0 - swing, z0 + swing, t) + 0.1 * Math.sin(t * 7 + ph);
      pts.push(V(x, forestGroundHeight(x, z) + w * 0.3 - 0.13 * (1 - smooth(0, 0.22, t)) - 0.1 * smooth(0.8, 1, t), z));
      rad.push([w * 1.25, w * 0.8]);
    }
    roots.push(jitter(sweep(pts, rad, 5, { open: true }), 0.02, 1000 + z0));
  }
  root.add(mesh(merged(roots), 'bark', 'roots'));

  // Stones: pebbles on the path, stones along its edges, a few larger ones further out.
  const stones: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 28; i++) {
    const z = rand(1, 49), kind = r(), sideSign = r() < 0.5 ? -1 : 1;
    const [off, size] = kind < 0.5 ? [sideSign * rand(0.6, 1.15), rand(0.07, 0.16)] : kind < 0.72 ? [rand(-0.5, 0.5), rand(0.035, 0.065)] : [sideSign * rand(1.4, 5), rand(0.14, 0.3)];
    const x = forestPathX(z) + off;
    if (puddleDepth(x, z) > 0) continue;
    const s = jitter(new THREE.IcosahedronGeometry(size, 0), size * 0.5, 900 + i).scale(1, rand(0.5, 0.75), rand(0.8, 1.1)).rotateY(rand(0, TAU));
    stones.push(s.translate(x, forestGroundHeight(x, z) - size * 0.18, z));
  }
  root.add(mesh(merged(stones), 'rock', 'stones'));

  // Fallen twigs.
  const twigs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const z = rand(2, 48), x0 = forestPathX(z) + (r() < 0.5 ? -1 : 1) * rand(0.3, 2.6), a = rand(0, Math.PI), len = rand(0.45, 1.1), w = rand(0.018, 0.03);
    const p = (t: number, bump: number) => { const x = x0 + Math.cos(a) * len * (t - 0.5), z1 = z + Math.sin(a) * len * (t - 0.5); return V(x, forestGroundHeight(x, z1) + w * 0.6 + bump, z1); };
    twigs.push(sweep([p(0, 0), p(0.5, 0.02).add(V(rand(-0.06, 0.06), 0, rand(-0.06, 0.06))), p(1, 0)], [w, w * 0.6], 4, { tip: true }));
  }
  root.add(mesh(merged(twigs), 'bark', 'twigs'));
  return root;
}
