# LOCK IN integration implementation contract

This is a build kit for a new game. **No LOCK IN provider integration has been tested live.** It contains design, assets, schemas, reference logic and implementation instructions; it is not a claim that the future game already connects to any service. Credentials are deliberately absent. Use the source ledger in [RESEARCH_SOURCES.md](RESEARCH_SOURCES.md) and record the versions actually installed during implementation.

## What is known before this build

The separate NIGHT RELAY project previously loaded SmartSpectra Node SDK 3.4.0 on macOS 14.2.1 / Apple Silicon / Node 22.23.3. That established native-library compatibility on that laptop, not camera measurement. It did not establish a live pulse estimate, calibration or in-game physiological response. Its Gemini 3.5 Flash-Lite structured request passed a full game validator in 3,887 ms; another request was accepted in its real Electron game in 2,882 ms. Those are prior-project observations, not LOCK IN latency promises or test results. ElevenLabs generation and Convex deployment were not verified there. Do not copy its credentials, environment file, gameplay, private data or success badges into this kit.

The prior Gemini 3.8 Flash attempt exceeded both 3.5-second and 8-second local budgets. An initial HTTP 400 was fixed by allowing the provider's required minimum 10-second server deadline while retaining a separate local deadline. This is useful integration history, not evidence that that model is generally unavailable. For LOCK IN, verify the explicitly configured account/model and record an actual new result.

## Implementation order and completion gates

| Stage | Work | Gate and independent fallback |
| --- | --- | --- |
| 0. Inspect and isolate native feasibility | Record OS, architecture, Node, package manager and Electron; inspect current official Presage sample and installed types; build a tiny native-import smoke outside the game | A native import or explicit unsupported-platform finding. No camera permission prompt at launch. A missing SDK/key does not block the browser game |
| 1. Complete the offline game | Seeded authority, four research stages, blackouts, Q quiet escape, F restoration, guaranteed lures, tutorial, local report fixtures and accessible audio cues | Play a real win and loss; render and inspect. Seeded fallback is the functioning director, with prepared captions and original bundled SFX |
| 2. Connect Gemini | Trusted-process adapter, model lookup, strict schema and current-state validation | One new real proposal affects a legal creature tactic in the rendered game; save sanitized evidence. Otherwise show FALLBACK and continue |
| 3. Connect ElevenLabs | Verify authorized voice/model, exact-caption speech, bounded queue/cache and expiry | One real state-conditioned line is generated, decoded and heard in the game with matching caption. Otherwise use prepared captions and SFX; never label bundled sound as ElevenLabs |
| 4. Connect actual sensing | Explicit opt-in camera, native quality gate, warmup, frozen baseline, sustained trend, bounded local effect | Real accepted samples, completed usable baseline, state transition, disconnect-to-neutral and stop/restart proof. Simulated fixtures do not pass this gate |
| 5. Connect Convex | Explicit trace consent, scoped owner/judge authorization, reactive queries, request records and deletion | Separate client sees updates; reconnect causes no duplicated action; unauthorized reads/writes fail; deletion succeeds. Local BroadcastChannel remains LOCAL, not Convex |

Stage 0 is early risk isolation; stage 4 is the end-to-end camera integration. Work on all credential-independent pieces while any gate is blocked. Never spend the entire build waiting for an account, and never mark a blocked gate passed because its adapter compiles.

## Process boundaries and secrets

Use a Vite/React/TypeScript/Three.js renderer and an Electron shell for supported native sensing. The browser remains fully playable with neutral physiology. The desktop main process owns provider credentials and native SDK initialization. A deployed Convex action may own Gemini/ElevenLabs secrets if deliberately configured, but camera frames and raw pulse must never enter Convex. Avoid a second local HTTP API when narrow IPC is enough.

Electron must use `nodeIntegration: false`, `contextIsolation: true`, sandboxing, restrictive navigation and CSP, and a preload allowlist. Validate sender, main frame, payload schema, size and request identity on every IPC. Give judge windows no privileged preload. Load production assets through a restricted secure app protocol or an equally bounded local server; absolute asset paths break under naive `file://` loading. No arbitrary file, shell, URL-fetch or generic IPC operation is exposed.

`.env.example` contains blank names only. `GEMINI_MODEL`, `ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL_ID` must be intentionally filled and checked; a model name is not an API credential. `VITE_CONVEX_URL` is a public deployment URL, not a secret. Every API key stays in main/server configuration; never prefix a key with `VITE_`. Keep `.env*`, exported local pulse reports and generated caches out of version control by default. Status diagnostics report presence, provider status, latency and safe request IDs, never key values or raw HTTP headers.

