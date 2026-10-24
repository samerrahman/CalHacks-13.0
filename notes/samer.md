# Samer — signals & platform

What my agent did and why. Newest first, one or two lines each.

- Scaffolded repo: Electron + Vite + Phaser 4 in JavaScript, JSDoc contracts in /shared/types, mock signal source + overlay, canned director and in-memory storage behind window.scary, per-folder CLAUDE.md files.
- Switched stack to Three.js + Gemini + Cartesia + Convex: lazy main-process clients (null without keys), `npm run providers` key check, Convex client in src/storage with status on the overlay, convex/schema.js draft, CSP for *.convex.cloud. Storage left the IPC bridge (renderer talks to Convex directly).
