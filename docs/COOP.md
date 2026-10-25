# Co-op (experimental): a friend holds the manual

In the style of *Keep Talking and Nobody Explodes*: the player in the shelter loses the puzzle keys, and a friend on the spectate link reads them from a manual and talks the player through. Solo play is unchanged.

## Rules (v2)

`createGame(seed, 'coop')` plays the standard rules and balance (same timers, exposure, creature, isolation, deadline). Only what the player is shown changes:

| Task | Player sees | Friend's manual |
| --- | --- | --- |
| Faults by ear (stages 1, 3) | No rack key: `listeningTo` is always null in co-op, so the key never lights, plays or captions. The same 4.4 s gap still holds back the first fault (`rackKey` keeps the timing). L does nothing. Failing machines still sound from their rack slots and YOU HEAR still captions them. | Which sound each machine 1–4 makes, listed by sound: "if they hear high whine, press 3". |
| Cables (stages 1, 3) | Cables keep their symbols and colours; sockets show neutral codes A–F (top to bottom) in one colour. | For the live six-cable panel: each cable symbol → its socket code. The page turns with the panel. |
| Conduit (stage 1) | The board with no power glow, no joined outlet and no CONNECTED reading. | The solved orientation of every route tile on a labelled grid (rows from the top, columns from the left, IN/OUT rows); off-route tiles read "·". A tee shows one valid orientation. |
| Memory (stages 2, 4) | Playback shows static (`RECEIVING ▒`), the cue digits never light on the HUD or the terminal screen, and every cue plays the same tone. Input works as standard after playback. | The live sequence, how many digits the player has entered, and whether playback is still running. |
| Locate (stage 3) | The radar, proximity screen and CCTV silhouette go dark (`blind` in the render state) for the locate step only. | The ring key (1–4) where a mark lands now (both on a boundary), and marks made of required. Check before every mark; it keeps moving. |
| Calm hold (stage 4) | The pacer is hidden: the ring only shows whether B is held, and IN TIME / OUT OF TIME is gone. Progress still shows. | The current half-breath (in or out), its length and how far into it; the page runs its own countdown and re-anchors on every update. |
| Heartbeat mask (stage 2) | Unchanged. | "No page right now." |

Notices adapt to co-op ("describe the sound to your friend…"). The deliberate result is harder: the player must describe sounds and the friend must answer quickly while the equipment noise keeps drawing the creature in.

## The manual is a separate, narrow projection

`coopManual(state)` (`src/game/coop.ts`) returns only the key for the live task, or null. It is null outside co-op, after the run ends, and on every other step. It never enters `sanitizedTrace`, the director request or any provider projection (tests compare the co-op trace and director request byte for byte with standard). The private puzzle state (`targetOrder`, routing `answer`) is unchanged and stays local.

## Transport

- **Local link:** `CoopManualPublisher` (`src/integrations/coop.ts`) posts the page on its own BroadcastChannel, `${traceChannel}-coop`, on change and once a second for late joiners, and posts "none" when sharing stops.
- **SpacetimeDB:** the same publisher calls `publishManual` on change, at most once a second. `spacetimedb/src/coop.ts` holds one `coop_manual` row per session (latest page only, no history). The reducer requires the owner capability, a session created in `coop` mode, an exact shape (`spacetimedb/src/coopRules.ts`, shared with the client: fault keys are permutations of 0–3, wire keys permutations of at most 6, conduit tiles a size² array of 4-bit openings, at most 36 values) and a monotonic sequence; writes closer than 250 ms are refused so the client retries. `removeSession` and the 24-hour expiry delete the row (`dropCoop`).
- **Friend:** `CoopManualFeed` reads the local channel and the capability-checked `coop_manual_feed(id, judgeCapability)` view, revalidates every row (`manualFromRow`) and resyncs from the cache (view rows have no client key). A fresh local message (under 2.5 s) wins; otherwise the database row. `src/ui/CoopManual.tsx` renders it.

Consent: co-op needs trace sharing, since the link is how the friend gets the manual. Anyone with the spectate (or judge) link can read the live page.

## Verified

