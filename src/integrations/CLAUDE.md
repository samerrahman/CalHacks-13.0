# /src/integrations — Lucy (`providers.ts`) · Samer (`client.ts`) · team (`contracts.ts`)

`providers.ts` holds the Gemini and ElevenLabs adapters. They run only in the Electron main process or Convex actions, never in the renderer. `client.ts` is the renderer's transport (Electron bridge, Convex, local judge channel). `contracts.ts` defines the public payloads and must never include the private challenge, camera frames or raw pulse.

## Gemini (`@google/genai` 2.31, model `gemini-3.5-flash-lite`, live-tested)
- Structured output: `config.responseMimeType: 'application/json'` plus `config.responseJsonSchema` (plain JSON Schema). Narrow the tactic enum to the legal set per request. The model only proposes; the reducer revalidates.
- Don't send `temperature`/`topP`/`topK`, which newer models reject. Flash-Lite supports `thinkingLevel: MINIMAL`. Never set `thinkingLevel` and `thinkingBudget` together.
- Timeouts reject with `AbortError`, and HTTP failures throw `ApiError` (`.status`). Every failure falls back to the seeded director and is labeled FALLBACK.

## Voice (ElevenLabs)
- Implemented, but not yet tested live: it needs `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL_ID`. Use one authorized voice and the same radio processing for Mara and the fake. To qualify for the prize, the demo needs a real generated line that depends on game state.
- Cartesia is optional extra scope (the kit's "interruptible supervisor" idea). Only add it after the core voice works, and keep the same voice for both roles.

## Known follow-up (Samer)
- `client.ts` creates `new ConvexClient(url)` without `{ unsavedChangesWarning: false }`. In Electron its beforeunload handler can block closing the window while a mutation is pending.
