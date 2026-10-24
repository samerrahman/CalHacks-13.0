import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const summaryValidator = v.object({ time: v.number(), task: v.number(), status: v.string(), energy: v.number(), tactic: v.string(), proposalSource: v.string(), sensorSource: v.string(), sensorQuality: v.string(), trend: v.string(), sensorAgeMs: v.union(v.number(), v.null()) });
export const eventValidator = v.object({ id: v.string(), seq: v.number(), time: v.number(), type: v.string(), detail: v.string() });
export default defineSchema({
  sessions: defineTable({ ownerHash: v.string(), judgeHash: v.string(), consent: v.boolean(), seed: v.number(), mode: v.string(), expiresAt: v.number(), summary: v.union(summaryValidator, v.null()), lastSequence: v.number(), lastDirectorAt: v.number(), lastSpeechAt: v.number() }),
  events: defineTable({ sessionId: v.id('sessions'), ...eventValidator.fields }).index('session_sequence', ['sessionId', 'seq']),
  requests: defineTable({ sessionId: v.id('sessions'), requestId: v.string(), kind: v.string(), createdAt: v.number(), status: v.string(), latencyMs: v.number(), source: v.string(), outcome: v.string() }).index('session_request', ['sessionId', 'requestId']),
});
