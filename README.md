# HUSH

HUSH is the root application. `npm run dev` opens this game; NIGHT RELAY remains only in its archived build kit and historical evidence.

You have eight active minutes to get out of a sealed shelter through its basement while the creature hunts outside; a typical win takes about five. Each of the four research stages releases one of the basement door's four locks (lamps above the door turn green, the header shows BASEMENT LOCKS n / 4). The last step sends one more decoy heartbeat and starts the door motor, and a win plays the ending film: the motor's noise gives you away, its sonar contact charges and it hits the shelter door while the basement door grinds open, you squeeze through and drop the door on its claws, and the basement turns out not to be empty. Repair faults, patch cable panels, route power quietly, memorize growing signal sequences, mask your heartbeat, mark the creature's position from the monitor, breathe with a calm pacer, and broadcast remote lures. Running equipment is loud: while a research task is live, exposure keeps climbing and the creature keeps coming until you turn the equipment off, so you will regularly have to stop mid-task and isolate. There is no alarm: you hear its footsteps get louder and quicker as it nears, from the direction it is in, and it pounds on the wall when it is there. Now and then it charges on its own (a run), even if you have made no mistakes. The security monitor's ping radar shows where it was at the last ping, never an exact number. Three isolation cells (one recharged per completed stage) buy time: an isolation lasts until you restore power (hold F, from 4 seconds) or 25 seconds, so wait until the footsteps fade. Once an attack commits at the wall, cutting power is too late.

## Run

```sh
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173`. Restart your existing dev process to load the new local voice/provider bridge. Start with **Begin with guidance** for the seven-step tutorial. The first start in a session asks you to enable your camera for Presage; **I don’t want to turn on my camera** plays with neutral physiology. Browser play works offline with neutral or explicitly simulated sensing. With configured local credentials, the dev server also supplies Gemini and ElevenLabs; live Presage camera sensing requires the desktop app.

```sh
npm run desktop          # build and launch Electron for native camera sensing
GEMINI_MODEL=gemini-3.5-flash-lite npm run desktop  # tested live model; leaves .env unchanged
npm run check            # tests, typecheck, browser build, Electron build
npm run assets:validate  # hashes, actual GLB clips, WAVs, CCTV and decals
npm run test:reference   # kit reference invariants
HUSH_TEST_URL=http://127.0.0.1:5173 npm run test:browser  # with dev running
npm run test:desktop     # isolated offline Electron smoke, including second screen
```

On a fresh checkout use `npm ci`. Dependencies are pinned; this build was verified on macOS 14.2.1, Apple Silicon, Node 22.23.3, Electron 45. Browser WebGL and audio are required. The live webcam adapter uses Presage's native SDK; the browser does not estimate pulse.

## Controls

| Control | Action |
| --- | --- |
| Click equipment / E | Open the computer, security monitor or isolation controls |
| Space | Leave the equipment interface |
| 1–4 / numbered buttons | Task choices: faults, routing switches, heartbeat taps, memory; sector marks at the monitor |
| T | Transmit a calibrated lure, engage a routed relay, or send the last decoy and start the basement door motor |
| R | Replay the same sequence freely |
| Drag cables / select cable then socket | Reconnect matching symbols after each fault stage |
| Q | Spend one of three isolation cells; hold F to restore once it is clear (from 4 s), or it restores itself at 25 s |
| B (hold) | Breathe in with the calm pacer; release to breathe out |
| Hold F for 1 second | Restore a blackout freely, or end isolation in its final restore window |
| Restore button | Accessible one-click equivalent with cancel |
| Station buttons / drag | Face equipment / look around the room |
| Escape | Pause game time, sound and capture |
| J | Open sanitized judge trace |

The run begins with a 25-second grace period. Guided practice is nonlethal and does not use the run's timer or cells. The regular run has an eight-minute deadline, including time spent with equipment off. Every shutdown consumes a cell, adds persistent exposure and triggers a cooldown after power returns. All task progress persists.

The detector refreshes every four seconds and goes completely dark without power. The monster moves every 2.5 seconds, at most three units per step. A nearby alarm and matching captions continue during isolation; the local rules guarantee at least 2.5 seconds of near warning before an irreversible attack can commit. The display never shows a breach countdown. Intermediate lures bias movement outward; the final broadcast brings it to position24 and a three-second seal.

Stage 1 is a rack sound key, six faults you find by ear (the buttons only say 1–4), 6 cables and a conduit board. Stage 2 is memory growing from 3 to 5 cues, then the heartbeat mask. Stage 3 is a new sound key, eight faults by ear (two can sound at once), 12 cables and three monitor marks. Stage 4 is memory growing from 4 to 6 cues, then the calm hold. The heartbeat mask and calm hold use the coarse accepted Presage trend when available (an elevated pulse makes them harder) and run on standard rules without it. With calibrated live sensing, the heartbeat mask beats at your own rounded resting pulse, and the calm pacer starts at your own resting breathing pace and slows by a quarter second each breath to the standard pace. Calming down (an accepted ELEVATED trend returning to RECOVERED) makes the creature lose your trail for eight seconds, once per stage; manual play has no equivalent reward. Only rounded, frozen resting values enter local game state; providers and traces never receive them. Memory uses 0.36-second flashes and a sixteen-second response window per round. Replaying is free but costs time. Captions, neutral sensing, reduced motion, softer impacts, fixed memory tempo, volume and mute remain available. The opening and ending cutscenes are pre-rendered films (see [cutscene/README.md](cutscene/README.md)); the ending has its own skip button, and text cards replace it under reduced motion. See [tuning and balance](docs/BALANCE.md) for defaults, probabilities, fairness bounds and measured simulation results.

