# /src/game and /src/render — James (Person 2: gameplay & integrator)

`game/` is the deterministic simulation: reducer, tasks, creature graph, encounters, order verification and director-proposal validation. `render/` is Three.js: GLB loading, scene, stations, clips, mouse look and teardown. You also own `src/main.tsx`, `index.html`, `vite.config.ts`, `tsconfig.json` and `tests/`, and you're the only one who merges into `main`.

- One fixed timestep owns game time. Rendering, input and React never await a provider, and no provider can change rules, timings or secrets.
- Keep the fairness invariants from `night-relay-kit/design/GAME_SPEC.md`: camping can't win, every fake has a reachable tell, warnings and safe windows are guaranteed, and there's at most one physical encounter.
- `state.ts` is a team contract.
- Tests: `npm test` covers rules and integrations (wins across six seeds). `npm run test:browser` runs Playwright playthroughs. Add a test with every rule change.
- On restart and unmount, dispose renderers, mixers, sounds, timers and subscriptions. Duplicate loops after restart are the classic bug.
