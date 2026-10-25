import { v } from 'convex/values';
import { mutation } from './server';
import { authorize } from './auth';
import { eventValidator, summaryValidator } from './schema';
import { publicEvent } from '../src/integrations/contracts';

export const append = mutation({ args: { sessionId: v.id('sessions'), capability: v.string(), events: v.array(eventValidator), summary: summaryValidator }, handler: async (ctx, args) => {
  const session = await authorize(ctx, args.sessionId, args.capability);
  if (!session.consent || args.events.length > 100) throw new Error('Invalid event batch');
  let lastSequence = session.lastSequence;
  for (const event of args.events) {
    if (!Number.isSafeInteger(event.seq) || event.seq < 1 || event.seq > 5000 || event.type.length > 64 || event.id.length > 128 || event.detail.length > 180) throw new Error('Invalid event');
    const prior = await ctx.db.query('events').withIndex('session_sequence', q => q.eq('sessionId', args.sessionId).eq('seq', event.seq)).unique();
    if (!prior) await ctx.db.insert('events', { sessionId: args.sessionId, ...publicEvent(event) });
    lastSequence = Math.max(lastSequence, event.seq);
  }
  // All public summaries are explicit fields: no raw pulse, secret or camera.
  await ctx.db.patch(args.sessionId, { lastSequence, summary: args.summary });
  return lastSequence;
} });
