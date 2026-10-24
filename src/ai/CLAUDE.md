# /src/ai — Lucy (Person 4: AI, wellness & pitch)

The director (Gemini), radio voice (Cartesia) and any generated dialogue. **`src/ai/main/` runs in the Electron main process**, where the keys from `.env` live. The game reaches it only through `window.scary.director.decide()` and `window.scary.voice.speak()` (`shared/types/bridge.js`).

Already set up: `gemini.js` and `cartesia.js` build lazy clients (null when a key is missing). `canned.js` is the offline director, and `index.js` wires the IPC handlers. Run `npm run providers` to check your keys. Don't build features until the team confirms the design.

## Director (Gemini, `@google/genai` 2.x)
- `getGemini().models.generateContent({ model: geminiModel(), contents, config })`, with `config.responseMimeType: 'application/json'` and **`config.responseJsonSchema`** (plain JSON Schema; `responseSchema` is a different, OpenAPI-style type). Build the schema per request, with `event` as an `enum` of `request.menu`. If the menu is empty, skip the call, because `enum: []` is invalid.
- Read `response.text` and `JSON.parse` it inside its own try. The text can be undefined (blocked prompt) or truncated (`finishReason: 'MAX_TOKENS'`; the token cap includes thinking tokens).
- **Validate before returning:** `event ∈ request.menu`, clamp `intensity` to 0..1, cap `line` length (the schema can't enforce `maxLength`), and stamp `source: 'gemini'` in code. Any failure returns `cannedDecide(req)`.
- **Safety rules run first, in plain code,** and override the model. For example, pulse far above baseline means `quiet_moment` with `source: 'safety'`.
- Latency: the client already has a 2 s timeout. Timeouts reject with an `AbortError`, and HTTP failures throw `ApiError` with `.status`. Don't turn on `retryOptions`. Thinking: `thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }` on Flash-Lite models; models such as `gemini-3.8-flash` need `LOW` instead. Never send `thinkingLevel` and `thinkingBudget` together. Don't send `temperature`/`topP`/`topK`; newer models ignore them and will start rejecting them.
- Never send camera frames, secrets or hidden game answers in the request. Round biometric values.

## Voice (Cartesia, `@cartesia/cartesia-js` 4.x)
- One-shot: `getCartesia().tts.generate({ model_id, transcript, voice: voiceId, output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 44100 }, language: 'en' }, { signal })` returns a fetch `Response`. Return `await res.arrayBuffer()` from the `voice:speak` handler, and the renderer plays it with `decodeAudioData`. The SDK timeout covers only the response headers, so pass `signal: AbortSignal.timeout(8000)` for a total deadline.
- Live, interruptible lines: `tts.websocket()` with one context per line and `ctx.cancel()` to drop outdated ones. Cancelled audio that's already generating still arrives, so drop chunks for dead lines yourself. The socket only gives raw PCM, so build AudioBuffers by hand. Bind the `error` listener before connecting.
- **Same voice id, model and settings for genuine and fake lines**, so the disguise holds. Don't use clone, localize or voice-changer features on anyone's real voice.
- Don't copy model IDs from the SDK README or its type unions: some are retired. Use `cartesiaVoice().model`. The free plan allows 2 concurrent lines and about 25 minutes of speech a month, so cache predictable lines as WAV files in `/assets/audio`.
- Cap the text length in the handler, since credits are charged per character.

## Also yours
- `/src/wellness`, sample data, the Devpost write-up and the demo video. Ask Samer for any new dependency.
