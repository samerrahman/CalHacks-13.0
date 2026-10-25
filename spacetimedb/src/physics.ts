import { table, t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import { capability, ownedSession, type HushCtx, type HushDb } from './access';
import { allAsleep, applyImpulse, impulsesFromEvents, PROPS, sanitizeBody, spawnBodies, stepBodies, TICK_MS, TICK_STEPS, type Body, type PhysicsEvent } from './physicsSim';

// Server-authoritative prop physics, one world per consenting trace session. The game's own
// reducer never reads it; trace events only push props around. See docs/PHYSICS.md.
export const physicsWorld = table({ name: 'physics_world' }, {
  sessionId: t.string().primaryKey(),
  tick: t.u32(),
  awake: t.bool(),
  lastEventSeq: t.u32(),
  knocks: t.u32(),
  lastKnockAtMs: t.u64(),
});
export const physicsBody = table({ name: 'physics_body' }, {
  id: t.u64().primaryKey().autoInc(),
  sessionId: t.string().index('btree'),
  slot: t.u8(),
  x: t.f64(), y: t.f64(), z: t.f64(),
  vx: t.f64(), vy: t.f64(), vz: t.f64(),
  rest: t.u8(),
  sleeping: t.bool(),
});
/** At most one repeating row; it exists only while some world is awake. */
export const physicsTick = table({ name: 'physics_tick' }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

const KNOCK_GAP_MS = 250n;
const KNOCK_SEQ_BASE = 100_000;
type BodyRow = typeof physicsBody.rowType.type;

function toBody(row: BodyRow): Body {
  return sanitizeBody({ slot: row.slot, x: row.x, y: row.y, z: row.z, vx: row.vx, vy: row.vy, vz: row.vz, rest: row.rest, sleeping: row.sleeping });
}
function bodyRows(ctx: HushCtx, sessionId: string): BodyRow[] {
  return [...ctx.db.physicsBody.sessionId.filter(sessionId)].sort((a, b) => a.slot - b.slot);
}
function writeBodies(ctx: HushCtx, rows: BodyRow[], bodies: Body[]): void {
  rows.forEach((row, i) => {
    const b = bodies[i]!;
    if (row.sleeping && b.sleeping && row.x === b.x && row.y === b.y && row.z === b.z) return;
    ctx.db.physicsBody.id.update({ ...row, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, rest: b.rest, sleeping: b.sleeping });
  });
}
function ensureTicking(ctx: HushCtx): void {
  if (ctx.db.physicsTick.count() === 0n) ctx.db.physicsTick.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(BigInt(TICK_MS) * 1000n) });
}
function ensureWorld(ctx: HushCtx, sessionId: string) {
  const existing = ctx.db.physicsWorld.sessionId.find(sessionId);
  if (existing) return existing;
  for (const b of spawnBodies()) ctx.db.physicsBody.insert({ id: 0n, sessionId, ...b });
  return ctx.db.physicsWorld.insert({ sessionId, tick: 0, awake: false, lastEventSeq: 0, knocks: 0, lastKnockAtMs: 0n });
}

/** Called by appendTrace with the events it just accepted (already sanitized). */
export function applyTraceImpulses(ctx: HushCtx, sessionId: string, events: readonly PhysicsEvent[]): void {
  const world = ensureWorld(ctx, sessionId);
  const fresh = events.filter(e => e.seq > world.lastEventSeq);
  if (!fresh.length) return;
  const impulses = impulsesFromEvents(fresh);
  const lastEventSeq = Math.max(world.lastEventSeq, ...fresh.map(e => e.seq));
  if (!impulses.length) { ctx.db.physicsWorld.sessionId.update({ ...world, lastEventSeq }); return; }
  const rows = bodyRows(ctx, sessionId);
  writeBodies(ctx, rows, impulses.reduce(applyImpulse, rows.map(toBody)));
  ctx.db.physicsWorld.sessionId.update({ ...world, lastEventSeq, awake: true });
  ensureTicking(ctx);
}

/** Called when the owning session is removed or expires. */
export function dropPhysics(ctx: HushCtx, sessionId: string): void {
  for (const row of [...ctx.db.physicsBody.sessionId.filter(sessionId)]) ctx.db.physicsBody.id.delete(row.id);
  ctx.db.physicsWorld.sessionId.delete(sessionId);
}

const feedRow = t.row('PhysicsFeedRow', {
  slot: t.u8().primaryKey(), kind: t.string(), radius: t.f64(),
  x: t.f64(), y: t.f64(), z: t.f64(), sleeping: t.bool(), tick: t.u32(),
});

export function physicsExports(db: HushDb) {
  const physicsStep = db.reducer({ onSchedule: physicsTick }, { arg: physicsTick.rowType }, (ctx, { arg }) => {
    let awake = 0;
    for (const world of [...ctx.db.physicsWorld.iter()].filter(w => w.awake)) {
      if (!ctx.db.session.id.find(world.sessionId)) { dropPhysics(ctx, world.sessionId); continue; }
      const rows = bodyRows(ctx, world.sessionId);
      const bodies = stepBodies(rows.map(toBody), TICK_STEPS);
      writeBodies(ctx, rows, bodies);
      const stillAwake = !allAsleep(bodies);
      ctx.db.physicsWorld.sessionId.update({ ...world, tick: world.tick + 1, awake: stillAwake });
      if (stillAwake) awake++;
    }
    if (!awake) ctx.db.physicsTick.scheduledId.delete(arg.scheduledId);
  });

  /** The owner can flick one prop; bounded to four knocks a second. */
  const physicsKnock = db.reducer({ id: t.string(), ownerCapability: t.string(), slot: t.u8() }, (ctx, args) => {
    ownedSession(ctx, args.id, args.ownerCapability);
    if (args.slot >= PROPS.length) throw new SenderError('Unknown prop');
    const world = ensureWorld(ctx, args.id), now = ctx.timestamp.toMillis();
    if (now - world.lastKnockAtMs < KNOCK_GAP_MS) return;
    const rows = bodyRows(ctx, args.id);
    writeBodies(ctx, rows, applyImpulse(rows.map(toBody), { seq: KNOCK_SEQ_BASE + world.knocks, source: 'KNOCK', strength: 1, slot: args.slot }));
    ctx.db.physicsWorld.sessionId.update({ ...world, knocks: world.knocks + 1, lastKnockAtMs: now, awake: true });
    ensureTicking(ctx);
  });

  /** Spectators and the second screen read props with the same judge capability. */
  const physicsFeed = db.anonymousView(
    { name: 'physics_feed', public: true },
    { id: t.string(), judgeCapability: t.string() },
    t.array(feedRow),
    (ctx, args) => {
      const session = ctx.db.session.id.find(args.id);
      const world = ctx.db.physicsWorld.sessionId.find(args.id);
      if (!session || !world || !capability(args.judgeCapability) || session.judgeCapability !== args.judgeCapability) return [];
      return [...ctx.db.physicsBody.sessionId.filter(args.id)].map(row => ({ slot: row.slot, kind: PROPS[row.slot]?.kind ?? 'bolt', radius: PROPS[row.slot]?.radius ?? 0.02, x: row.x, y: row.y, z: row.z, sleeping: row.sleeping, tick: world.tick }));
    },
  );

  return db.exportGroup({ physicsStep, physicsKnock, physicsFeed });
}