- `npm test`: `tests/coop.test.ts` (same run as standard apart from mode and notices; the key is hidden from the player-facing state and the rendered fault, cable and conduit panels; `coopManual` solves faults, both cable panels and the conduit without private state; null on every other step and outside co-op; the trace and director request carry no manual) and `src/integrations/coop.test.ts` (row validation, publisher rate and withdrawal, same-browser feed).
- [Local SpacetimeDB 2.13](qa/coop-local-spacetime.json): 14/14 checks with `spacetimedb/tests/liveCoop.mts` against a fresh local database (publisher write reaches the friend, wrong owner/standard session/malformed/oversize/too-frequent writes refused, late sequence ignored, wrong capability sees nothing, removal deletes). The existing `liveSpectate.mts` 14 checks still pass on the same module.
- `tests/fixtures/coop.html#player-<step>` / `#friend-<step>` render the real panels and manual pages from reducer states (checked at about 766 px wide).

## Not verified / not done

- Wired into **Play with a friend**, the invitation, LIVE/Stop controls and spectator manual. The combined local module passed 14 co-op checks and the manual was checked across browser origins; see `qa/integrated-coop-local.json` and `qa/integrated-friend-browser.json`.
- The integrated spectator layout fits 390 px; not published to Maincloud; no human playtest of the difficulty.
- v2 has no manual for the heartbeat mask.
- The module with the v2 validator is published to Maincloud (`scary-5zsk8`); [20/20 live checks](qa/coop-maincloud-v2.json), including memory, locate and calm pages reaching the friend and malformed ones refused. No human playtest of the v2 difficulty yet.

## The friend as a second player (warning, decoys, door key, voice)

Beyond the manual, the friend now has three things to do, all optional for the player and all revalidated by the player's game (the reducer never trusts the spectator page):

| Feature | Friend does | Player sees | Rules (`config.coop`, `src/game/coop.ts`) |
| --- | --- | --- | --- |
| **Warning lamp** | Presses **It's close · warn them** (it pulses when the creature is within ~9 units). | A flashing red lamp, "YOUR FRIEND: IT'S CLOSE · Go quiet now", and a radio chime. | Information only: no effect on movement, danger or isolation. One every 3 s. |
| **Remote decoy** | Arms an emitter by solving one of the player's own puzzles on their page (a conduit board, then a memory sequence, alternating; a practice copy of the real task code), then fires it. | "DECOY FIRED · n left" and the lure sound far out in the trees. | +0.75 outward bias for 7 s. Three per run, 25 s apart. Refused once an attack has committed or after the final broadcast. |
| **Two-key door** | Reads a four-digit key (digits 1–4) from a new **Basement door key** manual page. | At the final terminal, four key slots and buttons 1–4; T stays locked until the key turns. A wrong digit is a loud `WRONG_INPUT` and starts over. | Key from the seed only (`doorKeyFor`), so it never shifts the run's RNG. Solo runs, and a run whose friend pressed **Stop sharing**, never need it. |

New public events: `FRIEND_WARNING`, `FRIEND_DECOY`, `DOOR_UNLOCKED` (and `RECOVERY_REWARD` from the wellness rules). The door key, door input and counters stay out of the trace and the director request (tested).

### Friend → player transport

- **Same browser:** the spectator posts `{ kind, id }` on `${channel}-friend`; `FriendSignalReceiver` (`src/integrations/coop.ts`) dedupes by id.
- **SpacetimeDB:** `friendSignal(id, judgeCapability, kind)` (`spacetimedb/src/coop.ts`) checks the judge capability from the link, a live **co-op** session and flood limits (`FRIEND_LIMITS` in `coopRules.ts`: warn ≥ 2 s apart, decoy ≥ 15 s apart, at most 3), then bumps running counts in the private `coop_remote` row. The player subscribes to the owner-only `coop_remote_inbox(id, ownerCapability)` view and acts only on increases seen after subscribing (capped per update). `removeSession` and the 24-hour expiry delete the row.
- The door page travels on the existing manual feed (`kind: 'door'`, validated by `manualRowValid`).

### Needs a module publish before it works across devices

The friend-signal reducer and view, the `door` manual kind and the new event types are module changes. Until `spacetimedb/` is republished to the database (`scary-5zsk8`) and `npm run spacetime:generate` is run, remote friends cannot warn, fire decoys or see the door key (the same-browser link works). `src/module_bindings/` was updated by hand to match the module; regenerating should produce the same files. `TraceBridge` resends the new event types as `UNKNOWN` if an older module rejects them, so the trace never stalls.

### Not verified

No two-device run yet, no live SpacetimeDB test of `friendSignal`, and no human playtest of decoy balance.
