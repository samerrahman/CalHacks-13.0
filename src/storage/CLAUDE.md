# /src/storage and /convex — Samer (Person 1: signals & platform)

Convex is the backend. `src/storage/index.js` runs in the **renderer** and gives the game a `ConvexClient` (or null when `VITE_CONVEX_URL` isn't set, so the game runs offline). `convex/schema.js` is the draft table layout. There are no Convex functions yet.

## Setup (a human runs this once per machine, in a real terminal)
1. `npx convex dev`, then log in and **choose the existing project**. It writes `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL` to `.env.local` and generates `convex/_generated/`. **Commit `_generated`**, since `npx convex codegen` can't run without a deployment, and `npm run check` needs those files once code imports them.
2. Each teammate gets their own dev deployment. For one shared live/judge view, point everyone at one deployment's URL.
3. `convex.json` turns off Convex's "AI files", which would otherwise add text to our `CLAUDE.md`.

## When building functions
- Use plain `.js` files in `convex/`. Import `query`/`mutation`/`action` from `./_generated/server` and refs from `./_generated/api`. File names with two dots are silently skipped.
- Keep the game loop local. Send events in batches with a mutation that dedupes on `(sessionId, sequence)`, because reconnects resend.
- Check the session `token` on every read and write. Never make all events publicly readable.
- Give every handler that calls `ctx.runQuery`/`runMutation` an explicit `returns:` validator. With `strict: false`, circular inference silently turns the API types into `any`.
- Client calls: always pass `onError` to `onUpdate`. Start timeouts **before** awaiting a mutation, because offline mutations queue until reconnect and the game must not wait.
- Actions are never retried. Provider calls (Gemini, Cartesia) stay in the Electron main process, so Convex doesn't need their keys.
- `v.bytes()` takes an `ArrayBuffer` under ~1 MB. Use `ctx.storage` for longer audio.
- The CSP in `index.html` already allows `*.convex.cloud` (https + wss) and `*.convex.site`.
