# /src/ai — Lucy (Person 4: AI, wellness & pitch)

The director, Mimic dialogue and voice. **`src/ai/main/` runs in the Electron main process**, where the API keys from `.env` live. The game reaches it only through `window.scary.director.decide()` and `window.scary.voice.speak()` (`shared/types/bridge.js`).

## Director
- Input `DirectorRequest`, output `DirectorResponse` (`shared/types/director.js`). `event` **must** be one of `request.menu`.
- `canned.js` already works offline. Keep it as the fallback for timeouts (~2 s), errors and `stop_reason: "refusal"`.
- **Safety rules run before Claude and override it.** Examples: if pulse stays far above baseline, or the player has died twice in a row, return `quiet_moment` with `source: 'safety'`. Write these rules in plain code, not in the prompt.
- Claude call: before writing it, run `/claude-api` in Claude Code. Use the `@anthropic-ai/sdk` package with model `claude-opus-5-5` at low effort for latency, and constrain output to JSON with structured outputs (`output_config.format`), with `event` as an enum of the request's menu. Ask Samer to add the dependency.
- Log every pick and its `reason`. This makes good material for the Devpost and for judges' questions.

## Voice (Cartesia)
- `voice.speak({ text, voice })` returns audio bytes, or `null` when unavailable. The game shows subtitles either way.
- Ask Samer for `@cartesia/cartesia-js`. The key is `CARTESIA_API_KEY` in `.env`.

## Also yours
- `/src/wellness`, sample journal data, the Devpost write-up and the demo video.
