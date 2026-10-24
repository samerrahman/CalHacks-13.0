// CONTRACT — changes need team approval in chat first. Producer: Samer. Consumers: everyone.

/** How often the signal bus publishes a SignalFrame. */
export const SIGNAL_HZ = 10

/**
 * One snapshot of the player's body, published ~10x per second by the signal bus.
 * Nullable numbers are null when the source can't measure them right now.
 *
 * @typedef {Object} SignalFrame
 * @property {number} t                     ms since epoch (Date.now())
 * @property {'presage'|'mock'|'replay'} source
 * @property {boolean} faceDetected         false = camera off or face lost; the game should fall back gracefully
 * @property {number|null} pulseBpm
 * @property {number} pulseConfidence       0..1 — ignore pulse below ~0.5
 * @property {number} breath                live breathing trace, -1 (fully out) .. 1 (fully in)
 * @property {number|null} breathRate       breaths per minute
 * @property {boolean} breathHeld           true while the player is holding their breath
 * @property {number} breathConfidence      0..1
 * @property {number|null} hrvMs            heart-rate variability (RMSSD, ms); higher = calmer
 * @property {boolean} blink                true only on the frame a blink was detected
 * @property {boolean} talking              true while the player is speaking
 * @property {number} fear                  0..1 estimated fear probability
 * @property {number|null} baselinePulseBpm resting pulse from calibration; null until calibrated
 */

export {}
