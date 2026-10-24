# SCARY — CalHacks 13.0

A 3D biometric horror game: the player's pulse and breathing (read by webcam through Presage) shape what the creature does, and a Gemini director chooses what happens next. The design isn't final yet; `Night_Relay_Codex_Build_Kit.zip` holds James's detailed spec.

JavaScript · Electron · Vite · Three.js · Presage · Gemini · Cartesia · Convex

## Team

| # | Person | Role | Owns | Branch |
|---|---|---|---|---|
| 1 | **Samer** | Signals & platform | `/electron`, `/src/signals`, `/src/storage`, `package.json` | `samer/signals` |
| 2 | **James** | Gameplay & **integrator** | `/src/game`, `src/main.js`, `index.html`, merges to `main` | `james/game` |
| 3 | **Lea** | Art & UI | `/assets`, `/src/ui` | `lea/art-ui` |
| 4 | **Lucy** | AI, wellness & pitch | `/src/ai`, `/src/wellness`, Devpost, demo video | `lucy/ai-wellness` |

`/shared/types` belongs to everyone. Changes need agreement in the team chat first.

## Setup

```bash
git clone https://github.com/samerrahman/CalHacks-13.0.git
cd CalHacks-13.0
npm install
cp .env.example .env     # add API keys (Lucy/Samer)
git switch <your-branch>
npm run dev
```

Running several agents on one machine? Give each one its own worktree so they never share a checkout:

```bash
git worktree add ../scary-game james/game
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite + Electron with hot reload, mock signals |
| `npm run typecheck` | `tsc` checks the JavaScript against the JSDoc contracts |
| `npm run check` | type check + production build. **Run before every merge** |

In the app: `1` pulse up · `2` blink · `3` hold breath · `4` talk · `5` fear spike · `0` face lost · `` ` `` toggle overlay.

## How we work

- **Folder ownership:** your agent edits only your folders. See `CLAUDE.md` (root and per folder).
- **Contracts first:** code against `/shared/types`. Never change it without the team.
- **Mocks first:** mock signals (done), canned director (done), placeholder art with final file names (Lea, hour 1), recorded Presage sessions (Samer, about hour 5).
- **Dependencies:** only Samer edits `package.json`. Ask in chat.
- **Merging:** push your branch, then James merges into `main` every 2–3 hours after `npm run check` passes and `npm run dev` launches. A broken `main` gets fixed before anything else.
- **Review every diff** your agent makes before committing.
- **Notes:** keep `notes/<you>.md` updated with what your agent did and why. It feeds the Devpost and judges' questions, and sketches done in Notability count toward that prize.
- If an agent goes in circles for 20 minutes, stop it and restart with a smaller prompt.
- Sleep in pairs so `main` always has an awake owner.

## Schedule (10-minute standup at each check-in)

| When | Goal |
|---|---|
| **Fri night** | Contracts, scaffold, mock signals ✅ · art style locked · desk scene shows ✅ |
| **Midnight** | Real Presage pulse in the app · Listener works on mock signals |
| **Sat 10 AM** | Night 1 playable end to end on mocks · calibration intro · first real art |
| **Sat 4 PM** | Real signals drive the Listener and Watcher · death replay · dawn garden · live director |
| **Sat 10 PM** | **Feature freeze.** Mimic and breath-hold only if the core is solid · journal with labeled sample data · Devpost draft |
| **Sun 6 AM** | Polish · test the demo flow · record the video · test the no-camera fallback |
| **Sun 9 AM** | **Submission deadline** |
