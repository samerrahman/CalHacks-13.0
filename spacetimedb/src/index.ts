import { schema, table, t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import { applyTraceImpulses, dropPhysics, physicsBody, physicsExports, physicsTick, physicsWorld } from './physics';
import { dropVitals, spectateExports, spectatorVitals } from './spectate';

// All stored rows are private. The judge sees one capability-filtered view.
const event = t.row('PublicEvent', {
  id: t.string(), seq: t.u32(), time: t.f64(), type: t.string(), detail: t.string(),
});
const summary = t.row('TraceSummary', {
  time: t.f64(), stage: t.u32(), status: t.string(), equipment: t.string(),
  creatureNode: t.string(), creaturePhase: t.string(), linePosition: t.u32(),
  lineLength: t.u32(), danger: t.u32(), quietChargesRemaining: t.u32(),
  tactic: t.string(), target: t.string(), proposalSource: t.string(),
  sensorSource: t.string(), sensorQuality: t.string(), trend: t.string(),
  sensorAgeMs: t.option(t.u32()),
});
const session = table({ name: 'session' }, {
  id: t.string().primaryKey(),
  ownerCapability: t.string(), judgeCapability: t.string(),
  seed: t.u32(), mode: t.string(), expiresAtMs: t.u64(),
  lastSequence: t.u32(), summary: t.option(summary), events: t.array(event),
});
const expiry = table({ name: 'expiry' }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
  sessionId: t.string(),
});
const db = schema({ session, expiry, physicsWorld, physicsBody, physicsTick, spectatorVitals });
export default db;

const DAY_MS = 86_400_000n;
const capability = (value: string) => /^[a-f0-9]{64}$/.test(value);
const eventTypes = new Set(['UNKNOWN', 'NEAR_LISTEN', 'TAUNT', 'DIRECTOR_APPLIED', 'DIRECTOR_REJECTED', 'DIRECTOR_REQUESTED', 'MEMORY_REPLAY', 'TASK_COMPLETE', 'WRONG_INPUT', 'FAULT_CLEARED', 'MEMORY_ARMED', 'FINAL_BROADCAST', 'FAULT_STARTED', 'MEMORY_READY', 'MEMORY_EXPIRED', 'LURE_TRANSMITTED', 'QUIET_ENTERED', 'RESTORED', 'APPROACH', 'LURE_ARRIVED', 'WON', 'LURE_RELEASED', 'QUIET_RETREAT', 'RESTORE_WINDOW', 'BREACH_WARNING', 'LOST', 'RUN_STARTED', 'BLACKOUT_STARTED', 'SENSOR_TREND', 'PAUSED', 'RESUMED', 'PROXIMITY_ALARM', 'ATTACK_COMMITTED', 'SCARE', 'MONSTER_STEP', 'QUIET_EXHAUSTED', 'QUIET_COOLDOWN', 'TIMEOUT', 'WIRE_CONNECTED']);
function safeDetail(type: string, detail: string): string {
  if (type === 'RUN_STARTED' && /^(standard|demo|tutorial)$/.test(detail)) return detail;
  if (type === 'FAULT_CLEARED' && /^(1|3)$/.test(detail)) return detail;
  if (type === 'TASK_COMPLETE' && /^[1-4]$/.test(detail)) return detail;
  if (type === 'WRONG_INPUT' && /^(FAULT|MEMORY|WIRE)$/.test(detail)) return detail;
  if (['LURE_TRANSMITTED', 'LURE_ARRIVED'].includes(type) && /^(EMITTER_A|EMITTER_B|CONTAINMENT)$/.test(detail)) return detail;
  if (type === 'APPROACH' && detail === 'SHELTER') return detail;
  if (type === 'BREACH_WARNING' && /^(6|8|10)$/.test(detail)) return detail;
  if (type === 'RESTORED' && /^(CLEAR|EARLY)$/.test(detail)) return detail;
  if (type === 'SENSOR_TREND' && /^source=(presage|simulated|manual) quality=(accepted|rejected|unknown) trend=(UNKNOWN|STEADY|ELEVATED|RECOVERED)$/.test(detail)) return detail;
  if (type === 'DIRECTOR_APPLIED' && /^(GEMINI|FALLBACK) (INVESTIGATE_SOUND|CIRCLE_SHELTER|LISTEN_NEAR|FOLLOW_LURE|WAIT|TAUNT|RETREAT) (SHELTER|EMITTER_A|EMITTER_B|CONTAINMENT|NONE)$/.test(detail)) return detail;
  if (type === 'DIRECTOR_REJECTED' && /^(BAD_SHAPE|DUPLICATE|WRONG_REQUEST|EXPIRED|STALE_STATE|ILLEGAL_PHASE|ILLEGAL_PAIR|ILLEGAL_TAUNT|UNKNOWN_EVIDENCE|UNSUPPORTED_REASON)$/.test(detail)) return detail;
  if (type === 'TAUNT' && /^(NONE|AFTER_MISTAKE|MACHINES_QUIET|HEARD_RHYTHM|LURE_FOLLOWED)$/.test(detail)) return detail;
  if (type === 'SCARE' && /^(impact|monitor|breach)$/.test(detail)) return detail;
  if (type === 'MONSTER_STEP' && /^from=\d{1,2} to=\d{1,2} step=-?\d$/.test(detail)) {
    const match = /^from=(\d+) to=(\d+) step=(-?\d)$/.exec(detail)!;
    const from = Number(match[1]), to = Number(match[2]), step = Number(match[3]);
    if (from <= 24 && to <= 24 && Math.abs(step) <= 3 && to - from === step) return detail;
  }
  return '';
}
function ownerSession(ctx: { db: { session: { id: { find(id: string): Session | null } } } }, id: string, ownerCapability: string): Session {
  const row = ctx.db.session.id.find(id);
  if (!row || !capability(ownerCapability) || row.ownerCapability !== ownerCapability) throw new SenderError('Session unavailable');
  return row;
}
type Session = { id: string; ownerCapability: string; judgeCapability: string; seed: number; mode: string; expiresAtMs: bigint; lastSequence: number; summary: typeof summary.type | undefined; events: (typeof event.type)[] };

