# LOCK IN integration verification

The root application is now LOCK IN. Its offline reducer owns every action, alarm, committed attack, earned lure and early quiet response. No model can change those rules or read private memory answers. A successful adapter test is distinct from a successful provider request and from a live in-game result.

The original replacement checks are recorded in [integration-checks.json](integration-checks.json). The subsequent harder industrial version has fresh live monster-voice evidence below; earlier Gemini/Presage/Convex findings remain dated evidence rather than new successful tests. NIGHT RELAY evidence retained elsewhere under `docs/qa` is historical implementation research; it is **not** a live LOCK IN result. All required configuration names are present according to the operator's latest presence-only check. Values remain in ignored local environment files; presence does not establish access, permissions or deployment compatibility.

| Integration | Current LOCK IN evidence | Remaining verification |
| --- | --- | --- |
| Presage SmartSpectra 3.4.0 | Native import passed on macOS 14.2.1 / Apple Silicon / Node 22.23.3. Actual authorized camera selection was attempted and stopped through UI. | **Blocked: CAMERA_NOT_FOUND.** macOS enumerated zero camera devices. No accepted sample/baseline was obtained; cardiac key access remains unverified until a camera is available. |
| Gemini / Google GenAI 2.31.0 | **LIVE passed with temporary `gemini-3.5-flash-lite`:** full-validator probe 711ms (`INVESTIGATE_SOUND`→`SHELTER`, evidence e2/e3); actual Electron applied `WAIT`→`NONE` in 928ms with evidence e8, after visible Q/F controls. No page errors. | The user's `.env` remains `gemini-3.8-flash`. Its model lookup succeeded but its LOCK IN proposal timed out at 8006ms; actual game retained local fallback. Use the tested process override below to reproduce live 3.5 behavior. |
| ElevenLabs | **LIVE passed in the harder game through `npm run dev`:** FIRST_APPROACH caption “I can hear you working.” generated in185ms; actual Chrome encounter showed BEYOND THE WALL, a running AudioContext, two speech decodes/starts (opening instruction plus monster), zero playback errors and active proximity alarm. A separate exact-caption API probe passed in436ms /22,195bytes. | No service blocker recorded. Physical speaker audibility was not independently measured; browser playback execution is verified. |
| Convex 1.48.0 | Supplied deployment reached. Read-only compatibility query returned a missing-public-function error. Local same-browser judge trace passed in secure Electron windows. | **Blocked: FUNCTIONS_NOT_PROVISIONED.** `sessions:version` is absent. No session was created and no CLI/environment/deployment command was run. Human provisioning of the new LOCK IN functions is required before remote reactive/ownership/deletion checks. |

Live checks ran on 2026-10-23 PDT; evidence stores UTC timestamps on October 24. See [configured-model evidence](integration-checks.json), [alternative structured probe](qa/lock-in-gemini-alternate.json), [actual game and audio proof](qa/lock-in-electron-live-providers-alternate.json), [inspected actual-game screenshot](qa/lock-in-electron-live-providers-alternate.png), [camera blocker](qa/lock-in-presage-live.json), and [offline desktop security/assets/judge proof](qa/lock-in-electron-smoke.json).

The new live voice proof is [actual browser gameplay](qa/local-api-monster-browser.json) and [its inspected screenshot](qa/local-api-monster-browser.png), plus [local API request evidence](qa/local-api-monster-voice.json). No camera or trace sharing was enabled for this voice test. Physical speaker loudness/voice quality was not independently assessed.

The tested live model can be used without editing any local configuration:

```sh
GEMINI_MODEL=gemini-3.5-flash-lite npm run desktop
# Or local browser gameplay, including the new provider middleware:
GEMINI_MODEL=gemini-3.5-flash-lite npm run dev
```

This is a process-only override. The game does not silently replace a missing or slow configured model, and no environment file was changed during these checks.

Targeted integration tests cover malformed/stale/future/missing timestamps, non-finite native confidence, SDK warmup, frozen baseline, duplicate measurement timestamps, sustained trend and recovery, capture segments/lifecycle races, hidden-data projection, strict actual-state proposal validation, replay transport identities, missing-key fallbacks, intercepted Gemini SDK schema/settings, speech caching/expiry/eviction, and capability separation.

