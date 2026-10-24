/** @typedef {import('../../shared/types/signals.js').SignalFrame} SignalFrame */

/** @type {Set<(frame: SignalFrame) => void>} */
const listeners = new Set()
/** @type {SignalFrame|null} */
let latest = null

/**
 * The one place every SignalFrame flows through, whatever the source
 * (mock, Presage, replay). Read `latest()` in a game loop, or `subscribe` for events.
 */
export const signalBus = {
  /**
   * @param {(frame: SignalFrame) => void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  /** @returns {SignalFrame|null} */
  latest() {
    return latest
  },

  /** @param {SignalFrame} frame */
  publish(frame) {
    latest = frame
    for (const fn of listeners) fn(frame)
  },
}
