// Convex tables. DRAFT — revisit with the team once the game design is final.
// Owner: Samer. Keep the 60 fps loop local; store events and low-frequency summaries only.
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  sessions: defineTable({
    token: v.string(), // random capability from the client; check it on every read and write
    mode: v.union(v.literal('presage'), v.literal('mock'), v.literal('replay')),
    status: v.union(v.literal('active'), v.literal('ended')),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    isSample: v.optional(v.boolean()),
  }).index('by_token', ['token']),

  events: defineTable({
    sessionId: v.id('sessions'),
    sequence: v.number(), // increasing per session; (sessionId, sequence) dedupes retries
    t: v.number(), // ms since epoch
    type: v.string(), // GameEvent.type
    payload: v.any(), // small JSON; keys must not start with $ or _
  }).index('by_session_seq', ['sessionId', 'sequence']),
})
