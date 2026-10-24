# /src/game — James (Person 2: gameplay & integrator)

The Phaser 4 game: night scenes, creature behavior, lamp/radio/oil resources, death replay and the dawn garden. You also own `src/main.js` and `index.html`, and you're the only one who merges into `main`.

## Inputs
- Body: `signalBus.latest()` each frame, or `signalBus.subscribe()` for blinks (`src/signals`). Never read the camera directly.
- Director: `await window.scary.director.decide(request)` returns a `DirectorResponse`. Send only events that are legal right now in `request.menu`. Never block the game loop on it.
- Art: load everything through `this.load.pack('main', 'asset-pack.json')` (Lea's file in `/assets`). Use asset keys, not file paths.
- Record what happens as `GameEvent`s (`shared/types/events.js`) and save a `SessionRecord` at the end through `window.scary.storage`.

## Milestones
- **Friday night:** desk scene shows (placeholder in `scenes/DeskScene.js`).
- **Saturday 10 AM:** Night 1 playable end to end with mock signals, plus the calibration intro.
- **Saturday 4 PM:** real signals drive the Listener and the Watcher, plus death replay (the signal trace leading up to the death), the dawn garden and a live director.
- **Saturday 10 PM:** feature freeze. Add the Mimic and breath-hold only if the core is solid.

## Constraints
- Mock keys 0–5 and `` ` `` belong to the signal tools. Don't bind them.
- The game must stay playable with `faceDetected: false` (no-camera fallback).
- Before every merge to `main`: `npm run check` passes and `npm run dev` launches.
