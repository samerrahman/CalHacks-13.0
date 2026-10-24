# NIGHT RELAY

**It learned your supervisor's voice. Check the evidence. Finish the shift.**

A playable single-player 3D horror game built from the supplied Night Relay kit. Operate a remote relay booth, finish three maintenance jobs, and verify radio instructions while one creature approaches through the service tunnels. The complete offline game needs no API keys. Choose a five-minute shift or a reproducible two-minute demonstration; completing the jobs wins immediately.

The game uses TypeScript, React, Vite, Three.js and one deterministic local simulation. Electron supplies the native camera/provider bridge. Gemini, ElevenLabs, Presage and Convex have implemented adapters with explicit fallback states; their actual verification status is below.

## Team

Four of us build in parallel. Ownership, branches, open gates and the schedule are in [docs/TEAM.md](docs/TEAM.md), and the rules for coding agents are in [CLAUDE.md](CLAUDE.md).

## Start playing

From this directory, with Node.js 22 installed:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**, choose **02 MIN / Demo shift**, and take the night shift. Manual sensing is the default and uses no camera. The development server binds only to loopback. Dependencies require an initial install; gameplay and bundled assets work without external services afterward.

To run the production browser build locally:

```sh
npm run build
npm run preview
```

To build and launch the Electron game on the supported laptop:

```sh
npm run desktop
```

This builds both the web app and Electron entry points, then opens the native development shell. It also clears `ELECTRON_RUN_AS_NODE` for the launch. A signed installer is not included.

See [the two-minute demonstration guide](docs/DEMO.md) for a complete seed-17 playthrough, verification example, and judge sequence.

## How the shift works

1. **Synchronize the carrier.** Match the three printed dial targets and accumulate 20 seconds of link. At least one shutter must be open.
2. **Replace the cartridge.** Inspect the trusted left-hatch order, sweep left, open it, collect for three seconds, then insert the cartridge at the relay cabinet.
3. **Transmit the uplink.** Align both right-station bars, sweep right, open it and accumulate 12 seconds of upload. Progress saves at four-second checkpoints.

Sealing both shutters blocks task progress and drains 0.75 energy per second. One sealed shutter drains 0.20; both open recharge 0.35. A floodlight sweep costs 8 energy, has a shared 12-second cooldown, and guarantees 12 clear seconds on the selected side. A physical approach has at least eight seconds of travel followed by a six-second threshold warning. One physical encounter is active at a time. Zero power starts an eight-second recovery countdown; opening both shutters permits recovery.

Mara gives correct instructions. The imitation shares her radio channel, caption label and configured voice, but every fake has an authored discrepancy: a closed order, wrong hatch, or failed current challenge. Inspect the work order or request authentication, then reject the call when evidence is available. The private challenge changes with every call. A dialogue click cannot kill the player. The trusted task controls remain the source of operational truth.

## Controls and accessibility

| Control | Action |
| --- | --- |
| `1` / `2` / `3` / `4` | Console / left hatch / right uplink / relay cabinet |
| `A` / `D`, or left/right arrows | Switch station |
| Drag the scene | Look around the current station |
| `Q` | Inspect work orders and the private challenge card |
| `R` | Request the current call's authentication response |
| Hold `E` | Perform the current station's timed interaction; release to stop |
| `Space` at a side station | Sweep that corridor |
| `Escape` | Pause/resume |
| `J` | Toggle the development/judge trace |
| `Tab`, `Shift+Tab`, `Enter` | Navigate and activate HTML controls |

All operations also have visible buttons. Dial and alignment controls print their target values. Timed task buttons can start/cancel an interaction without holding a mouse button. Captions, warning text, authentication evidence and safe-window timers work without sound or color discrimination. Setup includes reduced motion; pause includes master volume, and the top bar includes mute. Pausing stops the simulation clock and energy consumption, suspends sound and stops capture.

## Integration status

**Gemini is live-tested in the actual Electron game.** The user-approved `gemini-3.5-flash-lite` model is configured. A real proposal selected `PROBE_LEFT`, passed the local reducer's validation, and appeared as **GEMINI / LIVE · applied** with evidence IDs `e3` and `e4`; recorded provider latency was 2882 ms. A separate live validator probe accepted `WAIT` in 3887 ms. See [the game evidence](docs/qa/electron-live-providers.json), [the live probe](docs/qa/gemini-live-lite.json), [the integration status](docs/INTEGRATION_STATUS.md), and [the aggregate service checks](docs/integration-checks.json). The user is still entering other service credentials; their latest recorded gates remain below.

