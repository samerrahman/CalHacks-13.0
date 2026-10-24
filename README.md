# LOCK IN

LOCK IN is the root application. `npm run dev` opens this game; NIGHT RELAY remains only in its archived build kit and historical evidence.

You are inside a sealed research shelter. Silence malfunctioning machines, calibrate two remote heartbeat emitters, then send the final broadcast and lead the escaped creature physically into containment. Its location drives the proximity detector, spatial sound and fictional security feeds. Early isolation buys a physical retreat. Once the creature commits at the wall, cutting power is too late. Optional pulse input adds a bounded close-range clue.

## Run

```sh
cd "/Users/jamesqiu/Desktop/CalHacks 13.0"
npm run dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173`. Restart your existing dev process to load the new local voice/provider bridge. Start with **Begin with guidance** for the seven-step tutorial. Browser play works offline with neutral or explicitly simulated sensing. With configured local credentials, the dev server also supplies Gemini and ElevenLabs; live Presage camera sensing requires the desktop app.

```sh
npm run desktop          # build and launch Electron for native camera sensing
GEMINI_MODEL=gemini-3.5-flash-lite npm run desktop  # tested live model; leaves .env unchanged
npm run check            # tests, typecheck, browser build, Electron build
npm run assets:validate  # hashes, actual GLB clips, WAVs, CCTV and decals
npm run test:reference   # kit reference invariants
npm run test:browser     # real-control Chrome tests; requires npm run dev separately
npm run test:desktop     # isolated offline Electron smoke, including second screen
```

On a fresh checkout use `npm ci`. Dependencies are pinned; this build was verified on macOS 14.2.1, Apple Silicon, Node 22.23.3, Electron 45. Browser WebGL and audio are required. The live webcam adapter uses Presage's native SDK; the browser does not estimate pulse.

## Controls

| Control | Action |
| --- | --- |
| Click equipment / E | Open the computer, security monitor or isolation controls |
| Space | Leave the equipment interface |
| 1–4 / numbered buttons | Enter task choices while using the computer |
| R | Replay the same sequence freely |
| T | Transmit a calibrated lure / final containment broadcast |
| Q | Isolate equipment; act on the alarm before the attack commits |
| Hold F for 1 second | Restore power; wait for receding footsteps / the clear window |
| Restore button | Accessible one-click equivalent with cancel |
| Station buttons / drag | Face equipment / look around the room |
| Escape | Pause game time, sound and capture |
| J | Open sanitized judge trace |

Four completed research stages enable the final broadcast. A completed stage stays complete. A successful lure protects its physical route and arrival; a model cannot cancel it. A loss needs a real approach and nonphysiological sound evidence. The proximity alarm gives an early audible cue; there is no visible breach alert or countdown. Once the attack commits, Q, restoring power and lures cannot cancel it. Time alone cannot win. Sedation wears off during active play.

The fault stages now require eight and twelve repairs, with up to two and three concurrent failures. Memory stages require five and six pulses, faster playback and a twenty-second response window. The creature accelerates during the run. Early defense keeps slower play viable. Jump scares include monitor disturbances, impacts and a dedicated creature breach frame. The opening and tutorial are skippable. Captions, neutral sensing, reduced motion, softer impact sounds, fixed memory tempo, volume and mute are available.

## Optional integrations and privacy

Keep existing credentials in ignored `.env` / `.env.local`; `.env.example` lists names. Never prefix secret keys with `VITE_`. Provider keys stay in Node-side Vite middleware, Electron main or Convex actions. Local `npm run dev` calls the loopback-only provider bridge directly; it does not need Convex trace consent for voice. Static production browser hosting still needs a compatible Convex backend for provider calls.

Gemini chooses legal observable tactics; local rules validate every reply and use a seeded fallback after an eight-second deadline. ElevenLabs receives exact authored captions; newly generated, cached and fallback speech have distinct labels. Use **Camera & pulse setup** before a run or the pulse button during play to select a device, view its mirrored local preview, calibrate and stop capture. Presage requires deliberate webcam selection and usable calibration. The preview uses the same video stream as the native adapter; it does not open a second camera. Missing or rejected measurements immediately produce neutral UNKNOWN physiology. Neither the model nor the shared trace receives raw pulse, memory answers or webcam frames.

Pulse recording and sanitized trace sharing have separate, unchecked opt-ins. Local reports show accepted measurements with gaps, event timing and conservative supported change/recovery. Simulated reports say SIMULATED. They do not infer fear or diagnose anything. Run deletion clears in-memory history and attempts deletion of the consenting remote session; remote failure is reported.

New live check: the monster’s ElevenLabs line generated in 185 ms and decoded/started during a real browser encounter. Earlier LOCK IN verification accepted a Gemini 3.5 Flash-Lite tactic in 928 ms; the saved 3.8 model timed out. The temporary launch override above uses the previously tested model. Presage remains blocked by CAMERA_NOT_FOUND (macOS reports zero camera devices), and the reachable Convex deployment lacks the public LOCK IN `sessions:version` function. Local/manual play and local judge sharing pass.

See [current integration status](docs/INTEGRATION_STATUS.md) and [verification handoff](docs/HANDOFF.md) for actual new-game evidence and external blockers. Old NIGHT RELAY results do not count as LOCK IN live tests. Do not run Convex provisioning/deployment automatically; use the existing project in your own terminal when required.

## Implementation and assets

React handles menus and overlays; Three.js renders the sealed shelter. `src/game/` owns fixed-step authority, seeded faults/memory, logical routes, quiet/lure protections and validated director tactics. `src/report/` analyzes optional in-memory pulse history. `electron/` contains the isolated native/provider bridge; `convex/` contains consented sessions and capability-checked functions.

Runtime assets include 10 GLBs, 11 animation clips, 27 original mono WAV effects, 7 SVG decals, 4 generated CCTV backgrounds and one generated breach-scare image. Deterministic rust/grime textures and dim amber/red lighting give the room its darker industrial treatment. Their provenance, licenses and actual uses are documented in [ASSETS](docs/ASSETS.md). Creature geometry is CCTV-only. The security feed is fiction, distinct from optional webcam sensing. The kit and its ZIP remain available as design/reference archives.
