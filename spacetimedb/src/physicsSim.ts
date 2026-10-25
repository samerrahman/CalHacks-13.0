// Pure, deterministic prop physics for the shelter. The SpacetimeDB module runs it as the
// authority; an offline spectator runs the same code from the same public events. No clocks,
// no Math.random: the same bodies and impulses always produce the same frames. Physics is
// cosmetic and additive. It never feeds back into game rules, time or creature movement.

export type Vec = [number, number, number];
export type Aabb = { min: Vec; max: Vec };
export type PropKind = 'can' | 'mug' | 'bolt' | 'bottle' | 'flashlight';
export type PropSpec = { kind: PropKind; radius: number; mass: number; restitution: number; friction: number; at: Vec };
export type Body = { slot: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; rest: number; sleeping: boolean };
export type ImpulseSource = 'DOOR_POUND' | 'FOOTSTEPS' | 'BREACH' | 'KNOCK';
export type Impulse = { seq: number; source: ImpulseSource; strength: number; slot?: number };
/** Only the fields the shared trace already carries after sanitizing. */
export type PhysicsEvent = { seq: number; type: string; detail: string };

export const PHYSICS_HZ = 60;
export const STEP_SECONDS = 1 / PHYSICS_HZ;
/** One scheduled server tick advances three fixed steps (50 ms of simulated time). */
export const TICK_STEPS = 3;
export const TICK_MS = 50;
export const IMPULSE_SOURCES: readonly ImpulseSource[] = ['DOOR_POUND', 'FOOTSTEPS', 'BREACH', 'KNOCK'];

const GRAVITY = -9.81;
const AIR = 0.999;
const BOUNCE_MIN = 0.35;
const SLEEP_SPEED = 0.05;
const SLEEP_STEPS = 30;
const MAX_SPEED = 12;

// Collision proxies in the render scene's metres (see src/render/scene.ts placements):
// workdesk centred at z -1.8 with its top at 0.92, the machine rack against the east wall,
// and the sealed door on the back wall at x -1.75. They are approximate boxes, not meshes.
export const ROOM: Aabb = { min: [-2.65, 0, -2.36], max: [2.7, 3.0, 2.45] };
export const OBSTACLES: readonly Aabb[] = [
  { min: [-1.75, 0, -2.36], max: [1.25, 0.92, -1.3] },  // workdesk
  { min: [2.1, 0, -0.9], max: [2.7, 1.9, 1.0] },        // machine rack
];
export const DOOR: Vec = [-1.75, 1.0, 2.45];

export const PROPS: readonly PropSpec[] = [
  { kind: 'mug', radius: 0.045, mass: 0.3, restitution: 0.2, friction: 0.06, at: [-0.2, 0.965, -1.55] },
  { kind: 'can', radius: 0.035, mass: 0.05, restitution: 0.45, friction: 0.03, at: [0.25, 0.955, -1.5] },
  { kind: 'can', radius: 0.035, mass: 0.05, restitution: 0.45, friction: 0.03, at: [-1.05, 0.955, -1.45] },
  { kind: 'bolt', radius: 0.015, mass: 0.02, restitution: 0.3, friction: 0.08, at: [0.4, 0.935, -1.42] },
  { kind: 'bottle', radius: 0.04, mass: 0.4, restitution: 0.25, friction: 0.04, at: [-1.2, 0.04, 1.9] },
  { kind: 'flashlight', radius: 0.03, mass: 0.25, restitution: 0.2, friction: 0.05, at: [-0.4, 0.03, 1.6] },
  { kind: 'bolt', radius: 0.015, mass: 0.02, restitution: 0.3, friction: 0.08, at: [0.6, 0.015, 0.9] },
  { kind: 'bolt', radius: 0.015, mass: 0.02, restitution: 0.3, friction: 0.08, at: [1.4, 0.015, 1.5] },
  { kind: 'can', radius: 0.035, mass: 0.05, restitution: 0.45, friction: 0.03, at: [-2.2, 0.035, 0.3] },
  { kind: 'can', radius: 0.035, mass: 0.05, restitution: 0.45, friction: 0.03, at: [1.6, 0.035, -0.6] },
  { kind: 'bolt', radius: 0.015, mass: 0.02, restitution: 0.3, friction: 0.08, at: [2.35, 1.915, 0.4] },
  { kind: 'can', radius: 0.035, mass: 0.05, restitution: 0.45, friction: 0.03, at: [2.35, 1.935, -0.4] },
];

