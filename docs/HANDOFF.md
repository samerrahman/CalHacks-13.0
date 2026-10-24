# LOCK IN implementation handoff

LOCK IN replaces the root application. Both `npm run dev` and `npm run desktop` launch the new game. The original design kits and ZIPs are preserved. Existing local credentials were not overwritten.

Implemented: sealed 3D shelter, one logical creature, four research stages, final physical containment, early audible proximity alarm, irreversible attack commitment, early Q/retreat/F response, guaranteed remote lure routes, preserved puzzles during blackouts, sedation escalation, seven-step arrow tutorial, click-to-use equipment interfaces, five/six-pulse exercises, rusted near-black room, jump scares, authored captions, positional mono audio, reduced motion/scare options, seeded replay, pause and cleanup, optional camera preview/device selection and quality-gated sensing, local pulse reports, and sanitized judge sharing.

Verification: `npm run check` passes97 implementation tests, TypeScript, web production build and Electron build. `npm run assets:validate` verifies54 hashes,10GLBs/209meshes/11clips,27mono WAVs,4CCTV PNGs and7SVGs. All31kit reference tests pass. `git diff --check` is clean. The current integration status is in [INTEGRATION_STATUS.md](INTEGRATION_STATUS.md), and raw sanitized service checks are in [integration-checks.json](integration-checks.json). Files without `lock-in` in historical QA/artifact folders may describe the previous game; they are not evidence for this replacement.

The shared workspace was inspected on macOS14.2.1 Apple Silicon with Node22.23.3. The native SDK imports. The browser connection provided by the app failed before navigation with a runtime configuration error, so rendered tests use installed Chrome via Playwright. No hidden game-state injection is used for complete UI runs.

Current unit checks verify six expert winning seeds, slower defensive play, late-Q committed losses, fixed-step determinism, bounds/protections under hostile model proposals, memory persistence, capture quality/time and stale handling, report consent/source/gaps/pauses/overlap/recovery, provider contracts/caching, actual GLB animation clips, truthful CCTV projection and spatial audio routing.

Desktop is a local development build; packaging, signing and notarization are not claimed. No public deployment or new paid resource was created. The optional native measurement path depends on actual capture quality and account access. Browser mode does not contain a webcam pulse estimator.


## Actual rendered checks

- [Harder seed17 tutorial and win](../artifacts/harder-seed17-evidence.json): all seven tutorial steps, observed4/5/6 memory cues, explicit equipment use, two early-Q defenses and all four research stages through physical containment at84 displayed seconds. Zero browser errors or missing resources.
- [Harder seed18 defensive win](../artifacts/harder-seed18-evidence.json):5/6-input memory, three solver early-Q defenses plus initial calibration isolation, two visible blackouts, all research stages and physical containment. The opt-in report explicitly labels simulated72baseline/84peak data, preserves gaps and clears statistics on deletion. Zero browser errors or missing resources. Simulated pulse is never real physiology.
- [Harder late-Q loss](../artifacts/harder-loss-evidence.json): actual commitment at7.1game seconds, Q afterward fails to interrupt it, pause freezes public event times, actual creature jump scare precedes results, and replay resets research. Zero errors, missing resources or external requests. [Active alarm](../artifacts/harder-alarm-active.png) and [active breach scare](../artifacts/harder-breach-scare-active.png) were visually inspected. There is no advance breach banner/countdown.
- [Offline Electron](qa/lock-in-electron-smoke.json): all10models and27sounds load, local second screen receives sanitized trace, judge has no privileged bridge, both windows use context isolation and sandbox without Node integration.

Screenshots inspected: darker setup/room, equipment inspection, mobile terminal, fictional CCTV, pause, containment win, active proximity alarm, breach jump scare, loss, desktop camera-off setup and simulated pulse graph. Essential controls remain DOM/keyboard accessible. Browser tests use visible controls and visible memory pulses, never hidden state injection. Mobile is a compact fallback layout; desktop/laptop is the intended platform.

The build emits nonfatal future native Vite-config import notices and a large JavaScript chunk warning for the Three.js client. It does not affect the passing build; offline assets are local. No installer or human listening assessment of speaker quality is claimed by an automated Web Audio start check.


## Live results and exact blockers

- Gemini3.5Flash-Lite: real structured probe accepted in711ms; actual game accepted WAIT→NONE with public evidencee8 in928ms after ordinary Q/retreat/F controls. The model changes real bounded behavior; core tests separately cover every movement tactic. Evidence: `qa/lock-in-gemini-alternate.json` and `qa/lock-in-electron-live-providers-alternate.json`.
- Gemini3.8Flash remains the user’s saved configuration; lookup succeeds but generation exceeds the8second deadline. No environment file was overwritten. Launch with `GEMINI_MODEL=gemini-3.5-flash-lite npm run desktop` to use the tested model without editing secrets.
- ElevenLabs newly retested in the harder browser game: the actual FIRST_APPROACH monster line generated in185ms; BEYOND THE WALL caption, two decoded/started utterances, running AudioContext and zero playback errors. Evidence: [live game](qa/local-api-monster-browser.json) and [inspected screenshot](qa/local-api-monster-browser.png). A separate API probe passed in436ms. No human assessment of perceived sound is claimed.
- Presage: explicit user-approved capture attempted; actual getUserMedia returned CAMERA_NOT_FOUND and macOS camera inventory contained zero devices. Baseline accepted0seconds; capture was stopped through the UI. Connect/enable a webcam, then select Live webcam in desktop setup to complete the hardware gate. No live pulse/baseline/effect claim is made.
- Convex: supplied deployment is reachable but public `sessions:version` is missing (FUNCTIONS_NOT_PROVISIONED). No session or backend was created. Current function code is ready in `convex/`; the repository’s human-only provisioning rule requires running `npx convex dev` in the user’s own terminal and choosing the existing development project. After provisioning, rerun `npm run integrations:check -- --only=convex --live`. Remote subscription/reconnect/delete remain unverified; offline second-screen sharing passes.

- [Current layout/accessibility check](../artifacts/harder-layout-evidence.json): mobile390×844 and laptop1280×720 controls/captions fit, Q exits inspection, camera-device SELECT-focused Escape closes settings, judge-checkbox Escape pauses, and B/C feeds plus isolation require explicit use. Zero errors or missing resources.

Final cleanup regressions also verify immediate UNKNOWN before deferred native teardown, newer-start ownership of overlapping sensor commands, and owner-only deletion after session expiry (all ordinary expired access remains denied).

The harder-version physical interaction smoke verifies real terminal and security-monitor mesh clicks, no persistent task sidebar, native-only camera setup guidance, and readable1280×720 pause/equipment layouts. Evidence: [interaction checks](../artifacts/harder-visual-evidence.json), [room](../artifacts/harder-room.png), [terminal](../artifacts/harder-terminal.png), [camera setup](../artifacts/harder-camera-setup.png). [Generated breach image provenance](qa/breach-art-provenance.md) includes the exact prompt and method.

Camera cleanup now covers hidden setup/intro, hidden intro completion, explicit user-selected sensing mode on resume, selector-focused Escape, persistent device selection and end-of-run capture guards. The offline local API returns validated fallback responses without provider calls or quota throttling; parallel offline tests previously exposed needless429s, which are preserved as failed evidence and do not count as clean passes. Live request throttling is unchanged.

Final harder-version verification is summarized in [harder-final-verification.json](qa/harder-final-verification.json). The original replacement verification file remains historical. Camera lifecycle audit evidence is [separately labelled as mocks and code review](qa/harder-camera-lifecycle-audit.json).