Bundled 27 WAV effects and ten GLBs are authored LOCK IN kit assets. They are not outputs of a live provider. Simulated sensing remains visibly SIMULATED. Browser/manual play uses neutral physiology. A same-browser judge channel is labeled LOCAL BROADCAST, independently of whether remote Convex functions are available.

## Ordered checks and local configuration

The required sequence is native isolation → complete playable offline game → Gemini → ElevenLabs → real sensing → Convex. Run only the relevant stage, after its prerequisites:

```sh
npm run native:smoke
npm run integrations:check -- --only=native
npm run test:desktop
npm run integrations:check -- --only=gemini --live
npm run integrations:check -- --only=elevenlabs --live
node electron/smokeLiveProviders.mjs --live
# Deliberate live webcam selection and calibration in Electron
npm run integrations:check -- --only=convex --live
```

`integrations:check` defaults to native import only. Provider stages require explicit `--live`; there are no automatic retries. Gemini performs bounded model lookup and one structured request. ElevenLabs verifies the configured voice/model and requests one exact authored caption. These two live stages can consume normal account quota. Convex checks only the supplied deployment, creates one scoped consenting test session if the version matches, and attempts deletion in `finally`. It never runs development, environment or deployment CLI commands. Human provisioning is required if the existing server lacks the new functions.

`test:desktop` uses the child-process-only `LOCK_IN_OFFLINE=1` gate: all provider/camera credentials are disabled inside that launched process, remote trace is skipped, and local judge sharing remains available. It never edits `.env`. Normal desktop launch keeps user configuration. Actual configured-model game evidence is written to `docs/qa/lock-in-electron-live-providers.json`; `--alternate` writes a separate `-alternate` result. The successful 3.5 run used only a process override. Actual offline desktop evidence uses `lock-in-electron-smoke.json`. Evidence claims are based on completed results, not driver existence.

Configuration names: `PRESAGE_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`, `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`. Provider keys never use a `VITE_` prefix and never enter the renderer. Only the public Convex URL may be bundled. Static-hosted browser provider actions require secrets provisioned on the existing Convex server; local environment presence does not configure that server. Local `npm run dev` instead uses a Node-side loopback middleware bridge with same-origin/host checks, a custom application header, bounded JSON bodies, rate limits, request deduplication and an exact authored-caption allowlist. Restart Vite after this change or environment changes. `LOCK_IN_OFFLINE=1` disables that process’s provider credentials without editing environment files.

## Native sensing and local pulse report

The renderer uses installed `SmartSpectraSDK.useMediaStream`, `PULSE_RATE` and the actual protobuf decoder. The restricted camera bridge sends frames to the SDK in main and keeps the Presage key there. Camera & pulse setup provides device selection, mirrored local preview, warmup/calibration progress, recalibrate and stop controls. The preview is the exact controller-owned stream, not a second capture. Mocked lifecycle tests verify selected-device constraints, no browser-only capture, teardown on SDK startup failure and pending-capture disposal; they are not live pulse evidence. The camera inventory again reported zero devices during the harder-version work.

Capture is opt-in from setup or the in-game camera dialog, requests video only, disables SDK diagnostic telemetry, and stops on ordinary pause, hiding the app, exit, disposal or permission loss. Deliberately enabling camera calibration in its dialog holds game time paused while allowing calibration; closing the dialog resumes play and preserves its baseline. Live measurements use provider processing; this does not imply the entire measurement pipeline is offline.

The generated SDK defines measurement timestamps in epoch microseconds. The adapter maps their age onto the local monotonic clock, rejects missing, non-finite, future or more-than-five-second-old measurements, and requires capture validation OK, stable capture, 12 seconds of warmup, pulse within the supported 40–110 range and native confidence at least 80/100. That last threshold is conservative game tuning, not a provider accuracy conversion or physiological interpretation. No confidence value is invented. Repeated callback delivery of the same measurement cannot advance baseline duration.

A baseline requires 30 seconds of usable measurement time and then stays frozen for the run. Elevation is at least +8 BPM sustained for 12 seconds; recovery is below +4 sustained for 12 seconds, with 20 seconds between accepted transitions. Missing/rejected/stale data becomes UNKNOWN. Only a nearby creature, within eight metres, can use accepted elevated trend as a capped 0.18 fictional clue; it never alone qualifies for breach and cannot bypass early-isolation protection or cancel an already committed attack.

