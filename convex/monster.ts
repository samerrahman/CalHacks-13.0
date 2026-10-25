"use node";
import { v } from 'convex/values';
import { makeFunctionReference } from 'convex/server';
import { action } from './server';
import { generateMonster } from '../src/integrations/providers';
import { publicMonsterRequest, authoredMonsterFallback } from '../src/integrations/contracts';

export const generate = action({ args: { sessionId: v.id('sessions'), capability: v.string(), request: v.any() }, handler: async (ctx, args) => {
  const request = publicMonsterRequest(args.request);
  const id = await ctx.runMutation(makeFunctionReference<'mutation'>('providerRequests:claim'), { sessionId: args.sessionId, capability: args.capability, requestId: request.requestId, kind: 'monster' });
  if (!id) return authoredMonsterFallback(request, 'Duplicate or rate-limited contextual dialogue');
  const result = await generateMonster(request, process.env);
  // Only source/latency/outcome metadata is persisted. No generated text,
  // dialogue context, camera data, raw physiology, or private puzzles.
  await ctx.runMutation(makeFunctionReference<'mutation'>('providerRequests:finish'), { id, source: `${result.textSource}/${result.speech.source}`, latencyMs: result.totalLatencyMs, outcome: result.textReason ?? result.speech.reason ?? 'Generated dialogue and matching speech' });
  return result;
} });
