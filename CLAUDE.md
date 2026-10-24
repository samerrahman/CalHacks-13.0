# LOCK IN — CalHacks 13.0

The root application is LOCK IN: a sealed research shelter, four fault/memory stages, remote heartbeat lures and physical containment. NIGHT RELAY is archived reference material only. The explicit user request authorized the root replacement and required cross-area contract updates.

Read `README.md`, `src/game/config.ts` and `docs/HANDOFF.md` for current behavior and verification. The subsequent user request authorizes harder rules, darker art, equipment interactions, camera setup and live monster speech across ownership areas. The preserved kit GAME_SPEC describes the earlier version; current tuning supersedes its unconditional late-quiet rescue and visible breach warning.

Stack: **TypeScript**, React (menus/HUD), Three.js (scene), Vite, Electron 45 (camera and provider bridge), Gemini (`@google/genai`), ElevenLabs (voice), Presage (`@smartspectra/node-sdk`), SpacetimeDB (consented trace and judge view). `convex/` is historical reference.

## Run

```bash
npm ci                    # only Samer changes dependencies — see Rules
cp .env.example .env.local
npm run dev               # browser game + local provider bridge; manual/simulated sensing
npm run desktop           # build + launch Electron (camera, providers)
npm run check             # typecheck + tests + web and Electron builds — before every merge
npm run integrations:check   # native check by default; explicit --live provider stages use quota
```

## Contracts — change only with team approval

- `src/game/state.ts`: game state, the shape everything reads
- `src/integrations/contracts.ts`: director and speech requests/results, and the public projection sent to providers
- `src/sensing/types.ts`: sensor samples and trend states
- `spacetimedb/src/index.ts`: private session table, reducers, and judge view
- `electron/preload.ts`: the `window.lockIn` bridge
- `public/assets/manifest.json`: every model, sound and decal

## Ownership

| Area | Owner |
|---|---|
| `electron/`, `src/sensing/`, `spacetimedb/`, `src/integrations/client.ts`, `src/integrations/spacetime.ts`, `package.json` | **Samer** (1, signals & platform) |
| `src/game/`, `src/render/`, `src/main.tsx`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tests/`, merging to `main` | **James** (2, gameplay & integrator) |
| `src/ui/`, `src/audio/engine.ts`, `public/assets/`, `docs/ASSETS.md`, `lock-in-kit/assets` + `tools`, opening cutscene (`cutscene/`, `src/cutscene/`, `tools/cutscene.mjs`) | **Lea** (3, art, audio & UI) |
| `src/integrations/providers.ts`, `src/audio/queue.ts`, `lock-in-kit/prompts/`, `docs/DEMO.md`, Devpost | **Lucy** (4, AI, voice & pitch) |
| contracts above, `lock-in-kit/design/` | whole team |

Some folders have their own `CLAUDE.md` with that owner's notes. If you don't know which person you're working for, ask before editing.

## Rules for agents

- **Only edit files you own** (table above). Need something elsewhere? Say what and stop — the owner's agent makes the change.
- **Never change a contract unless the user explicitly asks.** Contract changes go through the team chat first.
- **Never run `npm install <pkg>` or edit `package.json`** unless you are working for Samer.
- **Never run `npx convex dev`, `npx convex env` or `npx convex deploy` yourself.** Without a real terminal, the CLI silently sets up an anonymous local backend. Ask the user.
- Keys live in ignored local environment files and are read only by Node-side loopback Vite middleware or Electron main. Never use a `VITE_*` name for a secret. Local browser providers use the protected `/api/lock-in` bridge; desktop uses `window.lockIn`. Static browser hosting uses local provider fallbacks until a trusted provider service is configured. SpacetimeDB connection settings are public.
- Keep the game deterministic: the reducer owns game time, and rendering and input never wait on a provider call. Every AI proposal is revalidated locally.
- Don't invent integration results. A claim like "live" needs evidence in `docs/qa/`. Simulated sensing must stay labeled as simulated.
- No drive-by refactors, renames or reformatting outside the task.
- Run `npm run check` before saying you're done, and add a line to `notes/<person>.md`.

## Git

- Branches: `samer/signals`, `james/game`, `lea/art-ui`, `lucy/ai-wellness`. Only James merges into `main`. See `docs/TEAM.md`.
- Merge into `main` every 2–3 hours, after `npm run check` passes and `npm run desktop` launches. A broken `main` gets fixed before anything else.
