import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { TACTICS, TARGETS } from '../src/integrations/contracts';

export const summaryValidator = v.object({ time: v.number(), stage: v.number(), status: v.union(v.literal('playing'), v.literal('won'), v.literal('lost')), equipment: v.union(v.literal('on'), v.literal('quiet'), v.literal('blackout')), creatureNode: v.union(...['SHELTER_WALL', 'WEST_WALL', 'EAST_WALL', 'NEAR_PATH', 'JUNCTION', 'EMITTER_A', 'EMITTER_B', 'CONTAINMENT'].map(n => v.literal(n))), creaturePhase: v.union(...['search', 'approach', 'circle', 'listen', 'retreat', 'lured', 'containment', 'breach'].map(p => v.literal(p))), distanceM: v.number(), tactic: v.union(...TACTICS.map(t => v.literal(t))), target: v.union(...TARGETS.map(t => v.literal(t))), proposalSource: v.union(v.literal('GEMINI'), v.literal('FALLBACK')), sensorSource: v.union(v.literal('presage'), v.literal('simulated'), v.literal('manual')), sensorQuality: v.union(v.literal('accepted'), v.literal('rejected'), v.literal('unknown')), trend: v.union(v.literal('UNKNOWN'), v.literal('STEADY'), v.literal('ELEVATED'), v.literal('RECOVERED')), sensorAgeMs: v.union(v.number(), v.null()) });
export const eventValidator = v.object({ id: v.string(), seq: v.number(), time: v.number(), type: v.string(), detail: v.string() });
export default defineSchema({
  sessions: defineTable({ ownerHash: v.string(), judgeHash: v.string(), consent: v.boolean(), seed: v.number(), mode: v.string(), expiresAt: v.number(), summary: v.union(summaryValidator, v.null()), lastSequence: v.number(), lastDirectorAt: v.number(), lastSpeechAt: v.number() }),
  events: defineTable({ sessionId: v.id('sessions'), ...eventValidator.fields }).index('session_sequence', ['sessionId', 'seq']),
  requests: defineTable({ sessionId: v.id('sessions'), requestId: v.string(), kind: v.string(), createdAt: v.number(), status: v.string(), latencyMs: v.number(), source: v.string(), outcome: v.string() }).index('session_request', ['sessionId', 'requestId']),
});
