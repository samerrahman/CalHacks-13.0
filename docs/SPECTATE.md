# Spectating: friends watch your run

A friend opens a link and watches your run read-only: the creature's distance, exposure, stage, key moments, the shelter's props (see [PHYSICS.md](PHYSICS.md)) and, only if you turn it on separately, a single **FEAR** reading. The player's device works FEAR out from its own camera estimates and sends that one number, never its parts, alongside the heart rate it already shared (`spectatorFear` in `src/integrations/spectate.ts`): Presage's fear expression score; heart rate above the frozen baseline (+25 BPM is full); breathing above the resting rate (+8 breaths/min is full); and the skin-response proxy above the first minute (+3 spreads is full). Each part counts only while its estimate is accepted and fresh (breathing also while its signal status is ok), weighted face 0.4, heart 0.3, breathing 0.2, skin 0.1; the result is 0.6 × the strongest part + 0.4 × the weighted mean, and a pulse at least 8 BPM over baseline while the trend reads ELEVATED reads at least 55%. The spectator page holds the last shared value for up to 8 s through dropouts (dimmed, "showing their last reading"), then falls back to its heart-rate estimate rather than freezing a stale number; it forgets the value whenever sharing stops. A fear row more than three readings behind the vitals row is treated as left over. The page shows no separate pulse or breathing numbers. A player on an older build sends no fear number, so the page estimates it from heart rate alone and says so (**FROM THEIR HEART RATE**). It is a game estimate, not a medical reading. (User decision, 2026-10-25: share one combined fear number rather than heart rate alone.)

## Play with a friend

Choose **Play with a friend** on the start screen. This opts the run into sharing and starts `coop` mode: the friend holds the fault, cable and conduit instructions. The optional camera check lets the player continue with a camera or choose **Play without camera**. The invitation holds game time until **Start**; the **LIVE** button reopens it during play. **Stop sharing** closes video, removes the shared session and gives the player their solo puzzle keys back. Ordinary solo runs create no shared session.

One invitation grants access to game events, the latest accepted heart rate and combined fear number when sensing and that consent are on, and the co-op manual. Live webcam video is included only when the player chooses to enable the camera; it travels peer to peer and is not recorded. Game events expire after 24 hours. The developer trace controls are available only with `?debug`; they are absent from the normal player UI.

Anyone holding the link can see the shared run. Each run makes a new link. For another device, both the database and a reachable web build are needed: set `VITE_SPACETIMEDB_HOST`, `VITE_SPACETIMEDB_DB_NAME` and `VITE_SPECTATE_ORIGIN` before building. Loopback URLs and desktop `hush://` pages are labelled as local-only. The UI waits for connection setup before letting the player copy a link, so it cannot copy a temporary local capability as a remote invite.

The shelter camera is a local rendering of the room from public game events. Drag or hold arrow keys to look around; release to return to the fixed mount. Reduced motion returns immediately. This is separate from the player's real webcam.

A blocky researcher (`src/spectate/researcher.ts`, under 200 triangles) stands in for the player, on the camera and as the light dot on the map, at the station the player is facing (terminal, radar or emergency lever), typing, tapping the screen or pulling the lever while a task panel is open there, idle otherwise. On the same-browser link the snapshot carries `player: { station, working }` (`sanitizedTrace`; `working` is the open panel, never while paused or after the run) and nothing else about the player. SpacetimeDB rows do not carry it, so remote spectators get a pose inferred from public events (`src/spectate/player.ts`): at the lever while the equipment is off or just after isolating or restoring it, otherwise at the terminal, typing for a few seconds after each terminal input. That inference cannot see the radar, the conduit, heartbeat, calm or locate work. The researcher walks between stations on the spectator's clock; a late joiner, a restarted run and reduced motion place it without walking.

## What a spectator receives, and what never leaves

