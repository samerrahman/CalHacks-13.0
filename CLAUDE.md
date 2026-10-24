# SCARY — CalHacks 13.0

A 3D first-person horror game. The webcam (Presage) reads the player's pulse and breathing, a **Gemini** director picks what the creature does next from a fixed menu, **Cartesia** voices the radio, and **Convex** stores sessions and events for replay and a judge view.

> **Design not final.** James's `Night_Relay_Codex_Build_Kit.zip` (repo root) is the most detailed spec so far. The contracts in `/shared/types` and `convex/schema.js` are a v0 draft. Don't build gameplay features until the team confirms the design.

Stack: **JavaScript** (ES modules, no TypeScript source), Electron + Vite + **Three.js**. Types are JSDoc, checked by `tsc` with `checkJs`.

## Run

```bash
npm install            # only Samer changes dependencies — see Rules
cp .env.example .env   # API keys, main process only
npx convex dev         # once, in your own terminal: log in, choose the existing project
npm run providers      # checks each key with read-only calls
npm run dev            # Vite + Electron with hot reload, mock signals on
npm run check          # type check + build — must pass before every merge
```

Without keys or Convex, the app still runs: canned director, subtitles-only voice, offline storage. The overlay shows the Convex status.

Mock signal keys in the app: `1` pulse up · `2` blink · `3` hold breath · `4` talk · `5` fear spike · `0` face lost · `` ` `` toggles the signal overlay.

## Contracts

Every person codes against these. Read the relevant file before writing code that touches another area.

- `shared/types/signals.js` → `SignalFrame` (~10 Hz from the signal bus)
- `shared/types/events.js` → `GameEvent`, `CreatureId`
- `shared/types/director.js` → `DirectorRequest`, `DirectorResponse`, `DIRECTOR_MENU`
- `shared/types/storage.js` → `SessionRecord`, `CheckIn`
- `shared/types/bridge.js` → `window.scary` (renderer ↔ Electron main IPC: director, voice, signals)
- `convex/schema.js` → Convex tables (sessions, events)
- `assets/manifest.json` → every model, sound and decal, by key

Import types with JSDoc: `/** @typedef {import('../../shared/types/signals.js').SignalFrame} SignalFrame */`

## Ownership

| Folder | Owner |
|---|---|
| `/shared/types` | whole team |
| `/electron`, `/src/signals`, `/src/storage`, `/convex`, `convex.json`, `/scripts`, `package.json` | Samer (1, signals & platform) |
| `/src/game`, `/src/main.js`, `index.html`, merging to `main` | James (2, gameplay & integrator) |
| `/assets`, `/src/ui` | Lea (3, art & UI) |
| `/src/ai`, `/src/wellness` | Lucy (4, AI, wellness & pitch) |

Each owned folder has its own `CLAUDE.md` with that person's task. If you don't know which person you're working for, ask before editing.

## Rules for agents

- **Only edit files in your person's folders.** Need something from another folder? Say what and stop — the owner's agent makes the change.
- **Never edit `/shared/types` or `convex/schema.js` unless the user explicitly asks.** Contract changes go through the team chat first.
- **Never run `npm install <pkg>` or edit `package.json`** unless you are working for Samer. Ask the user to request it from Samer.
- **Never run `npx convex dev`, `npx convex env` or `npx convex deploy` yourself.** Without a real terminal, the CLI silently sets up an anonymous local backend instead of the team's project. Ask the user to run it.
- API keys live in `.env` and are read only in the Electron main process. Never put a secret in a `VITE_*` variable or send it to the renderer. In main-process code, read `process.env` inside functions, not at module scope (`.env` loads after imports run).
- The renderer reaches API keys and Presage **only through `window.scary`**, and Convex only through `src/storage`. No Node APIs in the renderer.
- No drive-by refactors, renames or reformatting outside the task.
- Run `npm run check` before saying you're done.
- Add a line or two to `notes/<person>.md` about what you did and why.

## Git

- Branches: `samer/signals`, `james/game`, `lea/art-ui`, `lucy/ai-wellness`. Only James merges into `main`.
- Merge into `main` every 2–3 hours. Before merging: `npm run check` passes and `npm run dev` launches. If `main` breaks, fixing it comes before anything else.
- Commit small and often. Review every diff before committing.
