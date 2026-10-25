# Co-op (experimental): a friend holds the manual

In the style of *Keep Talking and Nobody Explodes*: the player in the shelter loses the puzzle keys, and a friend on the spectate link reads them from a manual and talks the player through. Solo play is unchanged.

## The manual is a book (v3)

The friend's manual is a book they flip through on the spectate page (`src/ui/CoopManual.tsx`): contents, then one page per puzzle. It holds **every answer for the run** and is printed from the run's seed alone (`coopBook(seed)` in `src/game/book.ts`), so nothing live is needed to look anything up. Every mapping is reshuffled for each seed. The player has to describe what they see; the friend finds it in the book and answers.

| Puzzle | Player sees and says | Book page |
| --- | --- | --- |
| Faults by ear (stage 1, 3) | No rack key. "Research 1, I hear a high whine." | Rack fault sounds: for each stage, which machine makes each sound. |
| Cables (stage 1, 3) | Cable symbols; each socket shows the book's code for the cable that belongs in it. "Panel 2, the star." | Cable patch codes: for each panel, symbol → socket code. |
| Conduit (stage 1) | No power glow or joined reading; the IN and OUT rows are labelled. "IN row 2, OUT row 4." Only the rated route carries the surge: engaging a path that leaves out any of its tiles arcs loudly (`ratedRouteLive`), so a route found without the book fails. | Conduit boards: four solved boards, one per IN/OUT pair. The game picks one of the four for each conduit. Off-route tiles (·) still don't matter. |
| Memory (stage 2, 4) | Symbols during playback (☾ MOON, ◉ EYE, ✕ CROSS, ☰ BARS), one neutral tone; digits 1–4 to enter. "Moon, eye, eye, bars." | Signal symbols: for each stage, symbol → digit. |
| Locate (stage 3) | The radar is dark; keys 1–4 with no ring names. | Radar range keys: distance band → key, plus the live range from the trace. |
| Calm hold (stage 4) | The pacer is hidden. | Breathing pacer: the only live page (`coopManual`), so the friend can call in and out. |
| Heartbeat mask (stage 2) | Unchanged. | Nothing to look up. |
| Basement door (final) | Four key slots; T stays locked. | Basement door key. |

**Puzzle order.** In every non-tutorial run (solo or co-op) the puzzles within each research stage come in an order shuffled from the seed (`stageSteps` in `tasks.ts`); stages 2 and 4 still end at the transmitter. So the friend can't predict which page is next and has to ask.

**Interference.** While the creature is within the near position, the book breaks up with grey static bursts every few seconds (steady partial static under reduced motion).

**Voice.** With voice chat on, the player's own microphone above a whisper is noise the creature hears, even with the equipment isolated (`playerVoice` in `coop.ts`, `config.voice`): it adds work noise, counts as audible evidence and logs `VOICE_HEARD`. The player's HUD shows a whisper meter. The friend's voice never counts, so a spectator cannot make noise for the player.

The live page (`coopManual`) now carries only the breathing pacer. The transport, the `coop_manual` row and the server rules are unchanged and still accept the older kinds.

## The manual is a separate, narrow projection

`coopManual(state)` (`src/game/coop.ts`) returns only the live breathing pacer, or null (the book has the rest). It is null outside co-op, after the run ends, and on every other step. It never enters `sanitizedTrace`, the director request or any provider projection (tests compare the co-op trace and director request byte for byte with standard). The private puzzle state (`targetOrder`, routing `answer`) is unchanged and stays local.

## Transport

- **Local link:** `CoopManualPublisher` (`src/integrations/coop.ts`) posts the page on its own BroadcastChannel, `${traceChannel}-coop`, on change and once a second for late joiners, and posts "none" when sharing stops.
- **SpacetimeDB:** the same publisher calls `publishManual` on change, at most once a second. `spacetimedb/src/coop.ts` holds one `coop_manual` row per session (latest page only, no history). The reducer requires the owner capability, a session created in `coop` mode, an exact shape (`spacetimedb/src/coopRules.ts`, shared with the client: fault keys are permutations of 0–3, wire keys permutations of at most 6, conduit tiles a size² array of 4-bit openings, at most 36 values) and a monotonic sequence; writes closer than 250 ms are refused so the client retries. `removeSession` and the 24-hour expiry delete the row (`dropCoop`).
- **Friend:** `CoopManualFeed` reads the local channel and the capability-checked `coop_manual_feed(id, judgeCapability)` view, revalidates every row (`manualFromRow`) and resyncs from the cache (view rows have no client key). A fresh local message (under 2.5 s) wins; otherwise the database row. `src/ui/CoopManual.tsx` renders it.

Consent: co-op needs trace sharing, since the link is how the friend gets the manual. Anyone with the spectate (or judge) link can read the live page.

## Verified

- `npm test`: `tests/coop.test.ts` (whole co-op runs on six seeds, in their shuffled orders, reach the final broadcast with no wrong input using only the book and what the player would describe; orders vary per seed and stay fixed in the tutorial; every book mapping changes with the seed; the player's sockets show book codes, memory shows glyphs and the conduit no power reading; the live page is only the pacer, and nothing from the manual enters the trace or the director request; voice is heard only in co-op; every book page renders) and `src/integrations/coop.test.ts` (row validation, publisher rate and withdrawal, same-browser feed).
- `tests/fixtures/spectate.html?mode=coop` shows the book (contents, all eight pages, page turns, static when the creature is close) on the live spectate page.
- [Local SpacetimeDB 2.13](qa/coop-local-spacetime.json): 14/14 checks with `spacetimedb/tests/liveCoop.mts` against a fresh local database (publisher write reaches the friend, wrong owner/standard session/malformed/oversize/too-frequent writes refused, late sequence ignored, wrong capability sees nothing, removal deletes). The existing `liveSpectate.mts` 14 checks still pass on the same module.
- `tests/fixtures/coop.html#player-<step>` / `#friend-<step>` render the real panels and the matching book page from reducer states.

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
