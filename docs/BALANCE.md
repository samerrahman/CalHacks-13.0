# HUSH balance and movement

The current implementation is authoritative: [`config.ts`](../src/game/config.ts), [`creature.ts`](../src/game/creature.ts), [`tasks.ts`](../src/game/tasks.ts), and [`directorValidation.ts`](../src/game/directorValidation.ts). Gameplay tuning lives in the runtime configuration, including movement weights, bias coefficients, detector cadence, exposure contributions, isolation and lure durations, and every task size. The archived build kits describe earlier designs and remain unchanged.

The design intent: running equipment is loud. While power is on and a research task is live, the room is never silent, so exposure keeps climbing and the creature keeps coming until you turn the equipment off with Q, usually mid-task. Seeded hunts make it charge now and then even if you play flawlessly. A human-paced win takes about seven to eight minutes, and even perfect play is sometimes caught. The game is meant to be hard.

## Local position and time

| Parameter | Current default |
| --- | --- |
| Creature line | Integer 0–24; 0 is the shelter wall, 24 is containment |
| Starting position | 18 |
| Opening grace | 25 active seconds; no movement, scares, contextual taunts or threatening director choices |
| Step cadence | Every 2.5 seconds; first scheduled step at 27.5 seconds |
| Possible step | −3, −2, −1, 0, +1, +2, +3; negative is closer |
| Proximity radar | Pings every 4 seconds while powered, revealing a fading dot at the sampled range and bearing (no number); dark when power is off |
| Near state (no siren) | Latches at position ≤7; clears at ≥10; heard as close footsteps and captions |
| Committed attack | Position ≤1, at least 2.5 seconds since the near state began, and audible evidence within 30 seconds; then an irreversible 2.4-second windup |
| Protocol deadline | 480 active seconds (8 minutes), including final containment arrival/seal; a typical win takes about five |

The authoritative position is dimensionless. Scene coordinates, camera visibility, footsteps and spatial creature voice derive from it, together with a stateless seeded bearing (`creatureBearing`) that drifts smoothly around the shelter for sound direction, captions and the radar. They do not simulate a second creature. Camera A covers positions 7–14, B covers 14–22, and C covers 22–24; boundary positions appear on two feeds. Normal gameplay sees the delayed detector reading, not the hidden current position. The consenting judge trace can show current position and danger.

Pause freezes active time. Tutorial does not move or kill the creature, consume finite isolation charges, trigger scares, add work noise, or expire the protocol. Provider requests run independently and cannot pause the simulation.

## Exposure (danger) and work noise

Let `t` be active game seconds, `P` work noise, `U` isolation charges already used, and `E` be one only when source is not manual, quality is accepted, and coarse trend is ELEVATED. Current defaults calculate:

```text
Every correct fault, cable, memory digit, sector mark or routing engage: P += 1.8.
Wrong input of any kind: P += 6 (plus a loud transient).
Machinery noise is the larger of 0.35 per active fault (at most 0.9) and, while powered with a live
research task after the grace period, a 0.45 equipment floor. P += 0.8 × machinery per second while powered.
P cools by 0.6 per second, three times faster while isolated. Correct work and running machines raise P only up to 55; mistakes keep adding to it up to 90, so repeated mistakes take exposure all the way to 100 (base 10 + 90).
Completed research stage: P -= 8.

D = clamp(10 + 25 × clamp(t / 480, 0, 1) + P + 5 × E + 2 × U, 0, 100)
```

The HUD exposure meter shows `D` and these named parts. The movement sampler uses `D`; a higher value increases the chance of approaching but never forces a step or an attack. Rejected, missing, stale or manual physiology contributes zero. SIMULATED accepted elevation can exercise the same fictional difficulty rule and remains visibly labeled. Exposure is a game variable, not a measurement of fear, health or performance. Raw pulse, camera frames and local report history never enter the model or shared trace.

## Step probabilities

Base weights correspond to steps `[-3, -2, -1, 0, +1, +2, +3]`:

```text
w = [0.07, 0.14, 0.23, 0.22, 0.19, 0.10, 0.05]
```

The ordinary bias uses current exposure, the sign of the previous actual step, silence, and a currently valid local director bias `A`:

