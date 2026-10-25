import { table, t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import { capability, ownedSession, type HushCtx, type HushDb } from './access';

// Live vitals for friends who spectate a consenting run. One row per session holding only the
// latest coarse reading: no history, no camera data. It exists only while the player keeps the
// separate "share live heart rate" consent on; turning it off deletes the row.
export const spectatorVitals = table({ name: 'spectator_vitals' }, {
  sessionId: t.string().primaryKey(),
  sequence: t.u32(),
  source: t.string(),
  status: t.string(),
  quality: t.string(),
  trend: t.string(),
  pulseBpm: t.option(t.u8()),
  baselineBpm: t.option(t.u8()),
  updatedAtMs: t.u64(),
});

/** A live share rewrites its row every second; one not refreshed for 15 s belongs to a player
 * who closed the game, crashed or paused, and is deleted rather than shown as current. */
export const vitalsSweep = table({ name: 'vitals_sweep' }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

const MIN_WRITE_GAP_MS = 500n;
const STALE_MS = 15_000n;
const SWEEP_EVERY_US = 5_000_000n;
const bpm = (value: number | undefined) => value === undefined || Number.isInteger(value) && value >= 40 && value <= 110;

export function dropVitals(ctx: HushCtx, sessionId: string): void { ctx.db.spectatorVitals.sessionId.delete(sessionId); }
function ensureSweep(ctx: HushCtx): void {
  if (ctx.db.vitalsSweep.count() === 0n) ctx.db.vitalsSweep.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(SWEEP_EVERY_US) });
}

const vitalsFeedRow = t.row('SpectatorVitalsRow', {
  sessionId: t.string().primaryKey(), sequence: t.u32(), source: t.string(), status: t.string(),
  quality: t.string(), trend: t.string(), pulseBpm: t.option(t.u8()), baselineBpm: t.option(t.u8()),
});

export function spectateExports(db: HushDb) {
  const shareVitals = db.reducer({
    id: t.string(), ownerCapability: t.string(), sequence: t.u32(),
    source: t.string(), status: t.string(), quality: t.string(), trend: t.string(),
    pulseBpm: t.option(t.u8()), baselineBpm: t.option(t.u8()),
  }, (ctx, args) => {
    ownedSession(ctx, args.id, args.ownerCapability);
    // Manual play has no vitals to share; simulated input stays labelled as simulated.
    if (!['presage', 'simulated'].includes(args.source) || !['starting', 'calibrating', 'ready', 'unavailable', 'paused'].includes(args.status) || !['accepted', 'rejected', 'unknown'].includes(args.quality) || !['UNKNOWN', 'STEADY', 'ELEVATED', 'RECOVERED'].includes(args.trend)) throw new SenderError('Invalid vitals');
    if (!bpm(args.pulseBpm) || !bpm(args.baselineBpm) || (args.quality === 'accepted') !== (args.pulseBpm !== undefined) || args.pulseBpm === undefined && args.trend !== 'UNKNOWN') throw new SenderError('Invalid vitals');
    const now = ctx.timestamp.toMillis(), previous = ctx.db.spectatorVitals.sessionId.find(args.id);
    const row = { sessionId: args.id, sequence: args.sequence, source: args.source, status: args.status, quality: args.quality, trend: args.trend, pulseBpm: args.pulseBpm, baselineBpm: args.baselineBpm, updatedAtMs: now };
    if (!previous) { ctx.db.spectatorVitals.insert(row); ensureSweep(ctx); return; }
    // Late or too-frequent writes are dropped quietly; the next reading replaces them.
    if (args.sequence <= previous.sequence || now - previous.updatedAtMs < MIN_WRITE_GAP_MS) return;
    ctx.db.spectatorVitals.sessionId.update(row);
  });

  const stopVitals = db.reducer({ id: t.string(), ownerCapability: t.string() }, (ctx, args) => {
    ownedSession(ctx, args.id, args.ownerCapability);
    dropVitals(ctx, args.id);
  });

  const spectatorVitalsFeed = db.anonymousView(
    { name: 'spectator_vitals_feed', public: true },
    { id: t.string(), judgeCapability: t.string() },
    t.array(vitalsFeedRow),
    (ctx, args) => {
      const session = ctx.db.session.id.find(args.id);
      const vitals = ctx.db.spectatorVitals.sessionId.find(args.id);
      if (!session || !vitals || !capability(args.judgeCapability) || session.judgeCapability !== args.judgeCapability) return [];
      const { updatedAtMs: _clock, ...visible } = vitals;
      return [visible];
    },
  );

  const sweepVitals = db.reducer({ onSchedule: vitalsSweep }, { arg: vitalsSweep.rowType }, (ctx, { arg }) => {
    const cutoff = ctx.timestamp.toMillis() - STALE_MS;
    for (const row of [...ctx.db.spectatorVitals.iter()]) if (row.updatedAtMs < cutoff) ctx.db.spectatorVitals.sessionId.delete(row.sessionId);
    if (ctx.db.spectatorVitals.count() === 0n) ctx.db.vitalsSweep.scheduledId.delete(arg.scheduledId);
  });

  return db.exportGroup({ shareVitals, stopVitals, spectatorVitalsFeed, sweepVitals });
}
