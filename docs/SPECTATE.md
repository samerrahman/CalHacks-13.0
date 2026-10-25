# Spectating: friends watch your run

A friend opens a link and watches your run read-only: the creature's distance, exposure, stage, key moments, the shelter's props (see [PHYSICS.md](PHYSICS.md)) and, only if you turn it on separately, your live heart rate.

## Consent

Two separate opt-ins, both off at the start of every run, both in the J panel:

1. **Share sanitized game events** (the existing trace consent). Creates the private session and the link. Without it there is nothing to watch.
2. **Also share my live heart rate with spectators** (new, needs 1). Adds the current accepted pulse in whole BPM, the change from your frozen baseline, the coarse trend and signal quality. Turning it off withdraws it from the local link at once and deletes the database row. Turning off trace sharing or deleting the session removes everything.

Anyone with the link can see what you share; the link is the capability. Each run creates a new session and link. Until the SpacetimeDB session exists the button reads "Copy same-browser link". A friend on another machine needs a page they can open: set `VITE_SPECTATE_ORIGIN` to a hosted web build (any static host); the desktop app's `hush://` page and a loopback dev server cannot be opened elsewhere, so without it the copy button is disabled there. "Open spectator view" works locally in both builds.

## What a spectator receives, and what never leaves

| Shared (with consent 2) | Never shared |
| --- | --- |
| Pulse in whole BPM (only while accepted and fresh), frozen baseline in whole BPM | Camera frames, preview images or recordings |
| Trend label (UNKNOWN, STEADY, ELEVATED, RECOVERED), quality (accepted, rejected, unknown) | Pulse history (the server keeps one latest row, no history; a row not refreshed for 15 s is swept) |
| Source: `presage` or `simulated`; simulated shows **SIMULATED · not a real heart rate** | Measurement clocks, native confidence, validation codes, diagnostics |
| Capture status (calibrating, ready, paused…) | Puzzle answers, wire solutions, RNG state |

The game reducer never reads anything spectators do; spectators cannot send anything to the player. Everything a spectator receives is revalidated in the page (`remoteVitals`), and the server revalidates every write (`shareVitals`): enums, 40–110 BPM integers, accepted ⇔ pulse present, owner capability, monotonic sequence and at most two writes a second.

## How it flows

- **Player:** `TraceBridge` (`src/integrations/client.ts`) already publishes a sanitized snapshot every ~90 ms to a BroadcastChannel and appends the trace to SpacetimeDB at most once a second. With consent 2 it adds `vitals` (`spectatorVitals()` in `src/integrations/spectate.ts`) to the local snapshot and calls `shareVitals` at most once a second. Nothing here runs in the game step or waits on the network.
- **Spectator:** `#watch=<access>` routes to `src/ui/SpectateView.tsx`, which reads `SpectateFeed`. It subscribes to three capability-checked views, `judge_trace`, `spectator_vitals_feed` and `physics_feed`, all keyed by the session ID and the judge capability in the link. Without SpacetimeDB (or on the same browser) it falls back to the BroadcastChannel and replays prop physics locally from the same public events. The page labels which transport and physics source it is showing.
- **Freshness:** the spectator times readings on its own clock from when each update arrived (never a remote clock). After 5 s without an update the reading is dimmed and marked held; after 15 s it is hidden. Rows already present when the page subscribes (possibly from a player who left) start out held until a genuinely new update arrives. On the server, a share nobody refreshes for 15 s (closed tab, crash, pause) is swept; a closing game also withdraws its row on a best-effort basis.
- **Revoking:** the client treats the row as possibly present from the moment a share is sent, and retries `stopVitals` until one lands after its last share, including a revoke during an in-flight share, during a reconnect or after a failed stop. Deleting the session detaches the connection first, so a restart in the same click cannot cancel the delete.
- **Server:** `spacetimedb/src/spectate.ts` holds the `spectator_vitals` table, `shareVitals` / `stopVitals` and the `spectator_vitals_feed` view; `removeSession` and the 24-hour expiry delete the row.

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

In the game: Operator settings → Pulse input SIMULATED (browser) → Share sanitized game events → start → J → tick "Also share my live heart rate" → Copy spectate link. Open the link at `http://localhost:5173/#watch=…` (a different origin than `127.0.0.1`, so it cannot use the BroadcastChannel and must go through SpacetimeDB, like a friend on another machine). In the desktop app the same flow shows the live Presage reading labelled PRESAGE.

## Verified

- `npm run check`: unit tests for the vitals projection, remote revalidation, link parsing, consent on/off over the local link, the offline spectator feed and the local physics replay (`src/integrations/spectate.test.ts`).
- `src/integrations/traceBridge.test.ts`: the revoke and restart races with a mocked connection.
- [Local SpacetimeDB evidence](qa/spectate-physics-local-spacetime.json): 15/15 server checks (`npm run spacetime:e2e`, including the 15 s sweep), owner SQL showing both schedules stopped, and a browser run with the spectator on a separate origin.
- [Maincloud evidence](qa/spectate-physics-maincloud.json): the same 15/15 checks against `scary-5zsk8` after the owner published this branch, with owner SQL showing every physics/vitals table and schedule empty afterwards; plus a browser run on Maincloud (spectator on a separate origin, live vitals, revoke within 3 s, delete leaves no rows). A friend on another machine or network was not checked. Screenshots: [desktop](qa/spectate-remote-desktop.jpg), [phone width](qa/spectate-remote-mobile.jpg).

## Not verified / not done

- Not run in Electron with a live Presage camera session; the browser run used SIMULATED input.
- Only pulse, baseline, trend and quality are shared. Breathing and the other Presage signals are not yet carried by `SensorView`.
- One link per run: a restart makes a new session, so friends need the new link.
