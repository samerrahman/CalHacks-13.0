import { GoogleGenAI } from '@google/genai'

// Read env lazily, never at module scope: electron/main.js loads .env after imports run.

/** @type {GoogleGenAI | null} */
let client = null

/** Gemini client for the main process, or null when GEMINI_API_KEY isn't set. */
export function getGemini() {
  if (client) return client
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null
  // Pin the backend and base URL so stray GOOGLE_* env vars can't reroute the key.
  client = new GoogleGenAI({
    apiKey,
    enterprise: false,
    httpOptions: { baseUrl: 'https://generativelanguage.googleapis.com/', timeout: 2000 },
  })
  return client
}

/** Model id from GEMINI_MODEL, or null if unset. Aliases like `*-latest` are refused. */
export function geminiModel() {
  const model = process.env.GEMINI_MODEL?.replace(/^models\//, '')
  if (!model || model.endsWith('-latest')) return null
  return model
}