export const createSession = db.reducer({
  id: t.string(), ownerCapability: t.string(), judgeCapability: t.string(),
  consent: t.bool(), seed: t.u32(), mode: t.string(),
}, (ctx, args) => {
  if (!args.consent || !capability(args.id) || !capability(args.ownerCapability) || !capability(args.judgeCapability) || args.ownerCapability === args.judgeCapability) throw new SenderError('Invalid consent or capabilities');
  if (args.seed > 999_999 || !['standard', 'demo', 'tutorial', 'integration-smoke'].includes(args.mode)) throw new SenderError('Invalid session');
  if (ctx.db.session.id.find(args.id)) throw new SenderError('Session already exists');
  ctx.db.session.insert({ id: args.id, ownerCapability: args.ownerCapability, judgeCapability: args.judgeCapability, seed: args.seed, mode: args.mode, expiresAtMs: ctx.timestamp.toMillis() + DAY_MS, lastSequence: 0, summary: undefined, events: [] });
  ctx.db.expiry.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + DAY_MS * 1000n), sessionId: args.id });
});

export const expireSession = db.reducer({ onSchedule: expiry }, { arg: expiry.rowType }, (ctx, { arg }) => {
  const row = ctx.db.session.id.find(arg.sessionId);
  if (row && row.expiresAtMs <= ctx.timestamp.toMillis()) { ctx.db.session.id.delete(arg.sessionId); dropPhysics(ctx, arg.sessionId); dropVitals(ctx, arg.sessionId); }
});

