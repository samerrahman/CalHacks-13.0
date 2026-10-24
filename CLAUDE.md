# SCARY — CalHacks 13.0

A horror game where your body is the controller. The webcam (Presage SDK) reads the player's pulse, breathing, blinks and voice, and the creatures react: the **Listener** hunts by sound and breath, the **Watcher** only moves when you blink, and the **Mimic** talks back. You survive each night at a desk with a lamp, a radio and limited oil. A Claude-powered **director** picks what happens next from a fixed menu, based on how the player is doing. At dawn a **garden** grows from how well you stayed calm, and a **journal** tracks sessions, check-ins and wellness tips. The point is practising calm under stress, so wellness safety rules can override any scare.

> **Design not final.** The game is 3D, but the concept above is a draft. James's `Night_Relay_Codex_Build_Kit.zip` (repo root) is the most detailed spec so far. Don't build gameplay features until the team confirms the design.

Stack: **JavaScript** (ES modules, no TypeScript source), Electron + Vite + **Three.js**, Gemini (director), Cartesia (voice), Convex (backend), Presage (sensing). Types are JSDoc, checked by `tsc` with `checkJs`. Gemini/Cartesia/Convex setup is in progress.

## Run

```bash
npm install        # only Samer changes dependencies — see Rules
cp .env.example .env
npm run dev        # Vite + Electron with hot reload, mock signals on
npm run check      # type check + build — must pass before every merge
```

Mock signal keys in the app: `1` pulse up · `2` blink · `3` hold breath · `4` talk · `5` fear spike · `0` face lost · `` ` `` toggles the signal overlay.

## Contracts — `/shared/types`

Every person codes against these. Read the relevant file before writing code that touches another area.

- `signals.js` → `SignalFrame` (~10 Hz from the signal bus)
- `events.js` → `GameEvent`, `CreatureId`
- `director.js` → `DirectorRequest`, `DirectorResponse`, `DIRECTOR_MENU`
- `storage.js` → `SessionRecord`, `CheckIn`
- `bridge.js` → `window.scary` (renderer ↔ Electron main IPC)

Import types with JSDoc: `/** @typedef {import('../../shared/types/signals.js').SignalFrame} SignalFrame */`

## Ownership

| Folder | Owner | Process |
|---|---|---|
| `/shared/types` | whole team | both |
| `/electron`, `/src/signals`, `/src/storage`, `package.json` | Samer (1, signals & platform) | main + renderer |
| `/src/game`, `/src/main.js`, `index.html`, merging to `main` | James (2, gameplay & integrator) | renderer |
| `/assets`, `/src/ui` | Lea (3, art & UI) | renderer |
| `/src/ai`, `/src/wellness` | Lucy (4, AI, wellness & pitch) | `src/ai/main` = main, rest renderer |

Each owned folder has its own `CLAUDE.md` with that person's task. If you don't know which person you're working for, ask before editing.

## Rules for agents

- **Only edit files in your person's folders.** Need something from another folder? Say what and stop — the owner's agent makes the change.
- **Never edit `/shared/types` unless the user explicitly asks.** Contract changes go through the team chat first.
- **Never run `npm install <pkg>` or edit `package.json`** unless you are working for Samer. Ask the user to request it from Samer.
- No drive-by refactors, renames or reformatting outside the task.
- Renderer code reaches main-process things (API keys, SQLite, Presage) **only through `window.scary`**. No Node APIs in the renderer.
- API keys live in `.env`, read only in the main process. Never commit them or send them to the renderer.
- Run `npm run check` before saying you're done.
- Add a line or two to `notes/<person>.md` about what you did and why.

## Git

- Branches: `samer/signals`, `james/game`, `lea/art-ui`, `lucy/ai-wellness`. Only James merges into `main`.
- Merge into `main` every 2–3 hours. Before merging: `npm run check` passes and `npm run dev` launches. If `main` breaks, fixing it comes before anything else.
- Commit small and often. Review every diff before committing.
