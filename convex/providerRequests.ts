import { v } from 'convex/values';
import { internalMutation } from './server';
import { authorize } from './auth';
import { MONSTER_MIN_INTERVAL_MS } from '../src/integrations/contracts';

export const claim = internalMutation({ args: { sessionId: v.id('sessions'), capability: v.string(), requestId: v.string(), kind: v.union(v.literal('director'), v.literal('speech'), v.literal('monster')) }, handler: async (ctx, args) => {
  const session = await authorize(ctx, args.sessionId, args.capability);
  if (args.requestId.length > 128) throw new Error('Invalid request ID');
  const existing = await ctx.db.query('requests').withIndex('session_request', q => q.eq('sessionId', args.sessionId).eq('requestId', args.requestId)).unique();
  if (existing) return null;
  const now = Date.now();
  if (now - (args.kind === 'director' ? session.lastDirectorAt : args.kind === 'monster' ? session.lastMonsterAt ?? 0 : session.lastSpeechAt) < (args.kind === 'director' ? 12_000 : args.kind === 'monster' ? MONSTER_MIN_INTERVAL_MS : 1500)) return null;
  await ctx.db.patch(args.sessionId, args.kind === 'director' ? { lastDirectorAt: now } : args.kind === 'monster' ? { lastMonsterAt: now } : { lastSpeechAt: now });
  return ctx.db.insert('requests', { sessionId: args.sessionId, requestId: args.requestId, kind: args.kind, createdAt: now, status: 'pending', latencyMs: 0, source: 'pending', outcome: 'pending' });
} });
export const finish = internalMutation({ args: { id: v.id('requests'), source: v.string(), latencyMs: v.number(), outcome: v.string() }, handler: async (ctx, args) => {
  const request = await ctx.db.get(args.id);
  if (request?.status !== 'pending') return;
  await ctx.db.patch(args.id, { status: 'complete', source: args.source, latencyMs: args.latencyMs, outcome: args.outcome.slice(0, 180) });
} });
