# /electron — Samer (Person 1: signals & platform)

Electron main process (`main.js`) and the preload bridge (`preload.js`). Main is the composition root: it calls `registerAiIpc` (Lucy) and `registerStorageIpc` (Samer).

- `preload.js` must implement exactly `ScaryBridge` from `shared/types/bridge.js`. New channels go into that contract first.
- The window keeps `contextIsolation` on and `nodeIntegration` off (the defaults). Don't change them.
- Camera access: on macOS ask with `systemPreferences.askForMediaAccess('camera')` before starting Presage.
- `.env` is loaded here with `process.loadEnvFile()`. Keys stay in the main process.
- You own `package.json`. Other people's agents ask for libraries instead of installing them.
