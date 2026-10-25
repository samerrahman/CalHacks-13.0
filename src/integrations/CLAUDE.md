# /src/integrations — Lucy (`providers.ts`) · Samer (`client.ts`, `spacetime.ts`, `spectate.ts`, `physics.ts`) · team (`contracts.ts`)

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
- Generated bindings in `src/module_bindings/` must be regenerated after module schema changes. Maincloud `scary-5zsk8` runs the earlier spectate/physics baseline, not the combined camera/co-op module (owner-published); live checks are in `docs/qa/spectate-physics-maincloud.json` and `docs/qa/spectate-physics-local-spacetime.json`. Agents must not publish; the owner runs `spacetime publish`.
- View rows (`judge_trace`, `spectator_vitals_feed`, `physics_feed`) have no client-side primary key: one update arrives as a separate insert and delete callback in server order. Re-read the settled cache (`iter()`) in callbacks; never treat a delete callback alone as "gone".
- The SDK compiles codecs with `Function()`: the page CSP needs `'unsafe-eval'` and the database host in `connect-src` (`index.html`, `electron/main.ts`).
- Spectators (`spectate.ts`, `#watch=` links) receive physiology only under the separate heart-rate consent: whole-BPM pulse and baseline, trend, quality, source. Simulated stays labelled. No history, clocks, diagnostics or camera data. See `docs/SPECTATE.md`.
- Live camera (`webrtc.ts`, module `spacetimedb/src/signal.ts`): its own per-run consent. SpacetimeDB carries only WebRTC offers, answers and ICE (validated by `signalRules.ts` on both ends, 8 KB cap, rate-limited, swept after 60 s); video is peer to peer. Desktop reuses the SensorController stream and never opens or stops a camera; the browser build may call `getUserMedia` only after that consent. See `docs/CAMERA.md`.
- Co-op (`coop.ts`, `docs/COOP.md`): the friend's manual page travels on `${channel}-coop` and the owner-written `coop_manual` row (co-op sessions only, shape-checked by `spacetimedb/src/coopRules.ts`), read through `coop_manual_feed`. Never in the trace.

- Integrated friend flow: Setup opts into co-op trace/vitals; the camera check controls optional video. TraceBridge exposes owner access only to local publishers. Stop sharing closes peers/manual publication, removes the session and restores solo hints. Detailed signal values remain local; debug controls require `?debug`.
