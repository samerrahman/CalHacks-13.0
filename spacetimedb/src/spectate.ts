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

// The spectator's single FEAR reading (0–100), worked out on the player's device from their own
// camera estimates (face, heart rate, breathing, skin response). Only that one number is stored:
// no component, history or camera data. It is written after spectator_vitals under the same
// consent, is ignored while no vitals row exists, and is deleted with it.
export const spectatorFear = table({ name: 'spectator_fear' }, {
  sessionId: t.string().primaryKey(),
  sequence: t.u32(),
  source: t.string(),
  fearPct: t.option(t.u8()),
  updatedAtMs: t.u64(),
});

// The readings shown in small type under FEAR on the spectator's page (user decision, 2026-10-25):
// breathing rate, the strongest facial expression and its strength, blink rate and heart-rate
// variability, each whole-numbered on the player's device and null when not measured. Same
// consent and lifetime as the fear row; no history, waveform or camera data.
export const spectatorSignals = table({ name: 'spectator_signals' }, {
  sessionId: t.string().primaryKey(),
  sequence: t.u32(),
  source: t.string(),
  breathingRpm: t.option(t.u8()),
  emotion: t.option(t.string()),
  emotionPct: t.option(t.u8()),
  blinksPerMinute: t.option(t.u8()),
  hrvMs: t.option(t.u16()),
  updatedAtMs: t.u64(),
});
export const EXPRESSIONS = ['angry', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'];

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

export function dropVitals(ctx: HushCtx, sessionId: string): void { ctx.db.spectatorVitals.sessionId.delete(sessionId); ctx.db.spectatorFear.sessionId.delete(sessionId); ctx.db.spectatorSignals.sessionId.delete(sessionId); }
function ensureSweep(ctx: HushCtx): void {
  if (ctx.db.vitalsSweep.count() === 0n) ctx.db.vitalsSweep.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(SWEEP_EVERY_US) });
}

const fearFeedRow = t.row('SpectatorFearRow', {
  sessionId: t.string().primaryKey(), sequence: t.u32(), source: t.string(), fearPct: t.option(t.u8()),
});

