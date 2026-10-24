"use node";
import { v } from 'convex/values';
import { makeFunctionReference } from 'convex/server';
import { action } from './server';
import { geminiProposal } from '../src/integrations/providers';
import { publicDirectorRequest } from '../src/integrations/contracts';

export const propose = action({ args: { sessionId: v.id('sessions'), capability: v.string(), request: v.any() }, handler: async (ctx, args) => {
  const request = publicDirectorRequest(args.request);
  const id = await ctx.runMutation(makeFunctionReference<'mutation'>('providerRequests:claim'), { sessionId: args.sessionId, capability: args.capability, requestId: request.requestId, kind: 'director' });
  if (!id) return { proposal: null, source: 'fallback', latencyMs: 0, reason: 'Duplicate or rate-limited provider request' };
  const result = await geminiProposal(request, process.env);
  await ctx.runMutation(makeFunctionReference<'mutation'>('providerRequests:finish'), { id, source: result.source, latencyMs: result.latencyMs, outcome: result.reason ?? 'proposal received; local validation required' });
  return result;
} });