```text
b = 0.28 - 1.36 × D / 100 + 0.06 × sign(previous step) + A
If no audible evidence for more than 8 seconds (it lost your trail): b += 0.6.
During a seeded hunt: replace b with -0.85.
A is bounded to [-0.15, +0.15] and expires after 8 seconds.

If equipment is isolated: replace b with 0.55 - 0.20 × D / 100.
If an intermediate lure is protected: replace b with 0.85 - 0.10 × D / 100.
If the final containment lure is active: replace b with 1.
Finally clamp b to [-0.85, 1].

negative-step weight = base weight × (1 - b)
zero-step weight     = base weight
positive-step weight = base weight × (1 + b)
probability          = adjusted weight / sum(all adjusted weights)
```

Running equipment is always audible, so the lost-trail bonus only applies while the equipment is off or before the grace period ends. Hunts: one per 60-second period after 45 seconds, at a seeded offset derived from the run seed, lasting 10 seconds. A hunt starts with a `HUNT_STARTED` event, a warning sound at the creature's position and the caption RUNNING FOOTSTEPS — IT IS CHARGING. Isolation and protected lures override hunts, and the 2.5-second warning before a committed attack still applies. Later overrides take precedence: protected lures override isolation, hunts, ordinary exposure bias and model bias. A positive bias favors retreat; a negative bias favors approach. Each movement tick advances the creature's independent seeded RNG once, samples the distribution, applies the selected step, then clamps position to `[0,24]`. Given the same seed and actions, the result is deterministic; frame chunking does not redraw movement. Task RNG draws do not consume the creature's RNG stream.

Illustrative current distributions, with no model bias, lure or isolation and previous step zero, are computed from the same implementation. These describe one draw, not a guaranteed survival time:

| Exposure | Closer | Stationary | Farther | Mean step per tick |
| --- | --- | --- | --- | --- |
| 15 | 39.35% | 22.26% | 38.39% | −0.034 |
| 40 | 52.68% | 21.52% | 25.81% | −0.452 |
| 65 | 65.14% | 20.83% | 14.03% | −0.843 |
| 85 | 74.55% | 20.30% | 5.15% | −1.138 |
| 40, trail lost | 28.53% | 22.86% | 48.61% | +0.305 |

## Limited isolation and earned lures

Standard runs start with three Q charges, and completing each research stage recharges one (never above three). A valid Q consumes one and isolates equipment until the player restores it: the restore window opens after four seconds (hold F for one second), and power returns by itself at 25 seconds. Isolation pauses research, clears current machine/transient clues, cools work noise three times faster and favors outward movement, but the creature lingers, so waiting for its footsteps to fade costs deadline time. It changes only the distribution sampled at the next normal 2.5-second tick; there is no immediate backstep or alternate movement clock. Retreat remains probabilistic. Repeated Q during isolation cannot extend its duration; exhaustion and cooldown produce no extra benefit.

Restoring isolation starts a ten-second relay cooldown. Restoring an unrelated blackout preserves the existing cooldown and never adds or extends one. Each consumed charge permanently adds two to the exposure formula for that run. A committed strike remains committed through Q, F, model responses and attempted lures. With no cell available there is no way to silence running equipment, so spending cells well matters; a blackout is the only other quiet moment.

Emitter A and B reward completed memory stages with twelve seconds of protected outward bias toward positions 20 and 22. They do not teleport the creature or guarantee a particular sampled step. The final signal stays active until resolved, eliminates negative steps, and aims for position 24. After arrival, a three-second seal completes containment. The global eight-minute deadline still applies.

## Research stages and thinking tasks

| Stage | Work |
| --- | --- |
| 1 | Rack sound key, then 6 faults found **by ear** (one at a time, one every 2.2 s); 6 cables; **conduit**, one board |
| 2 | Memory growing 3→5 cues (three rounds); **heartbeat mask**; emitter A transmission |
| 3 | New sound key, then 8 faults by ear (two can sound at once, one every 2 s); 12 cables in two panels; **locate**, three monitor marks |
| 4 | Memory growing 4→6 cues (three rounds); **calm hold**; emitter B transmission |
| Final | Deliberate containment transmission, physical arrival and seal |

