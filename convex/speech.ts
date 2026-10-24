"use node";
import { v } from 'convex/values';
import { makeFunctionReference } from 'convex/server';
import { action } from './server';
import { elevenSpeech } from '../src/integrations/providers';

export const generate = action({ args: { sessionId: v.id('sessions'), capability: v.string(), request: v.object({ requestId: v.string(), caption: v.string(), encounterId: v.string(), expiresAtMs: v.number() }) }, handler: async (ctx, args) => {
  const id = await ctx.runMutation(makeFunctionReference<'mutation'>('providerRequests:claim'), { sessionId: args.sessionId, capability: args.capability, requestId: args.request.requestId, kind: 'speech' });
  if (!id) return { audioBase64: null, mimeType: 'audio/mpeg', source: 'fallback', latencyMs: 0, reason: 'Duplicate or rate-limited provider request' };
  const result = await elevenSpeech(args.request, process.env);
  await ctx.runMutation(makeFunctionReference<'mutation'>('providerRequests:finish'), { id, source: result.source, latencyMs: result.latencyMs, outcome: result.reason ?? 'speech generated' });
  return result;
} });