## Presage: real native path, not a fictional browser SDK

The current Node SDK uses a native FFI runtime with platform packages. Its documented supported targets include Apple Silicon macOS, Linux x64/ARM64 with glibc 2.35+, and Windows x64; Node >=20 and Electron >=28 are listed prerequisites. Recheck those against the actual laptop and pinned release. A successful browser `getUserMedia` call alone does not estimate pulse. [Official Node/Electron overview](https://smartspectra.presagetech.com/docs/nodejs/)

Start from the official [Electron quickstart](https://github.com/Presage-Security/SmartSpectra/tree/main/nodejs/samples/electron-quickstart) and [API reference](https://smartspectra.presagetech.com/docs/nodejs/api-reference). Use the installed version's main/preload/renderer modules, or a narrowly equivalent bridge verified against those installed sources. Keep the key in main even if a convenient sample passes configuration through the renderer. Do not invent browser methods or hand-wave an unsupported platform.

Request `MetricType.PULSE_RATE` explicitly. The documented default metric bundle is breathing, and `metrics.cardio.pulseRate` is empty unless cardiac metrics are requested. Decode the metrics event with the SDK decoder and take the latest measurement from that array. Provisioning a key is not proof that its account has cardiac access. [Metrics guide](https://smartspectra.presagetech.com/docs/nodejs/metrics)

The normalized sample contract is:

```ts
type SensorSample = {
  source: 'presage' | 'simulated' | 'manual';
  quality: 'accepted' | 'rejected' | 'unknown';
  qualityReasons: string[];
  receivedMonotonicMs: number;
  measuredMonotonicMs: number | null;
  pulseBpm: number | null;
  nativeConfidence: number | string | null;
  validationCode: number | string | null;
};
type PublicSensor = {
  source: SensorSample['source'];
  quality: SensorSample['quality'];
  trend: 'UNKNOWN' | 'STEADY' | 'ELEVATED' | 'RECOVERED';
};
// UI status is separate from quality:
type SensorStatus = 'LIVE' | 'SIMULATED' | 'UNAVAILABLE' | 'STALE' | 'CALIBRATING';
```

Retain the provider's real confidence semantics. For installed SDK 3.4.0, generated `MeasurementWithConfidence` types and official quality documentation describe a 0–100 confidence field and `stable` flag. The generated measurement timestamp is absolute Unix-epoch microseconds. Reinspect the pinned version rather than assuming the same units forever. Map epoch sample age onto the application's monotonic clock once; never compare epoch microseconds directly to `performance.now()`. Null, malformed, future or non-monotonic timestamps are not usable samples. [Payload reference](https://smartspectra.presagetech.com/docs/data-types/)

Implement these game acceptance rules, with tuning centralized in the supplied configuration:

- Require fresh SDK validation OK, `stable === true`, a numeric native confidence in its documented range, and the complete pulse warmup. Current documentation describes a 12-second pulse analysis window. Capture status must be recent too; do not reuse an old OK after capture stops.
- The kit's starting confidence threshold is 80/100 for that verified version. It is conservative **game tuning**, not a vendor accuracy guarantee or a conversion to probability. Unknown confidence semantics must remain unknown until verified; never manufacture 0.9 from an undocumented status.
- Accept only fresh supported-range samples. Starting bounds are 40–110 BPM, age <=5 seconds, and no more than 1 second in the future. Out-of-range estimates are unavailable to the game, not a diagnosis and not an extreme danger signal. [Model limitations](https://smartspectra.presagetech.com/docs/model-cards-and-limitations/)
- Use steady face lighting and a stable camera; target 30 fps. Dark scenes on a laptop monitor can degrade the player's illumination. Do not make the physical room darker as a sensing mechanic. Motion/lighting can still produce bad readings with high confidence. [Capture quality](https://smartspectra.presagetech.com/docs/measurement-quality/)

After warmup, collect 30 **usable seconds**, measured from accepted sample timing rather than callback count. Invalid gaps and pause do not advance calibration. Use a median baseline, freeze it for the run, and show manual continuation if calibration stalls. Do not slowly raise the baseline to erase a sustained increase. A user-requested recalibration belongs in a paused/setup state, not secretly during danger.

For accepted input, ELEVATED requires at least baseline +8 BPM sustained for 12 seconds; RECOVERED requires below baseline +4 sustained for 12 seconds, with a 20-second minimum accepted-state dwell. Invalid or stale input becomes UNKNOWN immediately and resets evidence accumulation; it must not be converted to STEADY. Reject interpolation across missing intervals. Simulated input uses the same tests only in a clearly labeled development mode and never silently replaces camera failure.

The game converts that trend into a fictional clue only when the creature is within 8 metres: a capped addition of 0.18 for sustained elevation, disabled during an earned quiet reward. Near-baseline/unknown input produces no added physiological clue; unknown does not cancel sound evidence or improve ordinary stealth. Physiology alone cannot satisfy breach eligibility, move the creature instantly, revoke a lure, shorten a warning, or block puzzle completion. The four-input memory sequence snapshots its tempo at playback start; elevation may modestly accelerate playback up to the design cap, while no usable input uses normal tempo. The player retains Q and a generous response window.

Stopping or losing permission must stop every camera track, stop/destroy the SDK as required by its API, release ports/timers, invalidate pending start promises and clear stale samples. Serialize stop/start and use a generation token so a delayed permission result cannot reactivate capture after disposal. Pause stops capture; resume requires warmup and fresh samples, retaining only the already frozen session baseline. Distinguish fictional CCTV from the real webcam in labels and code.

Set `enableTelemetry: false` where supported. The vendor's telemetry page concerns diagnostic telemetry; disabling it is not a claim that all measurement processing is local or that no provider communication occurs. Present accurate provider-processing disclosure before camera consent. The application stores no webcam images or recordings. [Telemetry and privacy](https://smartspectra.presagetech.com/docs/telemetry-and-privacy/)

## Local pulse report and consent

There are three independent choices: camera use for gameplay; retention of accepted pulse for a **local report**; and sharing sanitized game events with a judge. The latter two default off. The raw pulse recorder is an in-memory bounded buffer at at most one accepted value per second, indexed by monotonic and game time. Disabling report retention deletes its samples and derived baseline/peak/timeline statistics immediately. Clearing a report, restarting or leaving the run must clear local storage and buffers; an explicit local download is the user's export and must not upload automatically.

The live baseline may remain in memory for gameplay while that consent remains enabled; it must not be silently retained in a report after report consent is revoked. Camera disable makes gameplay physiology neutral. Do not collect raw pulse while paused or after the run. Never include baseline, peak, raw samples, event-linked increases or exported report content in Gemini prompts, ElevenLabs requests, analytics, logs, screenshots uploaded to a backend, or Convex records. Sharing a gameplay trace is not consent to share a pulse report.

Follow [PHYSIOLOGY_REPORT.md](PHYSIOLOGY_REPORT.md) and the supplied report reference for sufficient-data rules, event windows and overlap handling. Show measurement gaps, not connected invented values. “The largest recorded increase followed this event” is an association with limited temporal resolution, not fear detection or proof of causation. No report is a physiological interpretation, diagnosis, health assessment, confidence-to-emotion conversion or competition score. An unavailable report says UNRECORDED, with ordinary gameplay results intact.

## Gemini: bounded proposals with visible consequences

The application sends a deliberate projection, never a spread of the full state. [The director schema](../reference/director.schema.json) and [sensor schema](../reference/sensor.schema.json) govern structural validation; the supplied rule references add semantic checks. These names match that contract:

```ts
type Tactic = 'INVESTIGATE_SOUND' | 'CIRCLE_SHELTER' | 'LISTEN_NEAR'
  | 'FOLLOW_LURE' | 'WAIT' | 'TAUNT' | 'RETREAT';
type Target = 'SHELTER' | 'EMITTER_A' | 'EMITTER_B' | 'CONTAINMENT' | 'NONE';
type Proposal = {
  requestId: string;
  stateVersion: number;
  tactic: Tactic;
  target: Target;
  evidenceEventIds: string[]; // zero to three IDs from this request
  reasonCode: 'RECENT_SOUND' | 'PATTERN_OF_MISTAKES' | 'QUIET_AFTER_NOISE'
    | 'SUSTAINED_NEARBY_TREND' | 'EARNED_LURE' | 'RECOVERY'
    | 'VARY_PRESSURE' | 'NO_VALID_SIGNAL';
  tauntId: 'NONE' | 'AFTER_MISTAKE' | 'MACHINES_QUIET' | 'HEARD_RHYTHM' | 'LURE_FOLLOWED';
};
```

`DirectorRequest` contains only `requestId`, `stateVersion`, `issuedAtGameMs`, `expiresAtGameMs`, `allowedTactics`, `allowedTargets`, `allowedTauntIds`, `publicEventIds`, `events`, and `observations`. Observations contain `equipmentState`, `researchStage`, `creatureNode`, `sedationBand`, `machineryClue`, `transientClue`, `physiologyClue`, `sensor: PublicSensor`, and `earnedLure: {target, protectedUntilGameMs} | null`. Events are `{id, seq, gameMs, receivedMonotonicMs, type, data}` with a type-specific authored allowlist for `data`. If monotonic host clock values are not needed remotely, project them to an elapsed run-relative clock; keep a single documented mapping.

Never include webcam frames, BPM, baseline, peak, confidence history, free player text, memory puzzle sequence/inputs, answer state or future random decisions. Preserve actual permitted observations such as noise source, recent mistake IDs, quiet transition and lure destination; stripping every event payload produces a model with no meaningful behavioral context. Reject arbitrary additional properties at each boundary. Treat any string inside observations as data, never instructions.

Use an explicit configured model and verify it with the current model API. `gemini-3.5-flash-lite` is a documented stable text model supporting structured output; as a starting configuration use `ThinkingLevel.MINIMAL`, `maxOutputTokens: 1024`, `responseMimeType: 'application/json'`, and the supplied response JSON schema. Its current documentation deprecates sampling parameters such as temperature; omit them. The token cap includes reasoning, so avoid solving latency with a tiny output cap. Reverify model settings if a different model is selected. [Model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking), [migration settings](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6), [structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)

Set an independent 8,000 ms local request budget, a provider-acceptable server deadline (10,000 ms was required in the previous integration), no automatic retries, and at least 12 seconds between requests. Core expiry and fallback use the shared budget in game time. Do not await a provider in the render/update loop. A wall-clock request can complete while paused; queue its result only for the same run and revalidate against current authority on resume. Network cancellation is not a guarantee of canceling provider-side work or billing.

Reject malformed JSON, unknown/extra keys, wrong request, reused request, changed state version, expired result, unknown evidence, illegal tactic/target/taunt pairing and current safety violations. A model can choose behavior and contextual authored taunt IDs; it cannot supply executable code or new operative rules. The local code commits movement and sound. Guaranteed 16-second lure diversion, quiet escape, physical return travel, fresh warnings, blackout eligibility and restoration grace always prevail. A WAIT result must actually change the next tactic scheduling; a CIRCLE or LISTEN result must change the legal movement state, not just narration.

Assign a fresh transport run ID on every replay even for the same seed. Deduplicate before making a billable call. A late reply from the previous run is discarded. Record only safe request/response ID, model, source, allowed choices, evidence IDs, selected tactic, latency and rejection reason. Display LIVE only after a real provider response, and APPLIED only after the reducer accepts it. A valid response rejected as stale remains “live response, not applied.”

## ElevenLabs: exact captions, useful audio, honest provenance

Use one or more explicitly authorized stock/synthetic voices. A creature filter does not grant permission to clone a real person. Keep a record of voice access, required rights, account plan and generated-asset license before distributing outputs. Free availability does not imply commercial-use rights, and API/library voice access can depend on plan. [Voice use policy](https://elevenlabs.io/use-policy), [voice library](https://elevenlabs.io/docs/eleven-creative/voices/voice-library)

Trusted code calls the documented speech stream endpoint with `text`, configured `model_id`, stable voice settings and the chosen output format. `xi-api-key` stays server/main-side. Check the configured voice and model before generation. Do not send pulse, a face, an inferred emotional state or a full game state. The local caption is precisely the text sent for synthesis, not a later approximation. A chosen `tauntId` resolves through `design/dialogue.json`; `NONE` generates nothing. [Speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/stream)

The runtime speech request is `{runId, requestId, encounterId, lineId, caption, expiresAtMonotonicMs}`. Convert the remaining monotonic duration to a bounded server budget at the bridge; never compare different machines' monotonic epochs. Result is `{source: 'elevenlabs' | 'cached' | 'fallback', mimeType, audioBytes, latencyMs, providerRequestId?}`. Request ID uniqueness, length limits, rate limit, one pending generation per relevant encounter, a 7-second speech wait and a 2 MB audio limit are suitable starting bounds. Refuse empty audio and unsupported MIME types; enforce expiry again after decode and before play.

Priority order is breach/escape cue, task confirmation, emergency guidance, then taunt. Never let a long voice line mask the learned danger cue. Stop/duck obsolete lines, avoid queue buildup, and discard delayed taunts after quiet, lure, reset or death. Follow `design/dialogue.json`: at least 25 seconds between creature lines and at most seven per run; skip one while the player is listening for blackout movement. Keep captions and directional accessibility cues available when muted. Audio uses the real creature position and direction, including receding footsteps; physiological input must not independently fake proximity.

Cache only successful generated exact captions, keyed by voice/model/text/format/settings and labeled CACHED. Cap memory (for example 32 entries/16 MB total) and reject expired instructions before cache lookup. Authored tutorial/research instructions can be pre-generated and distributed only with verified rights; mark their source in the asset manifest. The supplied original WAV effects are not ElevenLabs output.

`tools/generate_voices.py` is an optional, dry-run-first utility for `design/dialogue.json`. Its explicit live mode requires account environment values and a voice-rights acknowledgment, generates a bounded selected batch with no retries, and writes separate `assets/generated-voice/` provenance. No invocation is required to use this offline kit. Review output and loudness before adding it to a game build.

From the kit directory, `python3 tools/generate_voices.py` reviews the first bounded batch without reading credentials or writing output. Select a line with `--line INTRO_ALERT`. After supplying the three `ELEVENLABS_*` environment values through the trusted local runner, explicitly add `--live --acknowledge-voice-rights` to generate. The utility does not load `.env` automatically. Each HTTP operation has a hard child-process deadline; a timed-out request is not retried because it may already have consumed quota. Orphaned/corrupt output is left for inspection rather than overwritten and billed again.

Sound effects are optional enhancement after the core voice gate. The documented sound-generation endpoint accepts text, duration and related parameters; current docs specify 0.5–30 seconds. If used, generate ambience/impacts as build assets, inspect them, record their provenance/license and mix them to the same distance/warning rules. Do not generate runtime breach cues whose timing becomes unpredictable. [Sound effects API](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)

## Convex: a useful reactive judge trace with explicit boundaries

The local deterministic simulation remains the single gameplay authority. Convex supplies a consenting remote trace, session lifecycle and provider request records. Removing it leaves the game playable; adding it should produce a working second-screen observer and reconnect-safe evidence, not merely a logo. React `useQuery` subscriptions react to database updates. [React client](https://docs.convex.dev/client/react/overview)

For the short-lived judging demo, create independent random owner and judge capabilities (at least 256 bits), hash them server-side, and scope every query, mutation and action to its session. Never use a bare session ID as permission. Put only the judge capability in a fragment-based judge link, keep it out of logs/analytics, and do not expose an owner capability to the judge. A holder can share that link, so label it as access and offer revocation. Expire access within 24 hours; explicit deletion must remove stored data, not merely hide it. For a public product, implement authenticated identities and ownership through a supported auth provider; a shared demonstration token is not a full user account system. Convex endpoints are public and authorization belongs in each public function. [Authentication and authorization](https://docs.convex.dev/auth/overview)

Recommended records:

- `sessions`: owner/judge hashes, explicit consent, creation/expiry, seed, mode, coarse phase, result and summary. No pulse summary.
- `events`: session ID, sequence, safe event type, game time, finite authored data. Unique session+sequence semantics; cap rows per run.
- `providerRequests`: session/run/request IDs, intent kind, requested time, status, model, latency, safe provider ID, rejection code. No API credentials, raw prompts or voice bytes in trace rows.

Owner-only writes create the session, append bounded event batches, claim provider intent atomically, update outcome, revoke and delete. Judge reads cannot invoke providers or alter state. At most one claim wins for a request; retries/reconnect must not create another model call. If using scheduled actions, persist the intent first and document retry behavior. Do not describe an ordinary action as a durable workflow. External API work runs in actions; mutation code retains transactional ownership checks. [Actions](https://docs.convex.dev/functions/actions), [scheduling](https://docs.convex.dev/scheduling)

Send only source/quality/coarse trend, safe game events, legal decisions and coarse creature state. No raw pulse, baseline/peak, pulse report, webcam, mic audio, identity inference or memory answers. Apply the same projection on both client and server; reject undeclared fields rather than trusting a polite client. Offline trace buffering is bounded and contains only sanitized events. Failed network requests never hold up the game. A local-only trace is labeled LOCAL; an actual connected subscription is labeled CONVEX LIVE only after verified data arrives.

## Evidence required before handing over the built game

Create a per-provider status file with `not_configured`, `blocked`, `failed`, `passed_adapter` or `passed_in_game`, plus timestamp, platform/version, evidence path and exact scope. Do not treat a prior project's evidence as this run's result. Save fixture tests separately from live checks. Required checks include secret projection, timestamp conversion, missing/stale quality, frozen baseline, sustained trend and dwell, sample/report deletion, request validation, pause/reset races, sound expiry/cache, owner/judge isolation, reconnect deduplication and visible labels.

For actual live evidence, demonstrate a legal Gemini-selected tactic, real audible ElevenLabs output with matching caption, real Presage warmup/baseline plus disconnect behavior, and a separate Convex client receiving sanitized updates. If credentials or platform access remain unavailable, name exactly what was implemented and what failed or was not tested. The playable offline win/loss and rendered inspection still must be completed.
