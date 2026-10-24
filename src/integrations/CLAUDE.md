# /src/integrations — Lucy (`providers.ts`) · Samer (`client.ts`) · team (`contracts.ts`)

`providers.ts` holds the Gemini and ElevenLabs adapters. They run only in the Electron main process or loopback Vite development middleware, never in the renderer. `client.ts` is the renderer transport. `spacetime.ts` connects to the private SpacetimeDB trace module. `contracts.ts` defines public payloads and must never include puzzle answers, camera frames, or raw pulse.

## Gemini (`@google/genai` 2.31, model `gemini-3.5-flash-lite`, live-tested)
- Structured output: `config.responseMimeType: 'application/json'` plus `config.responseJsonSchema` (plain JSON Schema). Narrow the tactic enum to the legal set per request. The model only proposes; the reducer revalidates.
- Don't send `temperature`/`topP`/`topK`, which newer models reject. Flash-Lite supports `thinkingLevel: MINIMAL`. Never set `thinkingLevel` and `thinkingBudget` together.
- Timeouts reject with `AbortError`, and HTTP failures throw `ApiError` (`.status`). Every failure falls back to the seeded director and is labeled FALLBACK.
- Number-line tactics only map to the local configured temporary probability bias. Never accept model positions, steps, probabilities, timers or attacks. Public observations add only `linePosition`, `lineLength`, `danger`, and `quietChargesRemaining`; danger is fictional difficulty. Project events through the finite whitelist and validate `MONSTER_STEP` arithmetic. Wire colors/endpoints/answers, movement RNG, detector sample clocks and raw physiology stay out.

## Contextual monster dialogue and speech
- `requestMonster` sends only a known trigger and projected public game context. Gemini returns a structured sentence with actual public event IDs as evidence. Validate it before sending that exact caption to ElevenLabs inside the trusted process. Never expose an arbitrary-text TTS bypass to the renderer.
- Optional `GEMINI_DIALOGUE_MODEL` defaults to the user-approved `gemini-3.5-flash-lite`. The separate director continues to use `GEMINI_MODEL`. Secrets stay server-side, and `.env` is user-owned.
- Dialogue text has a 5-second budget; text plus speech has a 12-second budget, further bounded by the caller's wall-clock expiry. The UI must independently discard expired/cancelled queue entries. One monster request per 18 seconds per transport; no automatic retries.
- `textSource` is `gemini` only after validated live model output; otherwise `authored-fallback`. Speech independently reports `elevenlabs`, `cached`, or `fallback`. A Gemini caption can remain available during a speech outage. Authored fallback speech must never be labeled generated text.
- ElevenLabs needs `ELEVENLABS_API_KEY`, an authorized `ELEVENLABS_VOICE_ID`, and `ELEVENLABS_MODEL_ID`. Prior successful HUSH voice tests used authored text; they do not prove the new contextual generation path. Current test evidence belongs in `docs/qa/`.
- Official APIs: [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [ElevenLabs streaming TTS](https://elevenlabs.io/docs/api-reference/text-to-speech/stream). Reviewed October 24, 2026.

## SpacetimeDB trace
- Private sessions hold only projected events and coarse summaries. A capability checked view serves the judge screen; scheduled expiration deletes sessions after 24 hours.
- Generated bindings in `src/module_bindings/` must be regenerated after module schema changes. The remote module has not yet been published or verified live.
