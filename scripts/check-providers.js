// `npm run providers` — confirms each provider's key and IDs work, using read-only
// calls (no generation, no credits). Never prints secrets.
import { cartesiaVoice, getCartesia } from '../src/ai/main/cartesia.js'
import { geminiModel, getGemini } from '../src/ai/main/gemini.js'

/** @param {string} name @param {'ok'|'missing'|'fail'} status @param {string} detail */
const report = (name, status, detail) =>
  console.log(`${{ ok: '✓', missing: '–', fail: '✗' }[status]} ${name.padEnd(9)} ${detail}`)

/** @param {unknown} err */
const reason = (err) => (err && typeof err === 'object' && 'status' in err ? `HTTP ${err.status}` : String(err).slice(0, 120))

async function checkGemini() {
  const ai = getGemini()
  const model = geminiModel()
  if (!ai || !model) return report('gemini', 'missing', 'set GEMINI_API_KEY and GEMINI_MODEL in .env')
  try {
    const info = await ai.models.get({ model })
    report('gemini', 'ok', `${info.name} (${info.displayName ?? 'no display name'})`)
  } catch (err) {
    report('gemini', 'fail', `${model}: ${reason(err)} — check the key and that the model exists for it`)
  }
}

async function checkCartesia() {
  const client = getCartesia()
  const { voiceId, model } = cartesiaVoice()
  if (!client) return report('cartesia', 'missing', 'set CARTESIA_API_KEY in .env')
  if (!voiceId) return report('cartesia', 'missing', 'set CARTESIA_VOICE_ID (pick a stock voice at play.cartesia.ai/voices)')
  try {
    const voice = await client.voices.get(voiceId)
    report('cartesia', 'ok', `voice "${voice.name}", model ${model}`)
  } catch (err) {
    report('cartesia', 'fail', `voice ${voiceId}: ${reason(err)}`)
  }
}

function checkConvex() {
  const url = process.env.VITE_CONVEX_URL
  if (!url) return report('convex', 'missing', 'run `npx convex dev` in a real terminal; it writes VITE_CONVEX_URL to .env.local')
  if (!/^https:\/\/[\w.-]+\.convex\.cloud\/?$/.test(url)) return report('convex', 'fail', `VITE_CONVEX_URL should be https://<name>.convex.cloud, got ${url}`)
  report('convex', 'ok', `${url} (connection is checked by the app's overlay)`)
}

function checkPresage() {
  if (!process.env.PRESAGE_API_KEY) return report('presage', 'missing', 'set PRESAGE_API_KEY in .env')
  report('presage', 'ok', 'key present (validated when the SDK starts)')
}

await checkGemini()
await checkCartesia()
checkConvex()
checkPresage()
