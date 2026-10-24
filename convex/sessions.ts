import { v } from 'convex/values';
import { mutation, query } from './server';
import { authorize, authorizeOwnerDeletion, hashCapability } from './auth';

// Read-only compatibility gate prevents a new client writing to an older game deployment.
export const version = query({ args: {}, handler: async () => ({ application: 'LOCK IN', schemaVersion: 'lock-in-v1' }) });

export const create = mutation({ args: { ownerCapability: v.string(), judgeCapability: v.string(), consent: v.boolean(), seed: v.number(), mode: v.string() }, handler: async (ctx, args) => {
  if (!args.consent) throw new Error('Trace sharing requires explicit consent');
  if (!Number.isSafeInteger(args.seed) || args.seed < 0 || args.seed > 999999 || !['standard', 'demo', 'tutorial', 'integration-smoke'].includes(args.mode)) throw new Error('Invalid session');
  return ctx.db.insert('sessions', { ownerHash: await hashCapability(args.ownerCapability), judgeHash: await hashCapability(args.judgeCapability), consent: args.consent, seed: args.seed, mode: args.mode, expiresAt: Date.now() + 24 * 60 * 60 * 1000, summary: null, lastSequence: 0, lastDirectorAt: 0, lastSpeechAt: 0 });
} });
export const get = query({ args: { sessionId: v.id('sessions'), capability: v.string() }, handler: async (ctx, args) => {
  const session = await authorize(ctx, args.sessionId, args.capability, true);
  const events = await ctx.db.query('events').withIndex('session_sequence', q => q.eq('sessionId', args.sessionId)).order('desc').take(100);
  return { seed: session.seed, mode: session.mode, summary: session.summary, events: events.reverse().map(({ id, seq, time, type, detail }) => ({ id, seq, time, type, detail })) };
} });
export const remove = mutation({ args: { sessionId: v.id('sessions'), capability: v.string() }, handler: async (ctx, args) => {
  await authorizeOwnerDeletion(ctx, args.sessionId, args.capability);
  for (const event of await ctx.db.query('events').withIndex('session_sequence', q => q.eq('sessionId', args.sessionId)).collect()) await ctx.db.delete(event._id);
  for (const request of await ctx.db.query('requests').withIndex('session_request', q => q.eq('sessionId', args.sessionId)).collect()) await ctx.db.delete(request._id);
  await ctx.db.delete(args.sessionId);
} });