export const appendTrace = db.reducer({
  id: t.string(), ownerCapability: t.string(), events: t.array(event), summary,
}, (ctx, args) => {
  const row = ownerSession(ctx, args.id, args.ownerCapability);
  if (row.expiresAtMs < ctx.timestamp.toMillis() || args.events.length > 100) throw new SenderError('Session unavailable');
  const s = args.summary;
  if (!Number.isFinite(s.time) || s.time < 0 || s.time > 3600 || s.stage < 1 || s.stage > 5 || s.linePosition > s.lineLength || s.lineLength > 100 || s.danger > 100 || s.quietChargesRemaining > 10 || (s.sensorAgeMs !== undefined && s.sensorAgeMs > 120_000)) throw new SenderError('Invalid summary');
  if (!['playing', 'won', 'lost'].includes(s.status) || !['on', 'quiet', 'blackout'].includes(s.equipment) || !['presage', 'simulated', 'manual'].includes(s.sensorSource) || !['accepted', 'rejected', 'unknown'].includes(s.sensorQuality) || !['UNKNOWN', 'STEADY', 'ELEVATED', 'RECOVERED'].includes(s.trend)) throw new SenderError('Invalid summary');
  if (!['SHELTER_WALL', 'WEST_WALL', 'EAST_WALL', 'NEAR_PATH', 'JUNCTION', 'EMITTER_A', 'EMITTER_B', 'CONTAINMENT'].includes(s.creatureNode) || !['search', 'approach', 'circle', 'listen', 'retreat', 'lured', 'containment', 'breach'].includes(s.creaturePhase) || !['INVESTIGATE_SOUND', 'CIRCLE_SHELTER', 'LISTEN_NEAR', 'FOLLOW_LURE', 'WAIT', 'TAUNT', 'RETREAT'].includes(s.tactic) || !['SHELTER', 'EMITTER_A', 'EMITTER_B', 'CONTAINMENT', 'NONE'].includes(s.target) || !['GEMINI', 'FALLBACK'].includes(s.proposalSource)) throw new SenderError('Invalid summary');
  let lastSequence = row.lastSequence;
  const next = [...row.events];
  for (const item of args.events) {
    if (item.seq <= lastSequence) continue; // Reconnects can resend an acknowledged batch.
    if (item.seq > 5000 || !Number.isFinite(item.time) || item.time < 0 || item.time > 3600 || item.id.length > 128 || item.detail.length > 180 || !/^[A-Za-z0-9_.:-]+$/.test(item.id) || !eventTypes.has(item.type)) throw new SenderError('Invalid event');
    next.push({ ...item, detail: safeDetail(item.type, item.detail) });
    lastSequence = item.seq;
  }
  ctx.db.session.id.update({ ...row, lastSequence, summary: s, events: next.slice(-100) });
  applyTraceImpulses(ctx, row.id, next.filter(e => e.seq > row.lastSequence));
});

export const removeSession = db.reducer({ id: t.string(), ownerCapability: t.string() }, (ctx, args) => {
  ownerSession(ctx, args.id, args.ownerCapability);
  ctx.db.session.id.delete(args.id);
  dropPhysics(ctx, args.id); dropVitals(ctx, args.id);
});

const judgeRow = t.row('JudgeSnapshotRow', {
  id: t.string().primaryKey(), seed: t.u32(), mode: t.string(), summary, events: t.array(event),
});
export const judgeTrace = db.anonymousView(
  { name: 'judge_trace', public: true },
  { id: t.string(), judgeCapability: t.string() },
  t.array(judgeRow),
  (ctx, args) => {
    const row = ctx.db.session.id.find(args.id);
    if (!row || !capability(args.judgeCapability) || row.judgeCapability !== args.judgeCapability || !row.summary) return [];
    return [{ id: row.id, seed: row.seed, mode: row.mode, summary: row.summary, events: row.events }];
  },
);

// Additive layers: cosmetic prop physics and consented spectator vitals (docs/PHYSICS.md, docs/SPECTATE.md).
export const physics = physicsExports(db);
export const spectate = spectateExports(db);
