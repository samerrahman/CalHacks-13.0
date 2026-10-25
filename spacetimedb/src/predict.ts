import { table, t, SenderError } from 'spacetimedb/server';
import { capability, type HushCtx, type HushDb } from './access';
import { PREDICTION_LIMITS, cleanName, predictionChoiceValid } from './predictRules';

// Spectator predictions ("will they escape?"). Anyone holding the spectate link may make one call per
// connection identity while the run is still in research stage 1 or 2; the call can be changed until then.
// The player's game never reads these. removeSession and the 24-hour expiry delete them (dropPredictions).
export const prediction = table({ name: 'prediction' }, {
  key: t.string().primaryKey(),
  sessionId: t.string().index('btree'),
  voter: t.string(),
  name: t.string(),
  choice: t.string(),
  stage: t.u8(),
  updatedAtMs: t.u64(),
});

export function dropPredictions(ctx: HushCtx, sessionId: string): void {
  for (const row of [...ctx.db.prediction.sessionId.filter(sessionId)]) ctx.db.prediction.key.delete(row.key);
}

const feedRow = t.row('PredictionRow', { key: t.string().primaryKey(), voter: t.string(), name: t.string(), choice: t.string(), stage: t.u8() });

export function predictExports(db: HushDb) {
  /** Same session id and judge capability as the spectate link. */
  const predictOutcome = db.reducer({ id: t.string(), judgeCapability: t.string(), choice: t.string(), name: t.string() }, (ctx, args) => {
    const session = ctx.db.session.id.find(args.id), now = ctx.timestamp.toMillis();
    if (!session || !capability(args.judgeCapability) || session.judgeCapability !== args.judgeCapability || session.expiresAtMs < now) throw new SenderError('Session unavailable');
    if (session.mode === 'tutorial') throw new SenderError('No predictions in practice');
    if (!predictionChoiceValid(args.choice)) throw new SenderError('Invalid prediction');
    const name = cleanName(args.name);
    if (!name) throw new SenderError('Invalid name');
    const stage = session.summary?.stage ?? 1;
    if ((session.summary && session.summary.status !== 'playing') || stage > PREDICTION_LIMITS.lastStage) throw new SenderError('Predictions closed');
    const sender = ctx.sender.toHexString(), key = `${args.id}:${sender}`, previous = ctx.db.prediction.key.find(key);
    if (previous && now - previous.updatedAtMs < BigInt(PREDICTION_LIMITS.gapMs)) throw new SenderError('Too frequent');
    if (!previous && [...ctx.db.prediction.sessionId.filter(args.id)].length >= PREDICTION_LIMITS.maxPerSession) throw new SenderError('Too many predictions');
    const row = { key, sessionId: args.id, voter: sender.slice(-8), name, choice: args.choice, stage, updatedAtMs: now };
    if (previous) ctx.db.prediction.key.update(row); else ctx.db.prediction.insert(row);
  });

  /** Every prediction for the session, for everyone holding the spectate link. */
  const predictionFeed = db.anonymousView(
    { name: 'prediction_feed', public: true },
    { id: t.string(), judgeCapability: t.string() },
    t.array(feedRow),
    (ctx, args) => {
      const session = ctx.db.session.id.find(args.id);
      if (!session || !capability(args.judgeCapability) || session.judgeCapability !== args.judgeCapability) return [];
      return [...ctx.db.prediction.sessionId.filter(args.id)].map(r => ({ key: r.voter, voter: r.voter, name: r.name, choice: r.choice, stage: r.stage }));
    },
  );

  return db.exportGroup({ predictOutcome, predictionFeed });
}
