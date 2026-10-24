// CONTRACT — changes need team approval in chat first. Storage: Samer. Journal UI: Lea. Wellness: Lucy.

/**
 * One play session, saved when it ends.
 *
 * @typedef {Object} SessionRecord
 * @property {string} id
 * @property {number} startedAt                 ms since epoch
 * @property {number|null} endedAt
 * @property {number} nightsPlayed
 * @property {number} deaths
 * @property {Object} stats
 * @property {number|null} stats.baselinePulseBpm
 * @property {number|null} stats.avgPulseBpm
 * @property {number|null} stats.peakPulseBpm
 * @property {number|null} stats.avgBreathRate
 * @property {number} stats.scares
 * @property {number} stats.longestCalmMs      longest stretch near baseline pulse
 * @property {number} plantsGrown
 * @property {import('./events.js').GameEvent[]} events
 * @property {boolean} [isSample]               demo data — the journal must label it as sample
 */

/**
 * A wellness check-in, usually right after a session.
 *
 * @typedef {Object} CheckIn
 * @property {string} id
 * @property {string|null} sessionId
 * @property {number} at                        ms since epoch
 * @property {1|2|3|4|5} mood                   1 = awful, 5 = great
 * @property {number} stress                    0..10 self-reported
 * @property {string} [note]
 * @property {string[]} tipIds                  tips shown, from the wellness library
 * @property {boolean} [isSample]
 */

export {}
