# /src/ui — Lea (Person 3: art & UI)

Title screens and the journal dashboard, as plain JS/DOM (or Phaser scenes that James mounts — agree on which with him first).

- Journal data comes only from `window.scary.storage.listSessions()` and `listCheckIns()` (`shared/types/storage.js`).
- Records with `isSample: true` must be **visibly labeled as sample data**.
- Wellness tips and their copy come from `/src/wellness` (Lucy). Don't write tip text here.
- Art comes from `/assets` by asset key or URL. Don't import images from somewhere else.
- Anything the game must call (e.g. `showJournal()`) gets exported from `src/ui/index.js`. Tell James the function name.
