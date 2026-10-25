# Webcam idea: Freeze

**Pitch.** When the creature reaches the wall, it stops and listens. The webcam watches you: if you move, it hears you. Hold perfectly still, with your heart pounding, until its footsteps fade.

## Why it fits HUSH

- **It uses the camera that is already on.** Presage needs the player's face in frame, so Freeze adds no new device and no new permission.
- **It works with the pulse mechanic.** Presage itself rejects readings during motion (validation warnings), so holding still also keeps the heart-rate input accepted. But a racing heart is exactly what makes holding still hard, and an ELEVATED trend already makes the heartbeat mask and calm hold harder. Fear works against you twice.
- **It turns the near state into something you do with your body.** Today the near state (`alarmLatched`, line position ≤ 7) is heard as footsteps and handled with Q. Freeze adds a second, physical answer: stay still and let it pass, or move and pay for it.
- **It is good to watch.** A spectator sees the player go rigid while the BPM number climbs.

## Proposed rule (not implemented in the game)

1. While the near state is latched and equipment is quiet or off, the HUD shows only `HOLD STILL` (no meter or countdown, matching the no-breach-countdown rule).
2. Each 2.5-second movement tick, if the stillness meter read MOVING at any point since the last tick, add the same transient and pressure a wrong input adds (`config.tasks.mistakeStrength` and `config.danger.mistakePressure`). It never kills the player directly and never moves the creature by itself; it only feeds the existing exposure → movement probabilities.
3. Without a camera (manual, simulated or rejected input), Freeze is off and the standard rules apply, so every run stays playable without a webcam.
4. Accessibility: a "Freeze off" setting next to Softer scares; reduced-motion players are not penalized for small tremors (thresholds below).

## Privacy

Frames are reduced to a 32×24 brightness grid in memory, compared with the previous grid and discarded. Only a coarse STILL or MOVING label would reach game state. Nothing goes to a provider, the trace or spectators. This is the same boundary as the pulse trend.

## Prototype (this branch)

- `src/sensing/motion.ts`: `MotionMeter`, a frame-difference stillness meter. It subtracts each frame's mean brightness so auto-exposure and lamp flicker don't count, ignores per-pixel changes under a noise floor, smooths with an exponential average, and uses hysteresis (STILL below 0.08, MOVING above 0.16) so the label doesn't flicker.
- `src/sensing/motion.test.ts`: still scenes with sensor noise stay STILL, a moving face block reads MOVING, and a whole-frame exposure jump doesn't.
- `src/sensing/prototype/freeze.html`: a dev-only page. With `npm run dev` running, open `http://127.0.0.1:5173/src/sensing/prototype/freeze.html`, start the camera, press "It's at the wall", and try to hold still for six seconds. It opens its own camera stream for the prototype only. The in-game version must read frames from the existing Presage capture stream instead (sensing rule: no second stream).

The thresholds were tuned on synthetic frames only. **They have not been checked against a real webcam session**, so expect to retune `stillBelow`/`movingAbove` after trying it.

## Contract changes needed to ship it (not made)

- `src/sensing/types.ts`: add `stillness: 'STILL' | 'MOVING' | 'UNKNOWN'` to `SensorView`.
- `src/game/state.ts`: a `{ type: 'stillness', value }` action, or a field the reducer reads each tick, like the trend.
- `src/game/` (James): the noise rule above plus tests; `src/ui/` (Lea): the HOLD STILL cue.