## Optional integrations and privacy

Keep credentials in ignored `.env` / `.env.local`; `.env.example` lists names. Never prefix secret keys with `VITE_`. Provider keys stay in Node-side Vite middleware or Electron main. Local `npm run dev` calls the loopback-only provider bridge directly; it does not need trace consent for voice. SpacetimeDB handles consenting sanitized session traces and the live judge screen. A static browser build uses local AI/voice fallbacks until a trusted provider service is configured.

For a remote judge screen, publish the module in `spacetimedb/` to your chosen SpacetimeDB database, run `npm run spacetime:generate` after schema changes, and set `VITE_SPACETIMEDB_DB_NAME` plus the public `VITE_SPACETIMEDB_HOST` in `.env.local` before building. `scary-5zsk8` on Maincloud runs the earlier spectate/physics module, published by its owner and checked live ([evidence](docs/qa/spectate-physics-maincloud.json)); its name is public configuration. Without a configured database, traces stay in the same browser through BroadcastChannel. The database keeps each consenting trace private, exposes a capability checked judge view, and schedules deletion after 24 hours. Solo runs remain private. **Play with a friend** starts co-op: the friend reads the fault, cable and conduit manual while the player controls the shelter. The game reducer remains authoritative and never waits on a database write. The same session also drives cosmetic, server-authoritative prop physics (see [PHYSICS](docs/PHYSICS.md)). The SpacetimeDB SDK needs `'unsafe-eval'` and the database host in the page's Content Security Policy; both policies now allow it.

Gemini chooses validated, bounded probability biases; it never directly sets the creature position. An eight-second deadline falls back locally. Monster text is separately generated from public game events, then its exact caption is sent to ElevenLabs. Generated text, authored fallback, live voice and cached voice are labelled separately. A serial speech scheduler prevents overlapping narration and creature dialogue. Use **Camera & pulse setup** before a run or the pulse button during play to select a device, view its mirrored local preview, calibrate and stop capture. After 30 usable calibration seconds, Start calibrated game reuses the active stream. A corner preview displays accepted pulse, breathing, baseline delta and the pulse bar. Breathing has its own 30-second warm-up and quality status. The preview uses the same video stream as the native adapter; it does not open a second camera. Missing or rejected measurements immediately produce neutral UNKNOWN physiology. Neither the model nor the shared trace receives raw pulse, memory answers or webcam frames. The **Play with a friend** invitation shares the run, current accepted pulse and co-op manual; the optional camera choice also enables live peer-to-peer video. **Stop sharing** removes access and restores solo hints. See [SPECTATE](docs/SPECTATE.md) and [CAMERA](docs/CAMERA.md). All ten requested Presage metrics are exposed locally in `SensorView.signals` with status/freshness and waveform access; `?debug` reveals their detailed panel.

Creature speech now uses a much darker local treatment: lower pitch and slower delivery, driven distortion, and a short filtered double. Human radio lines keep their original sound. [Monster voice auditions](notes/monster-voice.md) lists three tested ElevenLabs voices; choose the in-game voice with `ELEVENLABS_VOICE_ID` in ignored `.env.local`.

Pulse and breathing recording are automatic whenever camera sensing is enabled; friend sharing is enabled by choosing **Play with a friend** (or the judge-screen trace opt-in in Operator settings). Local reports chart accepted pulse and breathing rate over the run, with jump scares, other events and recovery rewards marked, and show accepted measurements with gaps, event timing and conservative supported change/recovery. Simulated reports say SIMULATED. HUSH uses Presage physiology and facial-expression scores only as game input; nothing is a diagnosis or a medical reading. Run deletion clears in-memory history and attempts deletion of the consenting remote session; remote failure is reported.

The generated-monster pipeline was tested live before this overhaul: the final corrected narrative probe used Gemini in891ms and ElevenLabs in359ms, with decoded audio matching the exact generated caption. Those timings are historical evidence, not a new live test of this rule revision. The user reports successful Presage calibration; the latest reliability fixes have automated packet/lifecycle coverage but have not yet been verified against a fresh live camera session. Earlier Convex evidence is historical. The combined co-op/camera module passes local SpacetimeDB checks but still needs an owner publish to Maincloud and a hosted web build for remote invitations.

See [current integration status](docs/INTEGRATION_STATUS.md) and [verification handoff](docs/HANDOFF.md) for actual new-game evidence and external blockers. Old NIGHT RELAY results do not count as HUSH live tests.

## Implementation and assets

React handles menus and overlays; Three.js renders the sealed shelter. `src/game/` owns fixed-step authority, seeded faults/wires/memory, integer movement probabilities, danger, deadline, finite isolation and validated director biases. `src/report/` analyzes optional in-memory pulse history. `electron/` contains the isolated native/provider bridge; `spacetimedb/` contains the consenting session and judge trace backend. `convex/` remains as historical reference and is no longer used by the application.

Runtime assets include 10 GLBs, 11 animation clips, 27 original mono WAV effects, 7 SVG decals, 4 generated CCTV backgrounds and one generated breach-scare image. Deterministic rust/grime textures and dim amber/red lighting give the room its darker industrial treatment. Their provenance, licenses and actual uses are documented in [ASSETS](docs/ASSETS.md). Creature geometry is CCTV-only. The security feed is fiction, distinct from optional webcam sensing. The kit and its ZIP remain available as design/reference archives.
