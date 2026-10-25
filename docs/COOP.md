# Co-op (experimental): a friend holds the manual

In the style of *Keep Talking and Nobody Explodes*: the player in the shelter loses the puzzle keys, and a friend on the spectate link reads them from a manual and talks the player through. Solo play is unchanged.

## Rules (v1)

`createGame(seed, 'coop')` plays the standard rules and balance (same timers, exposure, creature, isolation, deadline). Only what the player is shown changes:

| Task | Player sees | Friend's manual |
| --- | --- | --- |
| Faults by ear (stages 1, 3) | No rack key: `listeningTo` is always null in co-op, so the key never lights, plays or captions. The same 4.4 s gap still holds back the first fault (`rackKey` keeps the timing). L does nothing. Failing machines still sound from their rack slots and YOU HEAR still captions them. | Which sound each machine 1–4 makes, listed by sound: "if they hear high whine, press 3". |
| Cables (stages 1, 3) | Cables keep their symbols and colours; sockets show neutral codes A–F (top to bottom) in one colour. | For the live six-cable panel: each cable symbol → its socket code. The page turns with the panel. |
| Conduit (stage 1) | The board with no power glow, no joined outlet and no CONNECTED reading. | The solved orientation of every route tile on a labelled grid (rows from the top, columns from the left, IN/OUT rows); off-route tiles read "·". A tee shows one valid orientation. |
| Memory, heartbeat mask, locate, calm hold | Unchanged in v1. | "No page right now." |

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

- Not wired into Setup, App, HUD or SpectateView yet (hook snippets go to the integrator), so no end-to-end browser run of a real co-op game.
- Not checked at phone width; not published to Maincloud; no human playtest of the difficulty.
- v1 has no manual for memory, heartbeat mask, locate or calm hold.
