# /electron — Samer (Person 1: signals & platform)

Main process (`main.ts`), preload bridge (`preload.ts`), Presage binding (`presageAdapter.ts`), the esbuild script, and smoke checks. `liveChecks.ts` is shared with Lucy, since it checks her providers.

- Keep `contextIsolation`, `sandbox` and `nodeIntegration: false`, the `trusted()` sender check on every IPC handler, and the navigation/popup blocks. New IPC goes into `preload.ts` (a team contract) first.
- `.env` and `.env.local` are loaded at startup. Secrets never leave this process except as validated results.
- Presage: never call the SDK's synchronous `stop()`/`waitUntilComplete()` on the main thread, because they can deadlock. Use `await stopAsync()` and then `destroy()`, and still destroy if `start()` throws.
- If Electron exits immediately, unset `ELECTRON_RUN_AS_NODE`. VS Code terminals set it; `npm run desktop` already clears it.
- `npm run native:smoke` loads the Presage runtime without touching the camera. It passes on this Mac (SDK 3.4.0, arm64).
