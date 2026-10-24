# /electron — Samer (Person 1: signals & platform)

Electron main process (`main.js`) and the preload bridge (`preload.js`). Main is the composition root: it loads `.env` and calls `registerAiIpc` (Lucy).

- `preload.js` must implement exactly `ScaryBridge` from `shared/types/bridge.js`. New channels go into that contract first.
- The window keeps `contextIsolation` on and `nodeIntegration` off (the defaults). Don't change them.
- `process.loadEnvFile()` reads only `.env` from the working directory, and it runs **after** every import is evaluated. Main-process modules must read `process.env` inside functions.
- Presage runs here (see `src/signals/CLAUDE.md`): the SDK stays in main, and only small decoded numbers go to the renderer over `IPC.signalFrame`.
- macOS camera: call `systemPreferences.askForMediaAccess('camera')` before starting capture.
- If Electron exits immediately in a VS Code terminal, unset `ELECTRON_RUN_AS_NODE` (`env -u ELECTRON_RUN_AS_NODE npm run dev`).
- You own `package.json`. Other people's agents ask for libraries instead of installing them.
