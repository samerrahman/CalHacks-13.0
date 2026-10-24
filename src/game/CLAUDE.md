# /src/game — James (Person 2: gameplay & integrator)

The Three.js game: scene, stations, creature behavior, resources, win/loss. You also own `src/main.js` and `index.html`, and you're the only one who merges into `main`.

`index.js` is a placeholder booth made of primitives. Don't build gameplay until the team settles the design (James's Night Relay kit is the current reference).

## Inputs
- Body: `signalBus.latest()` in the render loop, or `signalBus.subscribe()` for discrete events (`src/signals`). Never read the camera directly.
- Director: `await window.scary.director.decide(request)` returns a `DirectorResponse`. Only offer events that are legal right now in `request.menu`. Never block the render loop or input on it.
- Art and audio: load through `assets/manifest.json` (Lea's file) by key, not by file path.
- Events and sessions: record what happens as `GameEvent`s and persist them through `src/storage` (Convex). Never block the game on the network.

## Three.js conventions
- `import * as THREE from 'three'`. Loaders come from addons: `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'`.
- Units are meters and Y is up, matching the kit's models.
- Drive animation clips with `AnimationMixer`. Keep simulation state in plain JS, separate from scene objects, so it stays deterministic and testable.
- On restart, dispose geometries, materials, textures, mixers, listeners and timers. Leaked loops are the usual restart bug.
- Clone a material before changing one instance's color.

## Constraints
- Mock keys 0–5 and `` ` `` belong to the signal tools. Don't bind them.
- The game must stay playable with `faceDetected: false` (the no-camera fallback).
- Before every merge to `main`: `npm run check` passes and `npm run dev` launches.
