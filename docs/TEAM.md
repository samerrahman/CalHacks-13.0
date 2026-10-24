# Team workflow

| # | Person | Role | Owns | Branch |
|---|---|---|---|---|
| 1 | **Samer** | Signals & platform | `electron/`, `src/sensing/`, Convex sessions/events/auth, `src/integrations/client.ts`, `package.json` | `samer/signals` |
| 2 | **James** | Gameplay & **integrator** | `src/game/`, `src/render/`, `src/main.tsx`, `index.html`, build config, `tests/`, merges to `main` | `james/game` |
| 3 | **Lea** | Art, audio & UI | `src/ui/`, `src/audio/engine.ts`, `public/assets/`, `docs/ASSETS.md` | `lea/art-ui` |
| 4 | **Lucy** | AI, voice & pitch | `src/integrations/providers.ts`, Convex director/speech/providerRequests, `src/audio/queue.ts`, prompts, `docs/DEMO.md`, Devpost, demo video | `lucy/ai-wellness` |

The contracts in the root `CLAUDE.md` belong to everyone. Change them only after agreeing in the team chat.

## Setup

```bash
git clone https://github.com/samerrahman/CalHacks-13.0.git
cd CalHacks-13.0
npm ci
cp .env.example .env.local   # your keys; never commit
git switch <your-branch>
npm run dev                  # or: npm run desktop
```

Convex, once per machine, in your own terminal (not through an agent): `npx convex dev`, log in, choose the existing project.

Running several agents on one machine? Give each one its own worktree: `git worktree add ../night-relay-game james/game`.

## How we work

- **Ownership:** your agent edits only your files. Ask the owner for anything else.
- **Dependencies:** only Samer edits `package.json`. Ask in chat.
- **Merging:** push your branch. James merges into `main` every 2–3 hours, after `npm run check` passes and `npm run desktop` launches. A broken `main` gets fixed before anything else.
- **Evidence:** a live claim needs proof in `docs/qa/` (see `docs/INTEGRATION_STATUS.md`). Keep simulated data labeled.
- **Review every diff** your agent makes before committing.
- **Notes:** keep `notes/<you>.md` updated with what your agent did and why. It feeds the Devpost and judges' questions.
- If an agent goes in circles for 20 minutes, stop it and restart with a smaller prompt. Sleep in pairs so `main` always has an awake owner.

## Open gates (from `docs/HANDOFF.md`)

| Gate | Owner | Status |
|---|---|---|
| Gemini live director | Lucy | ✅ live-tested in Electron (`gemini-3.5-flash-lite`) |
| ElevenLabs generated voice line in game | Lucy | ⏳ implemented; needs key, voice and model |
| Presage live pulse + calibration on the demo laptop | Samer | ⏳ needs `PRESAGE_API_KEY`; native load ✅ |
| Convex deployment + live judge view | Samer | ⏳ needs `npx convex dev` + provider env |
| Two-minute demo rehearsal + video | Lucy, all | ⏳ |

## Schedule (10-minute standup at each check-in)

| When | Goal |
|---|---|
| **Fri night** | Repo merged ✅ · offline game playable ✅ · keys collected |
| **Midnight** | Real Presage pulse in Electron · ElevenLabs key and voice in |
| **Sat 10 AM** | Convex deployment + judge view live · generated voice line live |
| **Sat 4 PM** | Presage trend drives a director choice · playtests by someone new |
| **Sat 10 PM** | **Feature freeze** · Devpost draft |
| **Sun 6 AM** | Polish · rehearse the demo · record the video · test camera-loss fallback |
| **Sun 9 AM** | **Submission deadline** |