| Service | Implemented behavior | Current verification and runtime fallback |
| --- | --- | --- |
| **Gemini** | Structured tactical proposal from allowed actions and sanitized public history; identity, expiry, state, provenance, budget and safety revalidation | **LIVE tested and applied:** approved `gemini-3.5-flash-lite`; standalone `WAIT` accepted in 3887 ms and actual Electron `PROBE_LEFT` applied in 2882 ms with public evidence `e3`/`e4`. No page errors were recorded. Seeded fallback remains available on failure. |
| **ElevenLabs** | State-conditioned caption text sent through the streaming endpoint; one authorized configured voice and radio filter for genuine/fake calls; expiring priority playback and exact-caption cache | **Blocked at latest check:** key/voice/model absent. Exact captions plus authored radio effects/beep. No generated or cached voice audio is bundled. |
| **Presage** | SmartSpectra renderer media stream, restricted Electron bridge, explicit cardiac metric, payload timestamps, quality gate, baseline and sustained trend | **Native import verified only:** SDK 3.4.0 loads on this Mac. The key was absent at the latest check; camera capture, valid pulse, calibration and in-game live response remain untested. Browser play is manual or explicitly **SIMULATED**. |
| **Convex** | Scoped consenting sessions, owner/judge capabilities, ordered event deduplication, provider actions, reactive trace and session deletion | **Blocked at latest check:** no deployment URL. Optional same-browser judge view uses a clearly labeled local **BroadcastChannel**; this is not a live Convex result. |

Detailed contracts, remaining gates, official references and privacy boundaries are in [docs/INTEGRATION_STATUS.md](docs/INTEGRATION_STATUS.md). No remote deployment, public site or paid cloud resource was created. Optional sponsor integrations and prize eligibility are not claimed.

## Configure available services

For first-time setup, create an ignored local file from the names-only example without overwriting an existing configuration, then supply credentials privately:

```sh
test -f .env.local || cp .env.example .env.local
```

