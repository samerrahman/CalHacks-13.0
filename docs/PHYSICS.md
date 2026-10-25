# Server-authoritative prop physics on SpacetimeDB

Loose props in the shelter (cans, a mug, bolts, a bottle, a flashlight) jump and skitter when the creature pounds the door or its footsteps reach the wall. SpacetimeDB simulates them, and every viewer of a consenting run (the player's second screen, spectating friends) subscribes to the same body rows, so everyone sees the same can roll off the same desk.

## Rules it keeps

- **Additive and cosmetic.** Physics never feeds back into game rules, time, the creature or scoring. The local game reducer still owns game time and never waits on SpacetimeDB.
- **No new client call on the game loop.** Impulses come from the sanitized trace events the client already sends with `appendTrace`, at most once a second. Nothing new runs inside the 30 Hz game step or the render loop.
- **Deterministic.** `spacetimedb/src/physicsSim.ts` is pure TypeScript: no clocks, no `Math.random`. Jitter is an integer hash of the impulse sequence number. The same impulses always give the same frames, so the offline spectator fallback replays exactly what the server would.
- **Consent-scoped and private.** A physics world exists only for a session created with trace consent, is read only through a capability-checked view, and is deleted with the session (explicit delete or the 24-hour expiry).

## Data flow

```
game reducer (30 Hz, local) ── events ──► TraceBridge.publish (≤1 Hz remote write)
                                              │ appendTrace(events, summary)
                                              ▼
                              SpacetimeDB module (spacetimedb/src/)
   appendTrace ──► applyTraceImpulses ──► physics_body rows (woken, kicked)
                                              │ physics_tick: repeating 50 ms schedule,
                                              │ present only while some world is awake
                                              ▼
                     physicsStep: 3 fixed 1/60 s steps per awake world
                                              │
                         physics_feed(id, judgeCapability) view
                                              ▼
                 spectator page / second screen: smooths rows at display rate
```

Offline (no `VITE_SPACETIMEDB_DB_NAME`, or the server is unreachable): the spectator's `LocalPhysics` (`src/integrations/physics.ts`) runs the same step on the same public events from the same-browser BroadcastChannel link. The page labels which one it is showing.

## Tables, reducers and views (`spacetimedb/src/physics.ts`)

| Name | Kind | Contents / rule |
| --- | --- | --- |
| `physics_world` | private table | One row per session: `tick`, `awake`, `lastEventSeq` (trace events already applied, so a resent batch never double-kicks), `lastImpulseTick`, `knocks`, `lastKnockAtMs`. |
| `physics_body` | private table | One row per prop: `sessionId` (btree), `slot`, position, velocity, `rest` counter, `sleeping`. Static properties (kind, radius, mass, restitution, friction) live in code by slot. |
| `physics_tick` | private scheduled table | At most one repeating 50 ms row. Inserted when something wakes; `physicsStep` deletes it when every world sleeps, so an idle database costs nothing. |
| `physicsStep` | scheduled reducer | Steps each awake world 3 × 1/60 s, writes only bodies that moved, and garbage-collects worlds whose session is gone. A world still awake 600 ticks (30 s) after its last impulse is put to sleep, so the schedule row is always deleted eventually. |
| `physicsKnock(id, ownerCapability, slot)` | reducer | Owner-only flick of one prop (four a second at most). The hook for a later "knock it off the desk as a distraction" interaction; nothing calls it yet. |
| `physics_feed(id, judgeCapability)` | public view | The session's props (`slot` primary key, kind, radius, position, sleeping, tick) when the capability matches; otherwise nothing. |

Changes to the contract file `spacetimedb/src/index.ts` (user-approved 2026-10-24; post in team chat before merging): register the three tables, export the reducer group, call `applyTraceImpulses` at the end of `appendTrace`, and drop the world in `removeSession` and `expireSession`.

## Event → impulse map (`impulsesFromEvents`)

| Sanitized event | Impulse | Strength |
| --- | --- | --- |
| `SCARE impact` (fires with the near alarm) | `DOOR_POUND` | 0.75 |
| `SCARE monitor` | `FOOTSTEPS` | 0.4 |
| `SCARE breach` | `BREACH` | 1.0 |
| `ATTACK_COMMITTED` | `DOOR_POUND` | 1.0 |
| `MONSTER_STEP … to=0/1/2` | `FOOTSTEPS` | 0.6 / 0.4 / 0.2 |

Every viewer already sees these events; the map uses only their sanitized type, detail and game time. Only events from the last 2 game seconds of a batch push props, so a backlog (a world created mid-run, a reconnect resending 30 s of events, a spectator joining late) never fires as one stacked blast.

## Simulation model (`physicsSim.ts`)

- **Bodies:** 12 spheres (radius 1.5–4.5 cm, mass 20–400 g) on the workdesk, the floor and the machine rack, at the render scene's coordinates in metres, so `src/render` could draw them in place later.
- **Static colliders:** the room as an inside box (floor, ceiling, four walls) plus outside boxes for the workdesk (top at 0.92 m) and machine rack. These are approximate proxies for the GLB geometry, not mesh colliders.
- **Step:** semi-implicit Euler at 60 Hz with gravity, light air drag and a 12 m/s speed cap. Sphere–box contacts use the closest point (or the nearest face when the centre is inside), with restitution, tangential friction and no bounce below 0.35 m/s. Sphere–sphere contacts use mass-weighted separation and impulse exchange.
- **Sleeping:** a supported body slower than 5 cm/s for 30 steps sleeps. A sleeper wakes only for a real hit (a neighbour moving faster than 5 cm/s, or one pressing into it); otherwise it acts as static, so two touching props can both sleep and a stack still wakes when its support slides away. A door pound settles in about 2 s, a breach in about 3 s; a regression test sweeps 400 breach and 200 pound sequence numbers and requires every one to settle.
- **Boxes against walls:** a prop whose centre ends up inside the rack or desk leaves through the nearest face that is not flush with a room wall or the floor.
- **Impulses:** structure-borne shake reaches every prop; the push away from the door falls off over 4.5 m. A breach throws the bottle by the door about 2.7 m and makes desk items hop 5–11 cm; footsteps rattle things by a few centimetres.

## Cost and bounds

12 rows per consenting session. The tick runs only while props move (roughly 2–3 s after each pound) and writes only awake bodies. Trace writes are already capped at one a second and 100 events per call. `sanitizeBody` clamps any stored row back into the room and resets non-finite values, so a corrupt row cannot propagate.

## Verification

- `spacetimedb/tests/physicsSim.test.ts`: resting props stay asleep, a pound wakes them and everything settles back to sleep inside the room and outside obstacles, identical inputs give identical frames, the event map accepts only recent listed events, every breach/pound settles (the sleep-loop regression), a fast prop by the wall lands on the rack instead of inside it, and corrupt rows are clamped. Both regressions fail on the first version of the sim.
- The module typechecks with the module's own `tsconfig`, `spacetime build` succeeds, and `spacetime generate` produces the bindings in `src/module_bindings/`.
- Against a local SpacetimeDB 2.13 server (`npm run spacetime:e2e`, [evidence](qa/spectate-physics-local-spacetime.json)): the first trace batch creates a resting 12-prop world; a `SCARE impact` wakes all 12 and the scheduled tick advances them; they settle asleep after 46 ticks (2.3 s), up to 0.77 m from where they started; owner SQL afterwards finds no `physics_tick` row; a resent batch does not kick again; an owner knock moves its prop; a wrong capability sees no rows; removing the session deletes the props.
- In the browser, a spectator on a separate origin drew the server's props (`PROPS · SPACETIMEDB PHYSICS`). A door pound was not observed in the browser run; the server check above covers it.

## Not done yet

- Props are not drawn in the player's Three.js scene (James's `src/render`); only the spectator page draws them, top-down.
- No rotation, friction cones or mesh colliders: spheres against boxes only.
- One world per run: a restarted run gets a new session, a new link and freshly placed props.
- Not published to or measured on Maincloud.
- Load: one global 50 ms tick steps every awake world in one transaction. Fine for a handful of concurrent runs; not measured beyond that.