export function spawnBodies(): Body[] {
  return PROPS.map((spec, slot) => ({ slot, x: spec.at[0], y: spec.at[1], z: spec.at[2], vx: 0, vy: 0, vz: 0, rest: SLEEP_STEPS, sleeping: true }));
}
export const allAsleep = (bodies: readonly Body[]): boolean => bodies.every(b => b.sleeping);

/** Advance by whole fixed steps. Returns new bodies; the input is not modified. */
export function stepBodies(bodies: readonly Body[], steps = 1): Body[] {
  const next = bodies.map(b => ({ ...b }));
  for (let s = 0; s < steps; s++) {
    if (allAsleep(next)) break;
    const supported = next.map(() => false);
    next.forEach((b, i) => {
      if (b.sleeping) return;
      b.vy += GRAVITY * STEP_SECONDS;
      b.vx *= AIR; b.vy *= AIR; b.vz *= AIR;
      clampSpeed(b);
      b.x += b.vx * STEP_SECONDS; b.y += b.vy * STEP_SECONDS; b.z += b.vz * STEP_SECONDS;
      if (collideRoom(b)) supported[i] = true;
      for (const box of OBSTACLES) if (collideBox(b, box)) supported[i] = true;
    });
    collidePairs(next, supported);
    next.forEach((b, i) => settle(b, supported[i]!));
  }
  return next;
}

/** Wakes and kicks bodies. Jitter comes from the impulse sequence, never a random source. */
export function applyImpulse(bodies: readonly Body[], impulse: Impulse): Body[] {
  const s = clamp(Number.isFinite(impulse.strength) ? impulse.strength : 0, 0, 1);
  if (s === 0) return bodies.map(b => ({ ...b }));
  return bodies.map(b => {
    const spec = PROPS[b.slot];
    if (!spec || impulse.source === 'KNOCK' && b.slot !== impulse.slot) return { ...b };
    const j = (k: number) => jitter(impulse.seq, b.slot, k);
    let dvx: number, dvy: number, dvz: number;
    if (impulse.source === 'KNOCK') { dvx = 1.2 * s * j(0); dvy = 1.4 * s; dvz = 1.2 * s * j(2); }
    else {
      // Structure-borne shake reaches everything; the push falls off with distance from the door.
      const near = Math.max(0, 1 - Math.hypot(b.x - DOOR[0], b.y - DOOR[1], b.z - DOOR[2]) / 4.5);
      const shake = impulse.source === 'FOOTSTEPS' ? 0.8 : impulse.source === 'BREACH' ? 1.6 : 0.8;
      const push = impulse.source === 'FOOTSTEPS' ? 0 : impulse.source === 'BREACH' ? 4.2 : 2.6;
      dvy = s * (shake * (0.7 + 0.3 * j(1)) + push * 0.5 * near);
      dvz = -s * push * near * (0.8 + 0.2 * j(2));
      dvx = s * (0.35 * shake * j(0) + 0.4 * push * near * j(3));
    }
    const light = spec.mass < 0.1 ? 1.25 : 1;
    const kicked = { ...b, vx: b.vx + dvx * light, vy: b.vy + dvy * light, vz: b.vz + dvz * light, rest: 0, sleeping: false };
    clampSpeed(kicked);
    return kicked;
  });
}