| Vitals feed | Excluded from the vitals feed |
| --- | --- |
| One combined fear percentage, 0–100 (`spectator_fear`), computed on the player's device | The parts behind it: expression scores, breathing rate, skin-response proxy, HRV, blinking, talking, waveforms |
| Pulse in whole BPM (only while accepted and fresh), frozen baseline in whole BPM | Camera frames, preview images or recordings (optional video uses the separate peer-to-peer path) |
| Trend label (UNKNOWN, STEADY, ELEVATED, RECOVERED), quality (accepted, rejected, unknown) | Pulse history (the server keeps one latest row, no history; a row not refreshed for 15 s is swept) |
| Source: `presage` or `simulated`; simulated shows **SIMULATED** (the fear row must carry the vitals row's source) | Measurement clocks, native confidence, validation codes, diagnostics |
| Capture status (calibrating, ready, paused…) | RNG state and puzzle state (co-op keys use their own narrow manual feed) |

One exception by design: in an experimental co-op run ([COOP.md](COOP.md)) the link also carries the key for the player's live fault, cable or conduit task, because the friend reads it out. Standard runs never publish it, and it never enters the trace.

The game reducer never reads anything spectators do; spectators cannot send anything to the player. Everything a spectator receives is revalidated in the page (`remoteVitals`), and the server revalidates every write (`shareVitals`, `shareFear`): enums, 40–110 BPM integers, accepted ⇔ pulse present, a 0–100 fear integer, owner capability, monotonic sequence and at most two writes a second. A fear write is dropped unless a vitals row of the same source exists, so it cannot outlive or undo a withdrawal.

## What the spectate page adds

Everything below is built on the spectator's own device from the public trace and, only under the separate heart-rate consent, the whole-BPM pulse. Nothing here reaches the player's game; spectators cannot change the run.

- **Sound** (`src/spectate/audio.ts`): a "Tap for sound" button starts the game's own audio engine, driven from the trace: footsteps louder and quicker as the creature closes in, a run during a seeded hunt, pounding at the wall, a barrage when an attack commits, the scares, the power going off and on. The creature is placed at its public bearing (`creatureBearing`). Optional: the player's heartbeat as a soft lub-dub at their shared BPM.
- **Narrator** (`src/spectate/narrator.ts`): opt-in. Written lines filled in from the trace and the shared BPM ("It is at the wall. Pulse 104."), spoken by the browser's own speech synthesis and always captioned. It uses no provider key and makes no request, so it works on any device.
- **The room on camera** (`src/spectate/room.ts`): the shelter camera shows the current map (sonar scope, wall status unit, basement door whose lock lamps turn green stage by stage) with the researcher above standing in for the player; after a win the basement door slides open and the researcher walks out through it.
- **Reaction cam**: on a hit on the door or a committed attack, the player's webcam (or, without one, the shelter camera) fills the page for about three seconds, then a toast shows the heart-rate jump.
- **Pulse line** (`src/spectate/PulseTrace.tsx`): under the FEAR reading, the shared BPM over the last two minutes with scares and recoveries marked. Kept only in the page's memory.
- **Highlights** (`src/spectate/highlights.ts`): close calls (going quiet with it at the wall), a visit to the wall that ends with it walking away, heart-rate spikes with their likely cause, a friend's decoy pulling it off the wall, and the outcome. Only what the page saw live counts.
- **Predictions** (`src/spectate/predictions.ts`, module `spacetimedb/src/predict.ts`): spectators call "they escape" or "it gets them" until research stage 3, with a display name. Right calls score 200 in stage 1 and 150 in stage 2; the leaderboard shows at the end. One call per connection identity, at most 64 per session, names checked by `predictRules.ts` on both ends, deleted with the session. The player's game never reads them.
- **Recap** (`src/spectate/Recap.tsx`): at the end, the outcome, the biggest jump and its cause, close calls, counts, what the co-op friend contributed and the prediction standings, with **Save as image**.

`tests/fixtures/spectate.html` drives the page from a real reducer run over the same-browser link with SIMULATED vitals; its buttons bring the creature to the wall, scare, isolate, change stage, start the calm hold, win and lose (`?mode=coop` for a co-op run).

The prediction table, its reducer and view, and the `VOICE_HEARD` event type are module changes: until `spacetimedb/` is republished and `npm run spacetime:generate` is run, predictions work between tabs of one browser only (the bindings in `src/module_bindings/` were written by hand to match). Agents do not publish.

## How it flows

- **Player:** `TraceBridge` (`src/integrations/client.ts`) already publishes a sanitized snapshot every ~90 ms to a BroadcastChannel and appends the trace to SpacetimeDB at most once a second. During a friend run it adds `vitals` (`spectatorVitals()` in `src/integrations/spectate.ts`, including `fearPct`) to the local snapshot and calls `shareVitals` at most once a second, then `shareFear` with the same sequence once that lands. Nothing here runs in the game step or waits on the network.
- **Spectator:** `#watch=<access>` routes to `src/ui/SpectateView.tsx`, which reads `SpectateFeed`. It subscribes to three capability-checked views, `judge_trace`, `spectator_vitals_feed` and `physics_feed`, all keyed by the session ID and the judge capability in the link, plus `spectator_fear_feed` on a separate subscription so a module published before it cannot break the others. Without SpacetimeDB (or on the same browser) it falls back to the BroadcastChannel and replays prop physics locally from the same public events. The page labels which transport and physics source it is showing.
- **Freshness:** the spectator times readings on its own clock from when each update arrived (never a remote clock). After 5 s without an update the reading is dimmed and marked held; after 15 s it is hidden. Rows already present when the page subscribes (possibly from a player who left) start out held until a genuinely new update arrives. On the server, a share nobody refreshes for 15 s (closed tab, crash, pause) is swept; a closing game also withdraws its row on a best-effort basis.
- **Revoking:** the client treats the row as possibly present from the moment a share is sent, and retries `stopVitals` until one lands after its last share, including a revoke during an in-flight share, during a reconnect or after a failed stop. Deleting the session detaches the connection first, so a restart in the same click cannot cancel the delete.
- **Server:** `spacetimedb/src/spectate.ts` holds the `spectator_vitals` and `spectator_fear` tables, `shareVitals` / `shareFear` / `stopVitals` and the `spectator_vitals_feed` / `spectator_fear_feed` views; `stopVitals`, `removeSession`, the 24-hour expiry and the 15 s stale sweep delete both rows (`dropVitals`).

View rows have no client-side primary key, so the SDK delivers one update as a separate insert and delete callback, in server order. `SpectateFeed` (and the judge screen) therefore re-read the settled client cache on every callback instead of trusting the last callback.

## Content Security Policy

The SpacetimeDB TypeScript SDK compiles its row codecs with `Function()`, so the page must allow `'unsafe-eval'`, and `connect-src` must include the SpacetimeDB host. `index.html` now allows `'unsafe-eval'`, Maincloud (`https`/`wss`) and loopback HTTP; the Electron policy adds `'unsafe-eval'` only when `VITE_SPACETIMEDB_DB_NAME` is set, plus the local server on port 3000. Before this change no browser or desktop build could reach SpacetimeDB at all (including the existing judge screen).

## Run the local demo

```sh
# 1. Local SpacetimeDB (2.13). It needs an EC keypair once:
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out /tmp/stdb/id_ecdsa
openssl ec -in /tmp/stdb/id_ecdsa -pubout -out /tmp/stdb/id_ecdsa.pub
spacetimedb-standalone start --listen-addr 127.0.0.1:3000 --data-dir /tmp/stdb/data \
  --jwt-pub-key-path /tmp/stdb/id_ecdsa.pub --jwt-priv-key-path /tmp/stdb/id_ecdsa
# 2. Publish the module (a separate CLI config keeps the local identity out of your real login)
spacetime --config-path /tmp/stdb/cli.toml publish -s http://127.0.0.1:3000 --module-path spacetimedb hush-local
# 3. Server end-to-end check (14 checks)
VITE_SPACETIMEDB_HOST=ws://127.0.0.1:3000 VITE_SPACETIMEDB_DB_NAME=hush-local npm run spacetime:e2e
# 4. Game pointed at it
VITE_SPACETIMEDB_HOST=ws://127.0.0.1:3000 VITE_SPACETIMEDB_DB_NAME=hush-local npm run dev
```

In the game: **Play with a friend → camera check (or Play without camera) → skip the cutscene → copy the invite → Start**. To exercise remote transport on one computer, open the invite on `localhost` while the player uses `127.0.0.1`; these are different origins and cannot use the same BroadcastChannel.

## Verified

- `npm run check`: unit tests for the vitals projection, remote revalidation, link parsing, consent on/off over the local link, the offline spectator feed and the local physics replay (`src/integrations/spectate.test.ts`).
- `src/integrations/traceBridge.test.ts`: the revoke and restart races with a mocked connection.
- [Local SpacetimeDB evidence](qa/spectate-physics-local-spacetime.json): 15/15 server checks (`npm run spacetime:e2e`, including the 15 s sweep), owner SQL showing both schedules stopped, and a browser run with the spectator on a separate origin.
- [Maincloud evidence](qa/spectate-physics-maincloud.json): the same 15/15 checks against `scary-5zsk8` after the owner published this branch, with owner SQL showing every physics/vitals table and schedule empty afterwards; plus a browser run on Maincloud (spectator on a separate origin, live vitals, revoke within 3 s, delete leaves no rows). The combined camera/co-op module was also published to `scary-5zsk8` on 2026-10-24 and passed [co-op 14/14](qa/integrated-coop-maincloud.json) and [camera signaling 26/26](qa/integrated-camera-maincloud.json) on Maincloud. Screenshots: [desktop](qa/spectate-remote-desktop.jpg), [phone width](qa/spectate-remote-mobile.jpg).

## Integrated branch verification

- `npm run check`: 228/228 tests, web build and Electron build passed on 2026-10-24.
- The combined module passed on both the local `hush-integrated` test database ([co-op 14/14](qa/integrated-coop-local.json), [camera signaling 26/26](qa/integrated-camera-local.json), [spectating and physics 15/15](qa/integrated-spectate-local.json)) and Maincloud `scary-5zsk8` ([co-op 14/14](qa/integrated-coop-maincloud.json), [camera signaling 26/26](qa/integrated-camera-maincloud.json)).
- Browser: friend start, paused invitation, co-op manual across origins through SpacetimeDB, shelter camera, keyboard look, stop sharing, hidden judge controls, and a 390 px layout without horizontal overflow. [Browser evidence](qa/integrated-friend-browser.json).

## Not verified / not done

- Not run in Electron with a live Presage camera session; the browser run used SIMULATED input.
- All ten requested Presage metrics are available locally through `SensorView.signals` and `SensorController.waveforms()`. Additional signals are not automatically mapped to win conditions. The spectator heart-rate feed still carries pulse, baseline, trend and quality only.
- One link per run: a restart makes a new session, so friends need the new link.
