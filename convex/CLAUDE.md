# /convex — Samer (schema, sessions, events, auth, server) · Lucy (director, speech, providerRequests)

Scoped consenting sessions, hashed owner/judge capabilities, ordered event dedupe, provider actions and deletion. `schema.ts` is a team contract.

- `server.ts` gives typed `query`/`mutation`/`action` builders without `convex/_generated`, so `npm run check` works on machines with no deployment. Keep using it.
- **Humans run the CLI, never agents:** `npx convex dev` (log in, choose the existing project) writes `VITE_CONVEX_URL` and `CONVEX_DEPLOYMENT` to `.env.local`. Provider keys for actions go in with `npx convex env set NAME`, which prompts for the value so it stays out of shell history. Each teammate's dev deployment is separate, so point the judge view at one shared deployment.
- `convex.json` turns off Convex's "AI files", which would otherwise edit our `CLAUDE.md`.
- Check the capability in every public function. Dedupe events on session + sequence, because reconnects resend. Actions are never auto-retried.
- Keys and payloads must stay small and plain: field names can't start with `$` or `_`, and a document is limited to 1 MiB.