/** The fixed map from sanitized public events to impulses, shared by server and fallback. */
export function impulsesFromEvents(events: readonly PhysicsEvent[]): Impulse[] {
  const out: Impulse[] = [];
  for (const e of events) {
    if (e.type === 'SCARE' && e.detail === 'impact') out.push({ seq: e.seq, source: 'DOOR_POUND', strength: 0.75 });
    else if (e.type === 'SCARE' && e.detail === 'monitor') out.push({ seq: e.seq, source: 'FOOTSTEPS', strength: 0.4 });
    else if (e.type === 'SCARE' && e.detail === 'breach') out.push({ seq: e.seq, source: 'BREACH', strength: 1 });
    else if (e.type === 'ATTACK_COMMITTED') out.push({ seq: e.seq, source: 'DOOR_POUND', strength: 1 });
    else if (e.type === 'MONSTER_STEP') {
      const to = Number(/^from=\d{1,2} to=(\d{1,2}) step=-?\d$/.exec(e.detail)?.[1] ?? NaN);
      if (to <= 2) out.push({ seq: e.seq, source: 'FOOTSTEPS', strength: (3 - to) * 0.2 });
    }
  }
  return out;
}

/** Bounds a body loaded from storage or a peer so a corrupt row cannot escape the room. */
export function sanitizeBody(b: Body): Body {
  const spec = PROPS[b.slot];
  if (!spec) throw new Error('Unknown prop slot');
  const values = [b.x, b.y, b.z, b.vx, b.vy, b.vz];
  if (!values.every(Number.isFinite)) return { slot: b.slot, x: spec.at[0], y: spec.at[1], z: spec.at[2], vx: 0, vy: 0, vz: 0, rest: SLEEP_STEPS, sleeping: true };
  const r = spec.radius;
  return { ...b, x: clamp(b.x, ROOM.min[0] + r, ROOM.max[0] - r), y: clamp(b.y, ROOM.min[1] + r, ROOM.max[1] - r), z: clamp(b.z, ROOM.min[2] + r, ROOM.max[2] - r), rest: clamp(Math.round(b.rest), 0, 255) };
}

function collideRoom(b: Body): boolean {
  const spec = PROPS[b.slot]!, r = spec.radius;
  const p = [b.x, b.y, b.z], v = [b.vx, b.vy, b.vz];
  let floor = false;
  for (let a = 0; a < 3; a++) {
    const lo = ROOM.min[a]! + r, hi = ROOM.max[a]! - r;
    if (p[a]! < lo) { p[a] = lo; if (v[a]! < 0) bounce(v, a, spec); if (a === 1) floor = true; }
    else if (p[a]! > hi) { p[a] = hi; if (v[a]! > 0) bounce(v, a, spec); }
  }
  [b.x, b.y, b.z] = p as Vec; [b.vx, b.vy, b.vz] = v as Vec;
  return floor;
}

function bounce(v: number[], axis: number, spec: PropSpec): void {
  const vn = v[axis]!;
  v[axis] = Math.abs(vn) < BOUNCE_MIN ? 0 : -vn * spec.restitution;
  for (let a = 0; a < 3; a++) if (a !== axis) v[a] = v[a]! * (1 - spec.friction);
}

