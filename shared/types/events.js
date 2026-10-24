// CONTRACT — changes need team approval in chat first. Producer: James (game). Consumers: AI, storage, journal.

/** @typedef {'listener'|'watcher'|'mimic'} CreatureId */

/** @type {CreatureId[]} */
export const CREATURES = ['listener', 'watcher', 'mimic']

/** @typedef {'lamp'|'radio'|'oil'} ResourceId */

/**
 * Something that happened in the game. `t` is ms since epoch, `night` is 1-based.
 *
 * @typedef {(
 *   | { type: 'night_started', t: number, night: number }
 *   | { type: 'creature_appeared', t: number, night: number, creature: CreatureId }
 *   | { type: 'scare', t: number, night: number, creature: CreatureId, intensity: number, pulseBpm: number|null }
 *   | { type: 'player_died', t: number, night: number, creature: CreatureId, cause: string }
 *   | { type: 'night_ended', t: number, night: number, survived: boolean, durationMs: number }
 *   | { type: 'plant_grew', t: number, plantId: string, stage: number }
 * )} GameEvent
 */

export {}
