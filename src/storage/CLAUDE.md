# /src/storage — Samer (Person 1: signals & platform)

Runs in the Electron **main** process. It saves `SessionRecord` and `CheckIn` (see `shared/types/storage.js`) behind the IPC handlers in `index.js`.

- Today it's an in-memory Map. Replace it with SQLite (a file in `app.getPath('userData')`) and keep the same handlers, so the journal UI doesn't change.
- A native module like `better-sqlite3` needs a rebuild against Electron. Try `node:sqlite` first if Electron's Node version has it.
- Keep a way to load labeled sample data (`isSample: true`) for the journal demo. Lucy writes the sample content.
