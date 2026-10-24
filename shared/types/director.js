// CONTRACT — changes need team approval in chat first. Game (James) asks, AI (Lucy) answers.

/**
 * Everything the director is allowed to pick. The game passes the subset that is
 * legal right now (off cooldown) in DirectorRequest.menu.
 * @type {DirectorEventId[]}
 */
export const DIRECTOR_MENU = [
  'spawn_listener',
  'spawn_watcher',
  'spawn_mimic',
  'lamp_flicker',
  'radio_static',
  'distant_sound',
  'quiet_moment',
]

/**
 * @typedef {'spawn_listener'|'spawn_watcher'|'spawn_mimic'|'lamp_flicker'|'radio_static'|'distant_sound'|'quiet_moment'} DirectorEventId
 */

/**
 * Summary the game sends every few seconds. Averages cover the last ~10 s.
 *
 * @typedef {Object} DirectorRequest
 * @property {number} night
 * @property {number} elapsedMs                 since the night started
 * @property {Object} player
 * @property {number|null} player.pulseBpm
 * @property {number|null} player.baselinePulseBpm
 * @property {number} player.fear               0..1
 * @property {number|null} player.breathRate
 * @property {number} player.blinksPerMin
 * @property {number} player.talkingRatio       0..1, share of time spent talking
 * @property {boolean} player.faceDetected
 * @property {{ lampOn: boolean, radioOn: boolean, oil: number }} resources   oil is 0..1
 * @property {import('./events.js').CreatureId[]} activeCreatures
 * @property {import('./events.js').GameEvent[]} recentEvents   last ~10
 * @property {DirectorEventId[]} menu           choices allowed right now
 */

/**
 * The director's pick. `event` must be one of request.menu.
 *
 * @typedef {Object} DirectorResponse
 * @property {DirectorEventId} event
 * @property {number} intensity                 0..1
 * @property {number} [delayMs]                 wait this long before firing
 * @property {string} [line]                    Mimic dialogue, only with spawn_mimic
 * @property {string} reason                    short rationale for logs and the journal
 * @property {'claude'|'canned'|'safety'} source
 */

export {}
