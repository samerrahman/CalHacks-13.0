# Integration verification

The local game is authoritative. Provider failures never pause input or alter safety timers. All live claims below require actual evidence; a compiled adapter is not a live integration test. The latest machine-readable check is `docs/integration-checks.json` after running `npm run integrations:check`.

| Integration | Implemented path | Verified here | Remaining gate |
| --- | --- | --- | --- |
| Presage SmartSpectra 3.4.0 | Electron renderer `useMediaStream`, restricted preload/Main camera bridge, explicit `PULSE_RATE`, typed protobuf adapter, quality gate, frozen baseline, sustained trend | Native library imports on macOS 14.2.1 / Apple Silicon / Node 22.23.3; payload and signal-boundary tests pass | No live camera capture, accepted estimate, calibration or in-game sensor response yet. Requires provisioned cardiac key and explicit camera setup |
| Gemini / Google GenAI 2.31.0 | Server/main structured output; user-approved `gemini-3.5-flash-lite`; public observation projection; timeout and deterministic local fallback | **LIVE passed:** model lookup and full validator accepted `WAIT` in 3887 ms. Actual Electron game applied `PROBE_LEFT` in 2882 ms with evidence `e3`/`e4`, labeled LIVE/applied, with no page errors | Live game path is verified. Live Presage input and remote Convex transport remain separately gated; the reducer still revalidates every proposal |
| ElevenLabs | Server/main streaming endpoint, one configured authorized voice for all radio calls, exact caption text | Missing-key and expired-message paths tested | Authorized voice/model and real generated speech/playback need credentials |
| Convex 1.48.0 | Consenting sessions, hashed owner/judge capabilities, scoped reads/writes, sequence deduplication, provider intent claims/results, reactive trace and deletion | Capability ownership checks tested locally; schema/actions typechecked | No development deployment or live reactive/reconnect test yet |

Bundled WAV effects are authored kit assets, **not ElevenLabs outputs**. Browser manual mode does not run Presage. The simulated input is an explicit development fixture and never silently replaces failed live capture. A same-browser `BroadcastChannel` judge view is labeled local, not Convex.

Desktop smoke passed in a real Electron 45.0.0 window: all eight GLBs and nine WAVs loaded successfully through the restricted `nightrelay://app` protocol, no page errors were captured, the native status bridge reported unavailable credentials correctly, and a second window received the consenting local trace with no privileged bridge. Both windows reported `nodeIntegration=false`, `contextIsolation=true`, and `sandbox=true`. Evidence: `docs/qa/electron-smoke.json` and `docs/qa/electron-game.png`. This test did not acquire a camera. Twelve targeted integration tests pass, including sample gates, baseline/trend behavior, capability isolation, transport IDs across replays, safe observation projection, speech caching and overlapping sensor disposal/pause/resume.

Gemini now passes with the user-approved, configured `gemini-3.5-flash-lite` model. A real lookup and generation probe passed the full game validator with `WAIT`, provider latency 3887 ms, and a provider response ID. The actual Electron game then applied a real `PROBE_LEFT` proposal with evidence `e3`/`e4`, recorded 2882 ms provider latency, and displayed **LIVE · applied** in its judge panel with no page errors. Evidence: [live validator probe](qa/gemini-live-lite.json), [actual game result](qa/electron-live-providers.json), and [inspected screenshot](qa/electron-live-providers.png). The probe originally used an isolated process override; the user subsequently approved persisting that model choice. The game test used manual sensing, acquired no camera, and left trace sharing off, so it does not establish live Presage or remote Convex behavior.

Historical Gemini diagnosis: `gemini-3.8-flash` model lookup passed, but generation returned HTTP 503 or timed out, including 8010 ms under the eight-second local budget. An initial HTTP 400 server-deadline configuration error was corrected before those attempts. Those results motivated the approved model change and are not current blockers for 3.5 Flash-Lite. The local wait, core proposal expiry and fallback continue to share an eight-second budget without changing physical warning windows or blocking controls. Historical evidence remains in [the 3.8 timeout](qa/gemini-live-8s.json) and [earlier diagnosis](qa/gemini-diagnosis.json).

At the latest recorded check, ElevenLabs credentials/voice/model, a Presage key, and a Convex deployment URL were still unavailable. The user is continuing configuration; the statuses above describe recorded evidence rather than assuming that access is final.

## Run and configure

Provide values in ignored `.env.local` or process environment. Never use `VITE_` for provider keys:

```
PRESAGE_API_KEY
GEMINI_API_KEY
GEMINI_MODEL
ELEVENLABS_API_KEY
ELEVENLABS_VOICE_ID
ELEVENLABS_MODEL_ID
VITE_CONVEX_URL
```

