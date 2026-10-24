# HUSH harder revision — 2026-10-24

The root application is HUSH. Run `npm run dev` for browser play or `npm run desktop` for the native Presage camera path. The opening cutscene, `src/main.tsx`, intro dialogue and asset files were left unchanged in this revision. Both original build kits and local credentials are preserved.

## Current behavior

This revision makes the run longer, louder and harder, and adds four thinking tasks. Full rules, formulas and measured results are in [BALANCE.md](BALANCE.md); runtime tuning lives in `src/game/config.ts`.

- **Exposure is work noise.** Running equipment with a live task is never silent; every correct input adds noise and mistakes add more. Exposure cools only when the equipment is off, six times faster while isolated. Low exposure drifts the creature away, high exposure rushes it. Seeded hunts (one per 100-second period, 10 seconds, with a RUNNING FOOTSTEPS caption and warning sound) make it charge even during flawless play. The HUD shows exposure with its named parts.
- **Run shape.** 8-minute deadline (a typical win is about five); 25-second grace; moves every 2.5 seconds, capped at 3 units. Three isolation cells, one recharged per completed stage, each use adding 2 permanent exposure. An isolation lasts until the player restores power (hold F, from 4 s) or 25 s, so the player can wait for the footsteps to fade; the creature lingers while isolated. An attack still cannot commit until 2.5 seconds after the near alarm, and late isolation cannot cancel a commitment.
- **Stages.** 1: rack sound key, 6 faults found by ear (plain 1–4 buttons; shuffled thump/whine/tick/buzz sounds), 6 cables, one conduit board. 2: memory growing 3→5, heartbeat mask (8 beats, ±15%), emitter A. 3: new sound key, 8 faults by ear with two at once, 12 cables in six-cable panels, locate (three monitor marks). 4: memory growing 4→6, calm hold (12 s), emitter B. Then final containment. The tutorial is unchanged and skips the thinking tasks.
- **Presage use.** The heartbeat mask and calm hold read only the coarse accepted trend: ELEVATED means more beats and tighter timing, or slower calm progress; STEADY/RECOVERED speeds calm. Manual or missing data uses the standard rules. Raw pulse never enters game state.
- **Audio and scares.** The breach scream is a formant-shaped voice on its own bus, boosted above the mix (still following volume and mute), with the limiter briefly opened. There is no alarm siren: footsteps (CC0 recordings) get louder and quicker as it closes in, from its wandering bearing, with pounding at the wall, growls, crickets that fall silent near it, a wind bed and random night sounds. The detector is a ping radar that reveals a fading dot at the sampled range and bearing, with no number. The security-monitor panel docks on the right so the CCTV feed stays visible. The breach jumpscare is a 2.1-second lunge without bright full-screen flashes. Softer-scare and reduced-motion options still apply.
- **Contract change (user-approved; post in team chat before merging).** `src/game/state.ts` adds `tasks.step`, `RoutingState`, `PulseMaskState`, `LocateState`, `CalmState`, `Sector` and the `route`/`engage`/`mark`/`tap`/`breathe` actions. The trace summary and director observations copy explicit fields only, so none of this leaves the device.

## Vitals diagnosis and correction

Three concrete code problems were corrected: the app's blanket80confidence gate rejected SDK-stable pulse/breathing; chest-only validation also invalidated pulse; and recoverable timestamp ordering/gap errors could shut down native capture. The gate now honors the installed SDK's metric-specific stable floors40/45, applies chest warnings only to breathing, and drops known transient timestamp errors while preserving terminal failures. Relevant validation still neutralizes current input. Fresh accepted history can survive a framing flicker, while stale data does not drive danger.

Pulse and breathing merge independently. They keep their separate12/30-second warmup windows and5-second freshness bounds. Local diagnostics now include per-metric confidence, eligibility, measurement/receipt age, cadence and sample count. The corner monitor explains missing breathing instead of silently displaying a dash. See [sensing diagnostics and primary sources](../src/sensing/DIAGNOSTICS.md).

The user reports successful30-second calibration. **A new real-camera measurement session was not performed for this revision.** Hardware reliability is therefore not claimed verified. The older CAMERA_NOT_FOUND result is historical and does not describe the user's currently working camera.

## Verification evidence

- `npm run check` passed 146 tests, TypeScript, the web build and the Electron build.
- [Reducer sweep](../artifacts/survival-balance.json), 30 seeds per scripted policy with perfect puzzle knowledge (not a human playtest): perfect 28/30 in 156 s; fast 23/30 in 207 s; human-paced 13/30, mean 260 s, 3 close approaches per run; slow and error-prone 0/30; human-paced with a synthetic elevated trend 5/30.
- [Seed 17 browser win](../artifacts/harder-seed17-evidence.json) through visible controls only: all seven tutorial steps, both cable boards (real drag plus clicks), three routing circuits solved from the on-screen ratings, memory rounds 3→6 and 4→8 read from the visible cue flashes, the heartbeat mask timed from the visible pulse, four monitor marks from the range reading, the calm hold with the B key, three natural alarm defenses, three blackouts and final containment, in 208 game seconds with zero console or resource errors.
- [Layout](../artifacts/harder-layout-evidence.json) passed at 390×844 and 1280×720 after twenty visible fault repairs; [late-Q loss](../artifacts/harder-loss-evidence.json) passed with the breach scare preceding the explained loss.
- Fixture pages `tests/fixtures/tasks.html#<step>` and `tests/fixtures/jumpscare.html` render each task panel and scare from real reducer states for visual checks.
- Not verified: scream and alarm loudness on real speakers, and the Presage-aware tasks against a live camera session. Earlier evidence files describing 8/12 faults, four cables or a 300-second deadline are historical.

## Integrations and remaining limits

The last live final-prompt monster probe generated Gemini text in891ms and ElevenLabs speech in359ms, then decoded the exact generated caption's audio. See [generated-monster narrative evidence](qa/generated-monster-narrative-check.json). That predates this rule revision; this turn does not claim a new live provider run. Existing narration/queue regressions cover nonoverlap and delayed/out-of-order responses.

The local provider contracts now carry bounded line position, danger and remaining cells without private wire answers, memory inputs, raw physiology or camera frames. The trace contract remains `lock-in-v2` for compatibility; corresponding functions/schema are prepared locally but were not deployed. The previously reachable deployment lacked HUSH functions. Remote subscription/reconnect/delete remain unverified. Local judge sharing is separate and works offline.

No keys, account settings, paid resources or deployments were changed. Packaging, signing, notarization and human speaker-quality assessment are not claimed. The large Three.js bundle warning remains nonfatal. The supplied asset bytes are unchanged; no new images or cutscene assets were generated.
