# /src/ui, /src/audio/engine.ts, /public/assets — Lea (Person 3: art, audio & UI)

React menus, setup, HUD, pause and judge view (`style.css`, `icons.tsx`). The audio engine handles positional effects, master volume, mute and the radio filter. Assets: 8 GLBs, 9 WAVs and 5 SVG decals in `public/assets/`, listed in `manifest.json` (a team contract). Every entry has a path, byte count and `sha256`, so update all three when art changes. `docs/ASSETS.md` records provenance, licenses and how each asset is used at runtime; keep it current.

- React handles menus and overlays only. The Three.js scene is not re-rendered by React.
- Every spoken line has an exact caption, and normal captions say RADIO for both Mara and the fake. Never signal true or false information by color alone. Keep reduced motion, master volume and mute working.
- Models are GLB, in meters, Y up. The game looks up node and clip names (`shutter_leaf`, `idle`/`listen`/`reach`), so don't rename them. Add new keys to the manifest instead of renaming existing ones.
- The look comes from the spec: dirty teal steel, warm desk light, muted cream labels, restrained orange warnings. No full-screen flashes.
- The speech queue (`src/audio/queue.ts`) is Lucy's.