- **Faults by ear.** Machine buttons show only 1–4. At the start of each fault stage (and on demand with L) the rack plays each machine's fault sound in turn: low thumping, high whine, fast ticking or electric buzzing, shuffled per stage from the seed. No fault spawns while the key plays. A failing machine then loops its sound from its rack slot; the player presses its number. The panel's YOU HEAR line captions the sounds for deaf players, so the puzzle is remembering which number made which sound. Nothing on screen marks the failing machine; the rack behind you still shakes visibly, a slower visual alternative. A wrong number is a loud mistake.
- **Conduit.** A 4×4 board of straight, corner and tee pipe tiles plus blanks. Clicking rotates a tile a quarter turn (quiet); powered pipe glows from the left inlet. Join the inlet to the right outlet and press T. Every board is built from a random column-by-column path, so it is always solvable, and starts broken. Engaging a broken conduit is a loud mistake. One board.
- **Heartbeat mask.** A false pulse at a seeded 54–90 BPM flashes and ticks with no number shown. Tapping 1 (or the pad) on intervals within ±15% of its period builds a streak; eight lock it. With an accepted ELEVATED trend, ten beats at ±12% are required. Manual, missing or rejected data uses the standard rule. Taps are silent.
- **Locate.** From the security monitor, the player marks the creature's sector with 1–4: near the wall (0–6, off camera), CAM A, B or C. A mark is accepted if it matches the current position or the last detector reading. Marks need six seconds between them. Three are required. The security-monitor panel docks on the right so the CCTV feed stays visible. A wrong mark is a loud mistake.
- **Calm hold.** A pacer alternates four seconds of breathing in (hold B or the ring) and four out (release), with 0.45 s grace at each change. Matched time accrues toward twelve seconds; mismatched time drains it at 0.5/s. An accepted STEADY/RECOVERED trend accrues 1.5× faster, ELEVATED at 0.6×. Without live data it is the pacer alone. Isolation pauses it. The equipment keeps running during it, so the creature keeps coming.

Memory cues are 0.36 seconds on plus 0.14 seconds gap, with a sixteen-second entry window per round. Each matched round adds one cue and replays automatically; a mistake restarts the current round. Replay is free and resets the attempt. Accepted elevated trend can select the existing capped tempo multiplier when playback starts. Isolation/blackout preserves puzzle progress while disabling powered interaction. Wire, routing, pulse and memory answers stay in private local state; public events record only success or `WRONG_INPUT` with a kind.

The exact model proposal schema is unchanged. Local code translates accepted tactics as follows:

| Tactic | Temporary bias |
| --- | --- |
| INVESTIGATE_SOUND | −0.15 |
| CIRCLE_SHELTER | −0.075 |
| LISTEN_NEAR | −0.0375 |
| FOLLOW_LURE / RETREAT | +0.15 |
| WAIT | 0 |
| TAUNT | No change to movement bias |

Only currently allowed pairs and supported evidence pass the local validator. The proposal cannot supply position, movement step, random seed, probability, attack, timer or puzzle answer. Its eight-second response budget does not stop game time. Failed, missing and late providers leave deterministic local behavior active.

## Verification limits

The [sweep](../artifacts/survival-balance.json) runs 30 seeds per policy through the real reducer. Policies know private puzzle answers, solve thinking tasks after a scripted delay, react to the public close-approach caption after a scripted delay, and go silent when no isolation is available. It is **not a human playtest** and does not measure memory, attention, rhythm, drag accuracy, audio perception or camera quality. The elevated policy injects a labeled synthetic accepted trend; it uses no live measurement.

| Automated policy | Pace (fault / cable / digit / close-approach reaction / conduit think) | Wins / 30 | Mean winning time | Alarms per run | Mean seconds between alarms | Isolations per run |
| --- | --- | --- | --- | --- | --- | --- |
| Perfect information | 0.3 s / 0.3 / 0.3 / 0.2 / 1 | 28 | 156 s | 1.2 | 33 | 1.3 |
| Fast | 1 s / 1.2 / 0.45 / 0.8 / 8 | 23 | 207 s | 2.2 | 37 | 2.3 |
| Human-paced, 5% mistakes | 2.2 s / 2.2 / 0.7 / 1.5 / 18 | 13 | 260 s | 3.0 | 45 | 3.0 |
| Slow, 14% mistakes | 3.2 s / 3.4 / 1.0 / 2.5 / 30 | 0 | — | 3.9 | 47 | 3.5 |
| Human-paced, synthetic elevated trend | as human-paced | 5 | 275 s | 3.5 | 40 | 3.2 |

The policies restore isolation as soon as the restore window is open and the creature has moved off (position 12 or more); they know every puzzle answer instantly, so a real first run takes longer than these times.

Every run ended by the deadline. These results establish reachable outcomes, run length and alarm rhythm under the stated artificial policies, not a target human win rate. Earlier live Gemini/ElevenLabs results establish provider text/audio generation and playback, but predate this balance revision. No additional live provider request was run for this balance change. The trace contract remains `lock-in-v2`; it has not been deployed or verified remotely.
