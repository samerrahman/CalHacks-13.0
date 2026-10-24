# NIGHT RELAY handoff

The repository contains a working offline 3D game, not a scaffold. `npm run dev` opens the browser version at `http://127.0.0.1:5173`; `npm run desktop` builds and starts Electron. Dependencies are installed and pinned. No remote deployment or paid resource was created.

## Delivered

Three playable maintenance operations; five-minute and two-minute presets; one deterministic creature; fair approach/warning/recovery timing; power and sweep tradeoffs; rotating private challenge authentication and evidence-based fake rejection; pause, loss, win and restart. All eight supplied GLBs, nine sounds, five decals, safe authored Mara lines, and runtime order/card text are used. Keyboard controls, captions, reduced motion, master volume and mute are available.

The renderer is independent from React updates and provider calls. One local fixed timestep owns gameplay. Gemini proposals are validated before use; exact-caption ElevenLabs playback is cancelable and cached only after successful generation. Presage has a native bridge, typed sample gate, frozen baseline and sustained trends. Convex has scoped sessions, deduplicated events, provider actions and deletion; local consenting judge sharing works without it.

## Verified

- 42 application tests and 8 reference tests passed; asset validation, typecheck, production build and Electron build passed.
- The game test suite wins across six seeds in both presets.
- Real Chrome controls completed seed 17 demo and seed 18 full-shift runs, both with one fake rejected. Pause, checkpoint retention, local judge subscription, simulated calibration/elevation and laptop layouts passed. Final playthroughs had no console errors or missing resources.
- A deliberate creature loss occurred after its warning, followed by a successful restart reset. The full rendered-control playthrough and loss/restart checks passed again after the Gemini local wait, proposal expiry and fallback were aligned to a shared eight-second budget; physical warning times were unchanged.
- The actual Electron window loaded all models and sounds, exposed the narrow operator bridge, and shared a local trace with an unprivileged judge window. Both windows use context isolation and sandboxing with Node integration disabled.
- Presage SmartSpectra 3.4.0 native import passed on macOS 14.2.1 / Apple Silicon / Node 22.23.3.
- Live Gemini 3.5 Flash-Lite passed model lookup and the full validator with `WAIT` in 3887 ms. In the actual Electron game, another real proposal selected `PROBE_LEFT`, was applied by the reducer, and appeared as **LIVE · 2882ms · applied** with public evidence `e3`/`e4`. No page errors were recorded; the screenshot was inspected.

## Live integration verification in progress

**Gemini is live-tested and applied in the game.** The user approved switching the configured model to `gemini-3.5-flash-lite`, and only the model setting was changed. A real model lookup/validator probe accepted `WAIT` in 3887 ms with a provider response ID. A subsequent actual Electron game request applied `PROBE_LEFT` in 2882 ms and displayed its public evidence IDs. That game test used manual sensing and did not request a camera or enable remote trace sharing.

Earlier `gemini-3.8-flash` lookup succeeded, but generation attempts returned HTTP 503 or timed out after a corrected server-deadline configuration. The historical eight-second timeout explains the approved model change; it is no longer the current Gemini blocker. The game retains the shared eight-second response budget and deterministic fallback for future unavailable or invalid responses.

The latest recorded check still lacked ElevenLabs credentials/voice/model, a Presage key, and a Convex deployment URL. No real ElevenLabs generation/playback, Presage camera measurement, or remote Convex session has passed. The user is still entering service configuration, so these results describe the latest evidence rather than a final assumption about access. Native library loading and local judge sharing do not establish live sensing or remote persistence.

As configuration becomes available, rerun `npm run integrations:check` without overwriting existing local credentials. For live sensing, start Electron and select Presage calibration in operator settings. This requires a provisioned cardiac key and actual camera capture in stable lighting. Browser mode supports manual or explicitly simulated sensing. A supplied Convex development deployment must have the repository functions provisioned and server secrets configured before its live path can pass.

Current Gemini evidence is [the live validator probe](qa/gemini-live-lite.json), [the actual Electron game result](qa/electron-live-providers.json), and [the inspected screenshot](qa/electron-live-providers.png). The probe was initially run with an isolated process override; the user subsequently approved persisting that model selection. [integration-checks.json](integration-checks.json) aggregates service results. Historical 3.8 attempts remain in [qa/gemini-live-8s.json](qa/gemini-live-8s.json) and [qa/gemini-diagnosis.json](qa/gemini-diagnosis.json). [INTEGRATION_STATUS.md](INTEGRATION_STATUS.md) explains the current sequence and limitations. The playable two-minute demonstration is in [DEMO.md](DEMO.md); the root [README](../README.md) links test evidence and screenshots.

## Remaining limits

No signed installer or cross-platform hardware test; no novice human playtesting or sustained frame-rate benchmark; no generated speech bundled or live sensor measurement. The successful Gemini game request used neutral manual sensing; live Presage-driven adaptation and remote Convex transport remain separate gates. Convex uses persisted intents and direct provider actions rather than a durable scheduled-job queue. Expired judge access blocks reads but does not automatically delete database records. The local delete control removes session data. The production bundle has a nonfatal size warning.
