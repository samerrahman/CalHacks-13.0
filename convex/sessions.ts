import { v } from 'convex/values';
import { mutation, query } from './server';
import { authorize, hashCapability } from './auth';

export const create = mutation({ args: { ownerCapability: v.string(), judgeCapability: v.string(), consent: v.boolean(), seed: v.number(), mode: v.string() }, handler: async (ctx, args) => {
  if (!args.consent) throw new Error('Trace sharing requires explicit consent');
  return ctx.db.insert('sessions', { ownerHash: await hashCapability(args.ownerCapability), judgeHash: await hashCapability(args.judgeCapability), consent: args.consent, seed: args.seed, mode: args.mode.slice(0, 16), expiresAt: Date.now() + 24 * 60 * 60 * 1000, summary: null, lastSequence: 0, lastDirectorAt: 0, lastSpeechAt: 0 });
} });
export const get = query({ args: { sessionId: v.id('sessions'), capability: v.string() }, handler: async (ctx, args) => {
  const session = await authorize(ctx, args.sessionId, args.capability, true);
  const events = await ctx.db.query('events').withIndex('session_sequence', q => q.eq('sessionId', args.sessionId)).order('desc').take(100);
  return { seed: session.seed, mode: session.mode, summary: session.summary, events: events.reverse().map(({ id, seq, time, type, detail }) => ({ id, seq, time, type, detail })) };
} });
export const remove = mutation({ args: { sessionId: v.id('sessions'), capability: v.string() }, handler: async (ctx, args) => {
  await authorize(ctx, args.sessionId, args.capability);
  for (const event of await ctx.db.query('events').withIndex('session_sequence', q => q.eq('sessionId', args.sessionId)).collect()) await ctx.db.delete(event._id);
  for (const request of await ctx.db.query('requests').withIndex('session_request', q => q.eq('sessionId', args.sessionId)).collect()) await ctx.db.delete(request._id);
  await ctx.db.delete(args.sessionId);
} });