function collideBox(b: Body, box: Aabb): boolean {
  const spec = PROPS[b.slot]!, r = spec.radius;
  const p: Vec = [b.x, b.y, b.z];
  const q = p.map((value, a) => clamp(value, box.min[a]!, box.max[a]!)) as Vec;
  let d: Vec = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  let dist = Math.hypot(...d), n: Vec, depth: number;
  if (dist >= r) return false;
  if (dist > 1e-9) { n = [d[0] / dist, d[1] / dist, d[2] / dist]; depth = r - dist; }
  else {
    // Centre inside the box: leave through the nearest face.
    let best = Infinity, axis = 1, sign = 1;
    for (let a = 0; a < 3; a++) {
      const toMin = p[a] - box.min[a]!, toMax = box.max[a]! - p[a];
      if (toMin < best) { best = toMin; axis = a; sign = -1; }
      if (toMax < best) { best = toMax; axis = a; sign = 1; }
    }
    n = [0, 0, 0]; n[axis] = sign; depth = best + r;
  }
  b.x += n[0] * depth; b.y += n[1] * depth; b.z += n[2] * depth;
  const vn = b.vx * n[0] + b.vy * n[1] + b.vz * n[2];
  if (vn < 0) {
    const e = Math.abs(vn) < BOUNCE_MIN ? 0 : spec.restitution;
    b.vx -= (1 + e) * vn * n[0]; b.vy -= (1 + e) * vn * n[1]; b.vz -= (1 + e) * vn * n[2];
  }
  const along = b.vx * n[0] + b.vy * n[1] + b.vz * n[2];
  d = [b.vx - along * n[0], b.vy - along * n[1], b.vz - along * n[2]];
  b.vx = along * n[0] + d[0] * (1 - spec.friction); b.vy = along * n[1] + d[1] * (1 - spec.friction); b.vz = along * n[2] + d[2] * (1 - spec.friction);
  return n[1] > 0.7;
}

function collidePairs(bodies: Body[], supported: boolean[]): void {
  for (let i = 0; i < bodies.length; i++) {
    for (let k = i + 1; k < bodies.length; k++) {
      const a = bodies[i]!, c = bodies[k]!;
      if (a.sleeping && c.sleeping) continue;
      const sa = PROPS[a.slot]!, sc = PROPS[c.slot]!;
      const dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z, dist = Math.hypot(dx, dy, dz), reach = sa.radius + sc.radius;
      if (dist >= reach + 0.01 || dist < 1e-9) continue;
      // A moving neighbour within a centimetre wakes a sleeper, so a stack never floats.
      if (a.sleeping) { a.sleeping = false; a.rest = 0; }
      if (c.sleeping) { c.sleeping = false; c.rest = 0; }
      if (dist >= reach) continue;
      const n: Vec = [dx / dist, dy / dist, dz / dist], wa = 1 / sa.mass, wc = 1 / sc.mass, depth = reach - dist;
      a.x -= n[0] * depth * wa / (wa + wc); a.y -= n[1] * depth * wa / (wa + wc); a.z -= n[2] * depth * wa / (wa + wc);
      c.x += n[0] * depth * wc / (wa + wc); c.y += n[1] * depth * wc / (wa + wc); c.z += n[2] * depth * wc / (wa + wc);
      const closing = (c.vx - a.vx) * n[0] + (c.vy - a.vy) * n[1] + (c.vz - a.vz) * n[2];
      if (closing < 0) {
        const e = Math.min(sa.restitution, sc.restitution), j = -(1 + e) * closing / (wa + wc);
        a.vx -= j * wa * n[0]; a.vy -= j * wa * n[1]; a.vz -= j * wa * n[2];
        c.vx += j * wc * n[0]; c.vy += j * wc * n[1]; c.vz += j * wc * n[2];
      }
      if (n[1] > 0.7) supported[k] = true;
      if (n[1] < -0.7) supported[i] = true;
    }
  }
}

function settle(b: Body, supported: boolean): void {
  if (b.sleeping) return;
  const slow = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz < SLEEP_SPEED * SLEEP_SPEED;
  b.rest = supported && slow ? Math.min(255, b.rest + 1) : 0;
  if (b.rest >= SLEEP_STEPS) { b.sleeping = true; b.vx = 0; b.vy = 0; b.vz = 0; }
}

function clampSpeed(b: Body): void {
  const speed = Math.hypot(b.vx, b.vy, b.vz);
  if (speed > MAX_SPEED) { const k = MAX_SPEED / speed; b.vx *= k; b.vy *= k; b.vz *= k; }
}

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }

/** Integer hash of (sequence, slot, component) to [-1, 1). */
function jitter(seq: number, slot: number, k: number): number {
  let h = Math.imul(seq ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(slot + 1, 0xc2b2ae35) ^ Math.imul(k + 7, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 2147483648 - 1;
}
