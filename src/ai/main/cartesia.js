import Cartesia from '@cartesia/cartesia-js'

// Read env lazily, never at module scope: electron/main.js loads .env after imports run.

const DEFAULT_MODEL = 'sonic-3.6-2026-08-27'

/** @type {Cartesia | null} */
let client = null

/** Cartesia client for the main process, or null when CARTESIA_API_KEY isn't set. */
export function getCartesia() {
  if (client) return client
  const apiKey = process.env.CARTESIA_API_KEY // the SDK doesn't read this on its own
  if (!apiKey) return null
  // SDK defaults (60 s, 2 retries) are far too slow for a line with a deadline.
  client = new Cartesia({ apiKey, timeout: 15_000, maxRetries: 1 })
  return client
}

/** One voice for every radio line, genuine or fake, so players can't tell them apart by ear. */
export function cartesiaVoice() {
  return {
    voiceId: process.env.CARTESIA_VOICE_ID || null,
    model: process.env.CARTESIA_MODEL || DEFAULT_MODEL,
  }
}
