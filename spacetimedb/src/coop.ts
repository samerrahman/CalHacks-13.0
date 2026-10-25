import { table, t, SenderError } from 'spacetimedb/server';
import { capability, ownedSession, type HushCtx, type HushDb } from './access';
import { manualRowValid } from './coopRules';

// Experimental co-op: the spectating friend reads the key for the player's live puzzle. Only a session
// created in 'coop' mode may hold a row; one row per session, the latest page only, no history.
// removeSession and the 24-hour expiry delete it (dropCoop). See docs/COOP.md.
export const coopManual = table({ name: 'coop_manual' }, {
  sessionId: t.string().primaryKey(),
  sequence: t.u32(),
  kind: t.string(),
  stage: t.u8(), panel: t.u8(), panels: t.u8(), size: t.u8(), start: t.u8(), end: t.u8(),
  values: t.array(t.u8()),
  updatedAtMs: t.u64(),
});

const MIN_WRITE_GAP_MS = 250n;

export function dropCoop(ctx: HushCtx, sessionId: string): void { ctx.db.coopManual.sessionId.delete(sessionId); }

const manualFeedRow = t.row('CoopManualRow', {
  sessionId: t.string().primaryKey(), sequence: t.u32(), kind: t.string(),
  stage: t.u8(), panel: t.u8(), panels: t.u8(), size: t.u8(), start: t.u8(), end: t.u8(), values: t.array(t.u8()),
});

export function coopExports(db: HushDb) {
  const publishManual = db.reducer({
    id: t.string(), ownerCapability: t.string(), sequence: t.u32(), kind: t.string(),
    stage: t.u8(), panel: t.u8(), panels: t.u8(), size: t.u8(), start: t.u8(), end: t.u8(), values: t.array(t.u8()),
  }, (ctx, args) => {
    const session = ownedSession(ctx, args.id, args.ownerCapability);
    if (session.mode !== 'coop') throw new SenderError('Not a co-op session');
    const { id, ownerCapability: _owner, ...manual } = args;
    if (!manualRowValid(manual)) throw new SenderError('Invalid manual');
    const now = ctx.timestamp.toMillis(), previous = ctx.db.coopManual.sessionId.find(id);
    const row = { sessionId: id, ...manual, updatedAtMs: now };
    if (!previous) { ctx.db.coopManual.insert(row); return; }
    if (args.sequence <= previous.sequence) return; // a late write; the stored page is newer
    // Refused rather than dropped, so the publisher keeps its page unsent and retries.
    if (now - previous.updatedAtMs < MIN_WRITE_GAP_MS) throw new SenderError('Too frequent');
    ctx.db.coopManual.sessionId.update(row);
  });

  /** Same session id and judge capability as the spectate link. */
  const coopManualFeed = db.anonymousView(
    { name: 'coop_manual_feed', public: true },
    { id: t.string(), judgeCapability: t.string() },
    t.array(manualFeedRow),
    (ctx, args) => {
      const session = ctx.db.session.id.find(args.id);
      const manual = ctx.db.coopManual.sessionId.find(args.id);
      if (!session || !manual || !capability(args.judgeCapability) || session.judgeCapability !== args.judgeCapability) return [];
      const { updatedAtMs: _clock, ...visible } = manual;
      return [visible];
    },
  );

  return db.exportGroup({ publishManual, coopManualFeed });
}