const signalsFeedRow = t.row('SpectatorSignalsRow', {
  sessionId: t.string().primaryKey(), sequence: t.u32(), source: t.string(), breathingRpm: t.option(t.u8()), emotion: t.option(t.string()),
  emotionPct: t.option(t.u8()), blinksPerMinute: t.option(t.u8()), hrvMs: t.option(t.u16()),
});

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

  const shareFear = db.reducer({
    id: t.string(), ownerCapability: t.string(), sequence: t.u32(), source: t.string(), fearPct: t.option(t.u8()),
  }, (ctx, args) => {
    ownedSession(ctx, args.id, args.ownerCapability);
    if (!['presage', 'simulated'].includes(args.source) || args.fearPct !== undefined && !(Number.isInteger(args.fearPct) && args.fearPct <= 100)) throw new SenderError('Invalid fear');
    // Same consent as the heart rate: without a live vitals row (never shared, withdrawn, swept) a
    // late or stray write is dropped, so a withdrawal can never be undone by one still in flight.
    // It must also carry the vitals row's source, so a simulated reading can never pass as Presage.
    const vitals = ctx.db.spectatorVitals.sessionId.find(args.id);
    if (!vitals || vitals.source !== args.source) return;
    const now = ctx.timestamp.toMillis(), previous = ctx.db.spectatorFear.sessionId.find(args.id);
    const row = { sessionId: args.id, sequence: args.sequence, source: args.source, fearPct: args.fearPct, updatedAtMs: now };
    if (!previous) { ctx.db.spectatorFear.insert(row); ensureSweep(ctx); return; }
    if (args.sequence <= previous.sequence || now - previous.updatedAtMs < MIN_WRITE_GAP_MS) return;
    ctx.db.spectatorFear.sessionId.update(row);
  });

  const shareSignals = db.reducer({
    id: t.string(), ownerCapability: t.string(), sequence: t.u32(), source: t.string(), breathingRpm: t.option(t.u8()), emotion: t.option(t.string()),
    emotionPct: t.option(t.u8()), blinksPerMinute: t.option(t.u8()), hrvMs: t.option(t.u16()),
  }, (ctx, args) => {
    ownedSession(ctx, args.id, args.ownerCapability);
    const within = (value: number | undefined, low: number, high: number) => value === undefined || Number.isInteger(value) && value >= low && value <= high;
    if (!['presage', 'simulated'].includes(args.source) || !within(args.breathingRpm, 4, 60) || !within(args.emotionPct, 0, 100) || !within(args.blinksPerMinute, 0, 120) || !within(args.hrvMs, 1, 400)
      || args.emotion !== undefined && !EXPRESSIONS.includes(args.emotion) || (args.emotion === undefined) !== (args.emotionPct === undefined)) throw new SenderError('Invalid signals');
    // Same rule as the fear row: only beside a live vitals row of the same source.
    const vitals = ctx.db.spectatorVitals.sessionId.find(args.id);
    if (!vitals || vitals.source !== args.source) return;
    const now = ctx.timestamp.toMillis(), previous = ctx.db.spectatorSignals.sessionId.find(args.id);
    const row = { sessionId: args.id, sequence: args.sequence, source: args.source, breathingRpm: args.breathingRpm, emotion: args.emotion, emotionPct: args.emotionPct, blinksPerMinute: args.blinksPerMinute, hrvMs: args.hrvMs, updatedAtMs: now };
    if (!previous) { ctx.db.spectatorSignals.insert(row); ensureSweep(ctx); return; }
    if (args.sequence <= previous.sequence || now - previous.updatedAtMs < MIN_WRITE_GAP_MS) return;
    ctx.db.spectatorSignals.sessionId.update(row);
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

  const spectatorFearFeed = db.anonymousView(
    { name: 'spectator_fear_feed', public: true },
    { id: t.string(), judgeCapability: t.string() },
    t.array(fearFeedRow),
    (ctx, args) => {
      const session = ctx.db.session.id.find(args.id);
      const fear = ctx.db.spectatorFear.sessionId.find(args.id);
      if (!session || !fear || !ctx.db.spectatorVitals.sessionId.find(args.id) || !capability(args.judgeCapability) || session.judgeCapability !== args.judgeCapability) return [];
      const { updatedAtMs: _clock, ...visible } = fear;
      return [visible];
    },
  );

  const spectatorSignalsFeed = db.anonymousView(
    { name: 'spectator_signals_feed', public: true },
    { id: t.string(), judgeCapability: t.string() },
    t.array(signalsFeedRow),
    (ctx, args) => {
      const session = ctx.db.session.id.find(args.id);
      const signals = ctx.db.spectatorSignals.sessionId.find(args.id);
      if (!session || !signals || !ctx.db.spectatorVitals.sessionId.find(args.id) || !capability(args.judgeCapability) || session.judgeCapability !== args.judgeCapability) return [];
      const { updatedAtMs: _clock, ...visible } = signals;
      return [visible];
    },
  );

  const sweepVitals = db.reducer({ onSchedule: vitalsSweep }, { arg: vitalsSweep.rowType }, (ctx, { arg }) => {
    const cutoff = ctx.timestamp.toMillis() - STALE_MS;
    for (const row of [...ctx.db.spectatorVitals.iter()]) if (row.updatedAtMs < cutoff) dropVitals(ctx, row.sessionId);
    for (const row of [...ctx.db.spectatorFear.iter()]) if (row.updatedAtMs < cutoff || !ctx.db.spectatorVitals.sessionId.find(row.sessionId)) ctx.db.spectatorFear.sessionId.delete(row.sessionId);
    for (const row of [...ctx.db.spectatorSignals.iter()]) if (row.updatedAtMs < cutoff || !ctx.db.spectatorVitals.sessionId.find(row.sessionId)) ctx.db.spectatorSignals.sessionId.delete(row.sessionId);
    if (ctx.db.spectatorVitals.count() === 0n && ctx.db.spectatorFear.count() === 0n && ctx.db.spectatorSignals.count() === 0n) ctx.db.vitalsSweep.scheduledId.delete(arg.scheduledId);
  });

  return db.exportGroup({ shareVitals, shareFear, shareSignals, stopVitals, spectatorVitalsFeed, spectatorFearFeed, spectatorSignalsFeed, sweepVitals });
}
