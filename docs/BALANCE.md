# LOCK IN balance and movement

The current implementation is authoritative: [`config.ts`](../src/game/config.ts), [`creature.ts`](../src/game/creature.ts), [`tasks.ts`](../src/game/tasks.ts), and [`directorValidation.ts`](../src/game/directorValidation.ts). Gameplay tuning lives in the runtime configuration, including movement weights, bias coefficients, detector cadence, danger contributions, isolation and lure durations. The archived build kits describe earlier designs and remain unchanged.

## Local position and time

| Parameter | Current default |
| --- | --- |
| Creature line | Integer 0–24; 0 is the shelter wall, 24 is containment |
| Starting position | 18 |
| Opening grace | 25 active seconds; no movement, scares, contextual taunts or threatening director choices |
| Step cadence | Every 2.5 seconds; first scheduled step at 27.5 seconds |
| Possible step | −3, −2, −1, 0, +1, +2, +3; negative is closer |
| Distance detector | Samples every 4 seconds while powered; immediately unavailable when power is off |
| Alarm | Latches at position ≤7; clears at ≥10 |
| Committed attack | Position ≤1, at least 2.5 seconds since alarm activation, and fresh audible evidence; then an irreversible 2.4-second windup |
| Protocol deadline | 300 active seconds, including final containment arrival/seal |

The authoritative position is dimensionless. Scene coordinates, camera visibility, footsteps, alarm and spatial creature voice derive from it. They do not simulate a second creature. Camera A covers positions 7–14, B covers 14–22, and C covers 22–24; the upper A/B bounds are exclusive. Normal gameplay sees the delayed detector reading, not the hidden current position. The consenting judge trace can show current position and danger.

Pause freezes active time. Tutorial does not move or kill the creature, consume finite isolation charges, trigger scares, or expire the protocol. Provider requests run independently and cannot pause the simulation.

## Danger and mistake pressure

Let `t` be active game seconds, `P` mistake pressure, `U` isolation charges already used, and `E` be one only when source is not manual, quality is accepted, and coarse trend is ELEVATED. Current defaults calculate:

```text
P decays by 0.08 per active second, bounded to [0, 30].
Wrong fault, memory or wire input: P += 6, at most 30.
Correct fault or wire connection: P -= 1.25, at least 0.
Completed research stage: P -= 4, at least 0.

D = clamp(18 + 42 × clamp(t / 300, 0, 1) + P + 8 × E + 4 × U, 0, 100)
```

The movement sampler uses `D`. A higher value increases the chance of approaching; it does not force a step or an attack. Rejected, missing, stale or manual physiology contributes zero. SIMULATED accepted elevation can exercise the same fictional difficulty rule and remains visibly labeled. Danger is a game variable, not a measurement of fear, health or performance. Raw pulse, camera frames and local report history never enter the model or shared trace.

## Step probabilities

Base weights correspond to steps `[-3, -2, -1, 0, +1, +2, +3]`:

```text
w = [0.07, 0.14, 0.23, 0.22, 0.19, 0.10, 0.05]
```

The ordinary bias uses the current danger, the sign of the previous actual step, and a currently valid local director bias `A`:

```text
b = -0.32 - 0.80 × D / 100 + 0.06 × sign(previous step) + A
A is bounded to [-0.15, +0.15] and expires after 8 seconds.

If equipment is isolated: replace b with 0.90 - 0.20 × D / 100.
If an intermediate lure is protected: replace b with 0.85 - 0.10 × D / 100.
If the final containment lure is active: replace b with 1.
Finally clamp b to [-0.85, 1].

negative-step weight = base weight × (1 - b)
zero-step weight     = base weight
positive-step weight = base weight × (1 + b)
probability          = adjusted weight / sum(all adjusted weights)
```

Later overrides take precedence: protected lures override isolation, ordinary danger bias and model bias. At final-lure bias 1, negative-step weights are zero. A positive bias favors retreat; a negative bias favors approach. These coefficients change normalized weights, not percentage points directly.

Each movement tick advances the creature's independent seeded RNG once, samples the distribution, applies the selected step, then clamps position to `[0,24]`. Near a boundary, the actual logged displacement can be smaller than the sampled step. Given the same seed and actions, the result is deterministic; frame chunking does not redraw movement. Task/wire RNG draws do not consume the creature's RNG stream.

Illustrative current distributions, with no model bias, lure or isolation and previous step zero, are computed from the same implementation. These describe one draw, not a guaranteed survival time:

| Danger | Closer | Stationary | Farther | Mean step per tick |
| --- | --- | --- | --- | --- |
| 18 | 61.56% | 21.02% | 17.42% | −0.731 |
| 50 | 70.60% | 20.52% | 8.88% | −1.014 |
| 80 | 75.02% | 20.28% | 4.70% | −1.153 |

## Limited isolation and earned lures

Standard runs have four Q charges. A valid Q consumes one, isolates equipment for ten seconds, pauses research, clears current machine/transient clues and favors outward movement. It changes only the distribution sampled at the next normal 2.5-second tick; there is no immediate backstep or alternate movement clock. Retreat remains probabilistic. Q at a far position still consumes its charge. Repeated Q during isolation cannot extend its duration; exhaustion and cooldown produce no extra benefit.

A manual restore window opens after eight seconds, with the existing one-second hold. Otherwise restoration is automatic at ten seconds. Restoring isolation starts a ten-second relay cooldown. Restoring an unrelated blackout preserves the existing cooldown and never adds or extends one. Each consumed charge permanently adds four to the danger formula for that run, so repeated shutdown is not an unlimited solution. A committed strike remains committed through Q, F, model responses and attempted lures.

Emitter A and B reward completed memory tasks with twelve seconds of protected outward bias toward positions 20 and 22. They do not teleport the creature or guarantee a particular sampled step. The final signal stays active until resolved, eliminates negative steps, and aims for position 24. After arrival, a three-second seal completes containment. The global five-minute deadline still applies.

## Research and director limits

| Stage | Work |
| --- | --- |
| 1 | Eight faults, at most two active; then four matched wire connections |
| 2 | Five memory inputs, then deliberate emitter A transmission |
| 3 | Twelve faults, at most three active; then a new four-wire board |
| 4 | Six memory inputs, then deliberate emitter B transmission |
| Final | Deliberate containment transmission, physical arrival and seal |

Memory cues are 0.42 seconds on plus 0.16 seconds gap, with a sixteen-second entry window. Replay is free and resets the attempt. Accepted elevated trend can select the existing capped tempo multiplier when playback starts; it never changes an in-progress presentation. Fixed-tempo accessibility preserves normal timing. Isolation/blackout preserves puzzle progress while disabling powered interaction. Wire success emits no colors, endpoints or solution into public events.

The exact model proposal schema is unchanged. Local code translates accepted tactics as follows:

| Tactic | Temporary bias |
| --- | --- |
| INVESTIGATE_SOUND | −0.15 |
| CIRCLE_SHELTER | −0.075 |
| LISTEN_NEAR | −0.0375 |
| FOLLOW_LURE / RETREAT | +0.15 |
| WAIT | 0 |
| TAUNT | No change to movement bias |

Only currently allowed pairs and supported evidence pass the local validator. The proposal cannot supply position, movement step, random seed, probability, attack, timer or puzzle answer. Its eight-second response budget does not stop game time. Failed, missing and late providers leave deterministic local behavior active. Generated creature dialogue is a separate bounded text-and-speech pipeline and has no game-rule authority.

## Verification limits

Probability, resource, deadline, grace, privacy and seeded-play tests run offline. The [500-run sweep](../artifacts/survival-balance.json) uses 100 seeds per policy, perfect knowledge of private puzzle answers, and immediate defense when the public alarm sounds. It is **not a human playtest** and does not measure memory, attention, drag accuracy, audio perception or camera quality. The elevated policy injects a labeled synthetic accepted trend; it uses no live measurement.

| Automated policy | Wins / 100 | Mean winning time | Mean isolation charges, all runs | Runs with near encounter |
| --- | --- | --- | --- | --- |
| Fast, perfect information | 100 | 57.03 s | 0 | 0 |
| Medium, perfect information | 91 | 124.95 s | 1.13 | 64 |
| Medium, two fault mistakes | 84 | 134.46 s | 1.41 | 73 |
| Slow, error prone | 10 | 214.50 s | 3.25 | 100 |
| Medium, two mistakes, synthetic elevated trend | 79 | 135.72 s | 1.55 | 79 |

The longest successful simulated run was 235.5 seconds; every run ended by 300 seconds. This table uses the final tick-only Q rule and 0.90 retreat bias, including the blackout cooldown correction. These results establish reachable outcomes and meaningful pressure under the stated artificial policies, not a target human win rate. Earlier live Gemini/ElevenLabs results establish provider text/audio generation and playback, but predate this number-line balance revision. No additional live provider request was run for this balance change. The updated Convex trace contract is `lock-in-v2`; it has not been deployed or verified remotely.
