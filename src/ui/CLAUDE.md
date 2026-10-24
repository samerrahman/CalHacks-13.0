# /src/ui — Lea (Person 3: art & UI)

Menus, title and setup screens, HUD, subtitles, and the journal or judge views. They're plain JS/DOM layered over the Three.js canvas. Agree with James before adding a UI framework; Samer installs it.

- UI never touches scene objects directly. It reads game state that James exposes and calls functions exported from `src/game`.
- Session and event data come from `src/storage` (Convex). Records with `isSample: true` must be **visibly labeled as sample data**.
- Every spoken line needs a subtitle. Never signal true or false information by color alone.
- Wellness tips and their copy come from `/src/wellness` (Lucy). Don't write tip text here.
- Art comes from `/assets` via the manifest.
- Anything the game must call (e.g. `showPause()`) gets exported from `src/ui/index.js`. Tell James the function name.
