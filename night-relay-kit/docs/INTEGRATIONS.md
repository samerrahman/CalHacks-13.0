# Integration reference — checked 2026-10-24

These are selected official documentation entry points and implementation decisions. The event rubric is the user's supplied Oct 23 prize listing; do not replace it with a generic sponsor marketing page. Documentation evolves: inspect installed types and current docs before coding. This kit has no API keys and makes no claim that live integrations were tested. No need to integrate every optional sponsor below.

## Primary stack

| Component | Choice | Responsibility |
|---|---|---|
| Scene | Three.js, TypeScript, Vite; React for menus/overlay | Local 3D view, interaction, deterministic simulation |
| Desktop shell | Electron on a supported Presage machine | Camera SDK and secure bridge; plain browser mode for nonbiometric preview |
| Human sensing | Presage SmartSpectra | Genuine camera-derived pulse, quality and timestamps |
| Tactical director | Gemini structured output | Select a legal tactic using observable history |
| Voice | ElevenLabs | Same fictional supervisor voice for genuine and imitation messages |
| Backend | Convex | Sessions, ordered event records, provider actions, live judge overlay and replay |

### Presage: first-hour feasibility gate

Read [Node/Electron overview](https://smartspectra.presagetech.com/docs/nodejs/), [API](https://smartspectra.presagetech.com/docs/nodejs/api-reference), [metric configuration](https://smartspectra.presagetech.com/docs/nodejs/metrics), [capture quality](https://smartspectra.presagetech.com/docs/measurement-quality/), [model limits](https://smartspectra.presagetech.com/docs/model-cards-and-limitations/), and [telemetry](https://smartspectra.presagetech.com/docs/telemetry-and-privacy/).

The currently documented package is `@smartspectra/node-sdk` with native platform packages. Node >=20 is listed, with 24 recommended. Supported targets listed are macOS ARM64, Linux x64/ARM64 (glibc >=2.35), and Windows x64. Do not assume an Intel Mac or a plain browser can load this binding. Run the official Electron sample linked from the overview on the demo laptop first. Native runtime delivery and camera permissions are the schedule risk.

The API exposes `SmartSpectraSDK`, a `metrics` event and `decodeMetrics`. Explicitly request cardiac metrics: do not rely on defaults. A callback contains binary metrics plus a timestamp; inspect decoded types rather than inventing a `heartRate` property. The docs recommend the renderer media-stream route for Electron. Follow their current sample/preload architecture, including `useMediaStream()`, rather than exposing Node wholesale to the renderer. Await `stopAsync()` and `destroy()` as appropriate; do not block the UI thread waiting for completion. Capture and translate typed errors into actionable statuses.

Pulse is documented as a 12-second average over 40–110 BPM. Breathing uses a 30-second window over 5–40 breaths/min; HRV uses a longer window and is out of scope here. Motion, flickering light and unsuitable capture can produce unreliable readings, including apparently confident ones. Maintain stable lighting and use SDK capture validation, not confidence alone. No medical/fear-detection claim is justified by this game. Validate the official ranges for the actual SDK version before shipping.

The telemetry page describes aggregate diagnostics, excludes video/metric values from that telemetry, and documents `enableTelemetry = false`. This is a statement about diagnostics, not a blanket assertion about the whole measurement pipeline. Confirm provider processing and privacy disclosures for the chosen runtime, keep our own event payloads free of video, and stop capture when permission is revoked.

Our internal adapter shape (NOT a provider response schema):

```ts
type SensorSample = {
  source: 'presage' | 'simulated';
  receivedAtMs: number; // app monotonic clock, when callback received
  measuredAtMs: number | null; // mapped SDK clock, only if documented
  pulseBpm: number | null;
  breathingBpm: number | null;
  quality: 'accepted' | 'rejected' | 'unknown';
  qualityReasons: string[];
  nativeConfidence: unknown; // retained locally; normalize only with verified semantics
};
```

Ensure sample freshness uses the app clock, not Unix time compared with an SDK monotonic timestamp. Do not reuse an old sample across camera resets. Reset baseline only by explicit calibration, not whenever the player's pulse increases.

### Gemini: strategy, not physics

Read [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output). Configure a JSON schema and use current Google GenAI SDK types. Set `GEMINI_MODEL` to an available model supporting the required schema in the team's account; don't copy an old preview model name blindly. Structured output helps enforce shape, but cannot establish action legality or truth. Validate each proposal against the current state. Use `reference/director.schema.json` and `prompts/MONSTER_DIRECTOR.txt` as authored contracts.

Send one compact observation object per encounter; never send camera frames, credentials, the private challenge key or hidden future schedules. `allowedTactics` is built by game code. Store returned tactic, selected evidence IDs, accepted/rejected status and provider latency. Evidence IDs are an inspectable action trace, not the model's hidden reasoning. If a call times out, play the seeded fallback and label it. Keep token count and request rate capped. Increment stateVersion for encounter-relevant transitions (task change, creature transition, reset), not every render frame or energy tick; otherwise every asynchronous proposal will be stale. Recheck current door state and legality at commit regardless of version equality.

### ElevenLabs: impersonation that is actually part of the game

Read [streaming TTS](https://elevenlabs.io/docs/api-reference/text-to-speech/stream) and [sound generation](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert). Speech is `POST /v1/text-to-speech/{voice_id}/stream`, with `xi-api-key`, JSON text and a selected model. Verify available voices/models in the account. Both boss and fake use the same authorized fictional voice ID and radio processing. Do not clone a real person without permission.

Request speech through a server action or a tightly restricted desktop-main adapter. Never expose the API key in Vite environment variables or public Convex queries. Prefetch predictable tutorial lines. Runtime lines are queued with encounter ID, expiry and interrupt priority; cancel/discard obsolete lines. A fake order that arrives after its threat is resolved must not play. Subtitles always remain available; speech failure must not stop the game.

`tools/generate_voices.py` uses this HTTP contract to create the authored starter lines. It has not been run with credentials. It produces MP3s only when explicitly invoked. The bundled WAVs are locally synthesized effects, not ElevenLabs outputs. For the prize, demonstrate a genuinely generated line in response to current game state; merely including an unexecuted API adapter is insufficient.

### Convex: visible live state and useful replay

Read [React quickstart](https://docs.convex.dev/quickstart/react), [actions](https://docs.convex.dev/functions/actions), and [scheduling](https://docs.convex.dev/scheduling/scheduled-functions). Actions perform external provider calls; database operations occur through queries/mutations. Capture intent in a mutation and schedule an internal action when persistence and retries matter. Store keys as server environment variables. Keep the 60 Hz game loop local; publish events and low-frequency summaries only.

Suggested tables: sessions (owner/session capability hash, seed, mode, status); events (sessionId, sequence, gameTime, type, payload); directorRequests (id, sessionId, stateVersion, expiry, status); decisions (tactic, evidence IDs, provider, outcome); optional metricSummaries (coarse derived trend, quality, age). Raw BPM upload is off by default; local processing can supply trend only.

Use owner-scoped access or a random expiring session capability validated on every operation. Never make all events/metrics publicly readable. A judge-view token can expose an explicitly consented session's sanitized trace. Deduplicate events by session+sequence; backfill after reconnect without rerunning actions. Requests have at-most-one commit even if external work is retried. Backend failures must leave the local deterministic game playable and clearly labeled offline.

### Engine and asset use

Read [Three.js installation](https://threejs.org/manual/pages/installation.html), [game responsibilities](https://threejs.org/manual/pages/game.html), [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html), and [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).

Load assets with `GLTFLoader` and drive their clips with `AnimationMixer`. Geometry is uncompressed, meter-scaled, Y-up. The mimic faces +Z; rotate it toward the booth. Environment origin is room center. Place shutter roots at x=-4/+4, y=0, z=0. `shutter_leaf` moves upward. Do not scale the whole world differently from interaction positions. Clone materials before per-instance color changes. Dispose renderer, geometries, textures, sounds, subscriptions and mixers on restart/unmount.

Use context isolation and disable renderer Node integration. IPC should expose only start/stop/read-status/subscription methods, not arbitrary shell/filesystem/network execution. Serve local app resources with a restrictive CSP. Keep API secrets in trusted processes. A desktop demo on one laptop is the delivery target; cross-platform installers are optional.

## Optional sponsor paths — do not delay the core loop

**Cartesia:** [TTS WebSocket](https://docs.cartesia.ai/api-reference/tts/websocket). A meaningful variant is an interruptible supervisor conversation, with context IDs and cancellation for outdated speech. Use Cartesia for both real and fake supervisor voices to preserve the disguise; use ElevenLabs for dynamic environmental audio if targeting both. This changes the implementation plan: don't casually assign one distinguishable provider voice to each role. Include actual live behavior and the required two-minute demo/README if entering.

**Backboard:** [memory concepts](https://docs.backboard.io/concepts/memory) and [messages](https://docs.backboard.io/api-reference/threads/send-message). Store observed gameplay preferences between runs, such as "usually verifies IDs". The documented memory is assistant-scoped across threads; isolate by player instead of sharing one assistant's memory across everybody. Do not store private verification keys or health readings. This is an optional second-run demonstration, not required for the first shift.

**SpacetimeDB:** [TypeScript docs](https://spacetimedb.com/docs/sdks/typescript/). An alternate backend if you later make genuinely shared live gameplay. Do not add it alongside Convex merely for a second database track. No multiplayer is planned for this two-day build.

**Tiger Data:** useful only if you implement a meaningful time-series encounter replay/analysis feature. A second storage system is unnecessary for the MVP. Before adding it, read current hypertable and client documentation; this kit does not include a verified Tiger Data adapter.

The same principle applies to Factory, Fetch, hosting and identity tracks: no submission claim without meaningful functioning use. Sponsor APIs and access may change. Each optional path requires its own integration test before it is listed as complete.

## Optional art sources

- [Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit): the publisher labels the pack CC0; an optional environment polish source.
- [Quaternius Animated Monster Pack](https://quaternius.com/packs/animatedmonster.html): publisher labels CC0; formats shown include FBX/OBJ/Blend, so budget conversion/import work if replacing our GLB creature.

Neither pack was downloaded into this kit. Preserve the actual downloaded license and attribution metadata if using them. The included original geometry already covers every MVP model, so external art is not a dependency.