| Variable | Purpose |
| --- | --- |
| `PRESAGE_API_KEY` | Provisioned SmartSpectra cardiac key for Electron capture |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Google credential and an available structured-output model |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` | Credential and an authorized voice/model; the same voice serves both radio roles |
| `VITE_CONVEX_URL` | Existing development deployment URL; this public URL is not a secret |
| `CONVEX_DEPLOYMENT` | Existing development project selection for the Convex CLI |

Provider keys belong in Electron's trusted main-process environment or the configured Convex server environment. Never prefix provider secrets with `VITE_`. A plain browser tab has no direct access to local provider secrets: its live provider path uses a configured, consenting Convex session. Electron can call the configured providers through restricted IPC without a Convex deployment.

Check available access without deploying anything:

```sh
npm run native:smoke
npm run integrations:check
```

The native smoke check imports the installed binding and does not acquire the camera. The integration check uses only configured services; when credentials are present it verifies model/voice availability, makes bounded live director/speech requests, and creates/deletes a synthetic consenting session on the supplied Convex development service. Normal provider request quotas can apply. Results are written with secrets and private challenge data omitted.

## Camera and trace privacy

Live camera mode is an explicit setup choice in Electron. Capture requests video only, not microphone audio. The metrics callback records receive-time using the app's monotonic clock, decodes the typed SDK payload, and rejects stale, unstable, out-of-range or invalid-quality measurements. It requires SDK warmup followed by about 30 usable seconds of baseline data; the operator can continue manually if setup is not ready after 60 seconds. Stopping, pausing, permission loss and unmount stop capture and discard stale samples.

The baseline stays fixed for its session. Accepted elevation is a sustained personal-baseline trend, not an instant fear/emotion measurement or diagnosis. It may affect the next legal tactic and recovery/help; it cannot directly kill the player or require the player to lower their pulse. Missing data produces **UNKNOWN**, never an invented live measurement. Simulated sensing is a separate, visibly labeled development mode.

Only consenting sanitized events and coarse sensor status/trend can reach the trace. The app does not upload raw video or pulse values to its backend or include private challenges in director payloads. Presage uses its own provider processing; disabling SDK diagnostic telemetry does not establish that its whole measurement pipeline is local. Consult the provider's privacy terms before live capture. Judge capabilities expire after 24 hours; the **Delete session** control removes persisted demo data, while token expiry alone does not delete it.

## Project map

| Path | Responsibility |
| --- | --- |
| `src/game/` | Local reducer, tasks, creature graph, order verification, proposal validation |
| `src/render/` | GLB loading, scene, lights, supplied animation clips, mouse look and teardown |
| `src/audio/` | Positional effects, master/mute, shared radio processing and expiring speech queue |
| `src/sensing/` | SDK payload adapter, capture lifecycle, frozen baseline, quality/freshness and sustained trend |
| `src/integrations/` | Public contracts, provider clients, server/main adapters, local/Convex trace |
| `src/ui/` | Setup, controls, captions, pause/results and sanitized second-screen view |
| `electron/` | Secure native shell, preload, Presage bridge, build and verification tools |
| `convex/` | Schema, capabilities, sessions/events, idempotent provider requests and actions |
| `tests/` | Deterministic gameplay and integration boundary checks |
| `public/assets/` | Eight GLBs, nine WAVs, five SVGs, original license and asset manifests |
| `night-relay-kit/` | Supplied specification, dialogue, reference tests and reproducible asset sources |

The 3D frame loop performs no provider calls. React overlays update separately from the local fixed simulation step. Asynchronous proposals cannot change geometry, private challenges, warning durations or rules; the reducer decides whether a result is still legal before committing it.

## Validation and tested platform

Implementation and native-import target: **macOS 14.2.1, Apple Silicon arm64, Node 22.23.3**. Package versions and transitive dependencies are pinned in `package.json` and `package-lock.json`. The tested TypeScript compiler is **5.9.3**; it replaced the TypeScript 7 native launcher, which terminated without diagnostics on this laptop. Core versions include Three.js 0.186.1, React 19.3.1, Vite 8.3.5, Electron 45.0.0, SmartSpectra 3.4.0, Google GenAI 2.31.0 and Convex 1.48.0.

```sh
npm run typecheck
npm test
npm run test:reference
npm run assets:validate
npm run build
npm run electron:build
```

The behavior suite covers camping failure/power drain, valid wins across seeds, authored fake tells, private-data projection, safe-window guarantees, encounter warning limits, stale/duplicate/illegal proposals, sensor quality/freshness and baseline boundaries, speech cancellation, and actual GLB animation transforms. The renderer tests parse all eight real GLBs and verify idle/listen/reach plus shutter motion. Asset files were checked byte for byte against the kit; [the shipped manifest](public/assets/manifest.json) contains exact SHA-256 checksums and license paths.

**42 application tests and 8 supplied reference tests passed.** Asset validation, typecheck, production build and Electron build passed. The application suite includes eight renderer/audio tests and deterministic winning sequences across six seeds in both presets. The full rendered-control playthrough and deliberate-loss/restart checks were rerun successfully after the Gemini wait, proposal expiry and fallback were aligned to the same eight-second budget; physical warning windows and responsive controls remain unchanged.

| Verified behavior | Recorded evidence |
| --- | --- |
| 42 application tests, zero failures | [Test output](artifacts/test-results.txt) |
| Chrome seed-17 demo win; one fake rejected; pause, camping block, upload checkpoints and local judge trace | [Rendered playthrough](artifacts/playthrough.json), [win screen](artifacts/win.png) |
| Chrome seed-18 full-shift win; explicitly simulated calibration/elevation; browser live-sensor unavailability; mobile layout check | [Second playthrough](artifacts/second-playthrough.json), [seed-18 win](artifacts/win-seed18.png) |
| Full threshold warning before loss, then clean restart | [Loss/restart result](artifacts/loss-test.json), [loss screen](artifacts/loss.png) |
| Real Electron game and unprivileged local judge window; eight GLBs/nine WAVs loaded; sandbox/context isolation on, renderer Node off | [Electron smoke](docs/qa/electron-smoke.json), [Electron screenshot](docs/qa/electron-game.png) |
| Real Gemini proposal validated and applied by the Electron game; no page errors | [Live game trace](docs/qa/electron-live-providers.json), [inspected live screenshot](docs/qa/electron-live-providers.png), [separate validator probe](docs/qa/gemini-live-lite.json) |
| Inspected final booth, open corridor and laptop layout | [Game](artifacts/game-final.png), [open corridor](artifacts/left-open-final.png), [laptop](artifacts/final-laptop.png) |

The recorded rendered playthrough and loss checks contain no console errors; the main playthrough reports no missing resources. Live Gemini was verified separately in the actual game. Live sensor measurements, generated speech, novice human usability and a sustained frame-rate benchmark remain unverified.

## Known limitations

- Native library import is verified; live camera capture and measurement quality on the judging laptop are not yet established.
- Gemini's live Electron path passes with the approved 3.5 Flash-Lite model. Earlier 3.8 Flash attempts returned HTTP 503 or timed out; those historical results explain the approved model change and are not the current Gemini gate. ElevenLabs, Presage capture and remote Convex still lacked the required credentials/access at the latest recorded check.
- Offline speech is caption plus effects. The sound-generation API is not implemented. An in-memory exact-caption voice cache is implemented but starts empty; no generated voice audio is bundled or live-tested yet.
- The two-minute demonstration uses an authored teaching fake and fixed seed. It illustrates verification and fair timing, not proof that every event was generated by AI.
- Convex provider work uses atomic persisted intents and direct actions, not a durable scheduled-job queue. The local simulation remains authoritative if a client disconnects.
- This is a seated, station-based game for a desktop/laptop. There is no free walking, combat, multiplayer, complex physics, signed installer, or cross-platform hardware validation.
- Automated rendered playthroughs and layout inspection passed; novice human playtesting, sustained frame-rate benchmarking and final subjective difficulty tuning remain unperformed.

Original asset permissions and detailed runtime use are documented in [docs/ASSETS.md](docs/ASSETS.md). Retain [the kit license notice](public/assets/LICENSE.txt) when redistributing its source or assets.