`npm run native:smoke` imports the actual native library without acquiring a camera. `npm run integrations:check` checks only configured services: verifies the configured Gemini model and ElevenLabs voice/model, makes one bounded tactic request and one state-conditioned speech request, and tests a synthetic consenting Convex session that it deletes. It writes statuses and timings without keys, voice IDs, private challenges or raw pulse. It does not deploy services or create paid resources. ElevenLabs and Gemini calls may consume the configured account's normal request quota.

`npm run desktop` builds and opens the native game. Its initial launch may download the pinned Electron runtime. Select live camera mode deliberately in setup; use steady face lighting and a stable camera. The camera is stopped on pause, disposal and permission loss. Restart/resume discards stale samples and retains an already established baseline only for that session. If calibration is not ready after 60 seconds, manual play remains available. A live calibration needs at least 12 seconds of SDK warmup plus approximately 30 seconds of accepted samples.

For an existing development Convex deployment, set its URL and configure provider secrets on that server. The source uses typed generic Convex registration so offline TypeScript checking does not require generated deployment credentials. `npx convex dev --once` can provision these functions to an explicitly supplied development project; no deployment was created automatically. Enable trace sharing in setup to create a scoped session and get its judge link. Reset/delete removes the session, events and request records. Judge access expires after 24 hours; expiration prevents reads but is not automatic database deletion.

## Boundaries and known limits

- Native capture uses the vendor's installed renderer API and documented main SDK methods. The custom restricted camera message bridge mirrors the installed 3.4.0 protocol so the Presage key stays entirely in main. The documented host binding initializes its cache. Hardware/camera behavior remains unverified until live calibration succeeds.
- The generated SDK type defines metric timestamps as epoch microseconds; the installed renderer anchors camera timestamps to that epoch. The adapter maps sample age onto the app's monotonic clock, rejects samples older than five seconds, and requires capture validation OK, stable=true, a full warmup, supported 40–110 BPM range, and native confidence >=80/100. The threshold 80 is conservative game tuning, not a medical accuracy claim or a provider-specified accuracy conversion. SDK capture validation can miss unsuitable lighting or movement.
- A 30-second accepted baseline is frozen; elevation requires +8 BPM sustained for 12 seconds. Recovery requires below +4 sustained for 12 seconds, with at least 20 seconds between accepted state changes. Missing/stale data is UNKNOWN immediately. No raw pulse or camera frames enter trace/provider payloads. Trend can change the next legal tactic and recovery/help; it cannot directly cause a kill.
- Live sensing uses provider processing. SDK diagnostic telemetry is disabled. This does not claim the whole SDK measurement pipeline is local. Consult Presage's provider privacy terms before live capture.
- Convex intent claims are persisted atomically before calls and duplicate request IDs cannot produce a second action. Work is called directly from an action; it is not a durable scheduled-job queue. Offline fallback remains authoritative if a client disappears mid-call.
- Speech runtime requests use the same voice ID and filtering regardless of provenance. Successful responses populate an in-memory exact-caption cache keyed by authorized voice, model, output format and voice settings. The cache starts empty, holds at most 32 entries (2 MB encoded audio per entry, 16 MB total), and may disappear when a server worker restarts. Reused generated audio is labeled CACHED; new successful requests are LIVE. Expired instructions are rejected before cache lookup. Failure leaves exact captions and a short radio beep. No generated speech is bundled yet. The optional sound-generation endpoint was researched but is not implemented; the game uses the supplied WAV effects.
- Desktop development shell is implemented; signing, notarization and installers are outside this laptop build. Renderer Node integration is off, context isolation/sandbox are on, navigation/popups are blocked, IPC sender and frame bounds are checked, and camera permission is video-only.

## Official references inspected

- [Presage Node/Electron overview](https://smartspectra.presagetech.com/docs/nodejs/), [sample](https://github.com/Presage-Security/SmartSpectra/tree/main/nodejs/samples/electron-quickstart), [API](https://smartspectra.presagetech.com/docs/nodejs/api-reference), [metrics](https://smartspectra.presagetech.com/docs/nodejs/metrics).
- [Measurement quality](https://smartspectra.presagetech.com/docs/measurement-quality/), [model limitations](https://smartspectra.presagetech.com/docs/model-cards-and-limitations/), [telemetry](https://smartspectra.presagetech.com/docs/telemetry-and-privacy/). The linked detailed external pulse model-card page was unavailable in the web tool; no confidence-to-error conversion was invented.
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [ElevenLabs speech stream](https://elevenlabs.io/docs/api-reference/text-to-speech/stream), [sound generation](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert).
- [Configured Gemini 3.5 Flash-Lite model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [previously tested 3.8 Flash model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [3.8 thinking and migration settings](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.8).
- [Convex React](https://docs.convex.dev/quickstart/react), [actions](https://docs.convex.dev/functions/actions), [scheduling](https://docs.convex.dev/scheduling/scheduled-functions), [runtime crypto support](https://docs.convex.dev/functions/runtimes), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).