`SensorView.sampleAtMs` is the actual mapped measurement time, not the callback clock. `captureSegment` changes on each capture start/resume; pause discards continuity. Optional local report recording independently requires consent and deduplicates measurement timestamps. Its pulse samples, baseline and report never enter Gemini, ElevenLabs, Convex or the judge trace. Deletion clears that in-memory history. See the report UI and root report documentation for exact aggregation and disclosure; no emotional or medical interpretation is attached to the graph.

## Provider and trace boundaries

Gemini receives only finite public observations, authored event types/details and the current allowed tactic/target/taunt sets. It returns exactly `requestId`, `stateVersion`, `tactic`, `target`, `evidenceEventIds`, `reasonCode`, `tauntId`. Core checks the entire shape, current state, allowed pair, supported evidence/reason, taunt eligibility, expiry and duplicate status before committing. The shared eight-second budget never pauses gameplay. A failed or late call leaves the deterministic local director authoritative. Configured 3.8 Flash uses documented LOW thinking with 1024 output tokens and no deprecated sampling override; supported 3.5 Flash-Lite uses MINIMAL only if explicitly configured.

Speech uses exact authored dialogue and the configured authorized voice. No arbitrary operative text or identity impersonation is generated. A successful real response populates a bounded in-memory cache keyed by voice/model/caption/format/settings, never API keys. It starts empty; new responses are LIVE and reused responses are CACHED. It stores at most 32 entries, 2 MB encoded audio per entry and 16 MB total; worker restart may discard it. Expired captions are rejected before lookup and while streaming. Game state, pause, stage and equipment are rechecked before playback. Creature dialogue follows the exterior creature position and remains eligible when equipment is isolated; radio instructions stop when unpowered. The first proximity alarm requests the authored FIRST_APPROACH line independently of Gemini. Later contextual taunts share bounded event and speech cooldowns. Missing or failed speech leaves captions and original effects available.

Trace sharing has separate consent. Shared summaries contain stage, equipment, creature location/motion, current tactic/target, provider source and coarse sensing source/quality/trend/age. There is no raw pulse, private puzzle sequence, camera frame, local report or baseline BPM. Owner/judge capabilities are separate random values whose hashes are stored server-side; query links grant judge reads only. Event sequences are deduplicated, provider intent claims are atomic, and duplicate request IDs do not start a second provider call. Actions are not a durable scheduled-job queue. Stopping trace immediately closes local publication even if remote deletion is unavailable; failed remote deletion is reported and can be retried. Access expiry is 24 hours and is not automatic database deletion. Expired owner capabilities remain valid only for the explicit deletion mutation; expired reads, event writes, provider claims and all judge access stay blocked. A dedicated authorization regression verifies owner erasure, wrong-capability rejection and retained expiry restrictions.

The Electron shell uses `lockin://app`, restricted navigation, content policy, sandboxing, context isolation and no renderer Node integration. The judge window has no privileged preload. IPC accepts only the main application's top-level frame. Signing, notarization and an installer are outside this laptop build.

## Official documentation inspected

Sources were reviewed for the LOCK IN kit on 2026-10-23 PDT. No prize eligibility, current event award or future provider availability is inferred from them.

- [Presage Node/Electron overview](https://smartspectra.presagetech.com/docs/nodejs/), [installed API architecture sample](https://github.com/Presage-Security/SmartSpectra/tree/main/nodejs/samples/electron-quickstart), [API reference](https://smartspectra.presagetech.com/docs/nodejs/api-reference), [metrics](https://smartspectra.presagetech.com/docs/nodejs/metrics).
- [Measurement quality](https://smartspectra.presagetech.com/docs/measurement-quality/), [model limitations](https://smartspectra.presagetech.com/docs/model-cards-and-limitations/), [telemetry/privacy](https://smartspectra.presagetech.com/docs/telemetry-and-privacy/). No unsupported confidence-to-error conversion was invented.
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [3.8 thinking settings](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.8), [3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite).
- [ElevenLabs speech stream](https://elevenlabs.io/docs/api-reference/text-to-speech/stream), [sound generation](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert). Optional generated SFX are not implemented; authored WAVs are used.
- [Convex React subscriptions](https://docs.convex.dev/quickstart/react), [actions](https://docs.convex.dev/functions/actions), [scheduling](https://docs.convex.dev/scheduling/scheduled-functions), [runtime cryptography](https://docs.convex.dev/functions/runtimes), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).
