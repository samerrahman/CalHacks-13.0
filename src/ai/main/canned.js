/** @typedef {import('../../../shared/types/director.js').DirectorRequest} DirectorRequest */
/** @typedef {import('../../../shared/types/director.js').DirectorResponse} DirectorResponse */

/**
 * Offline director: no API calls, so the game never waits on the network during dev.
 * Also the fallback when Gemini is unconfigured, slow or errors.
 * @param {DirectorRequest} req
 * @returns {DirectorResponse}
 */
export function cannedDecide(req) {
  const { pulseBpm, baselinePulseBpm } = req.player
  if (pulseBpm !== null && baselinePulseBpm !== null && pulseBpm > baselinePulseBpm + 30 && req.menu.includes('quiet_moment')) {
    return { event: 'quiet_moment', intensity: 0, reason: 'pulse far above baseline', source: 'canned' }
  }

  const options = req.menu.filter((e) => e !== 'quiet_moment')
  const event = options.length ? options[Math.floor(Math.random() * options.length)] : 'quiet_moment'
  return { event, intensity: 0.3 + Math.random() * 0.4, reason: 'random pick', source: 'canned' }
}
