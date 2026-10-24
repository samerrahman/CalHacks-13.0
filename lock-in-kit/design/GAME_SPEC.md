# LOCK IN — implementation specification

This document describes a game to build. The kit supplies authored assets, design, provider research, schemas, and independently runnable rule examples. It does not contain a finished application or establish live sponsor usage.

## Experience and scope

You are a researcher in a windowless emergency observation shelter after a containment failure. An intelligent creature is outside. It searches using machinery sounds, remembered evidence, remote emitters, and a small additional fictional biological-rhythm clue at close range. Its recovery from sedation creates pressure. Complete four research stages, transmit the calibrated final lure, and wait for remote containment to seal.

Only the shelter interior is fully rendered. Use the kit's low-poly dirty teal steel, warm task light, cream labeling, restrained amber faults, soft fill, and deep shadows. There is no exterior playable level, visible creature roaming the room, glass box, combat, inventory grid, door-switch defense, or door-closing resource loop. The solid entry door is a static story prop and may dent during a breach. There is no player door-open action.

The start is an authored audio sequence with matching captions: containment alarm, emergency announcement, running, shelter entry, heavy door impact. Transition from black to the shelter. A damaged recording and a brief emergency message explain the work. Provide skip/replay and independent volume; never require loud output or flashes.

The room is 6 × 5 × 3 meters. Front desk: z −1.8. Solid rear door: x −1.75, z 2.39. The fixed emergency switch is next to it, x −0.70, y 1.35, z 2.36. The switch remains faintly readable during darkness and has permanent keyboard controls. The exact mesh locations should match the asset manifest.

Use TypeScript, Vite, React for small overlays, Three.js for the shelter, one fixed-step local game authority, and an Electron/native path if live Presage is supported on the actual machine. This kit's reference utilities are examples to integrate and extend, not the application's reducer or a substitute for scene/UI implementation.

## One authority, two cameras

The creature has one logical exterior position on the graph in `config.json`, including interpolated travel along connected edges. That state generates proximity, footsteps, wall contacts, monitor overlays, directional captions, and positional voice. A sound scare cannot independently move it. A camera image cannot claim it is on the opposite side from its real position. Never randomly roll the distance meter independently of threat state.

The player's webcam is a permissioned measurement source. The fictional security monitor is game scenery. Label them separately: **CAMERA INPUT** versus **SECURITY FEED A / B / C**. Never put a webcam image into a fictional feed. Feed A covers the emitter clearing, B the service path, and C containment. Use the supplied empty stills/static treatments; add a silhouette only when the same logical creature state is inside that camera's region. Blackout takes all three fictional feeds offline.

No full creature mesh is required in the interior. Presence comes from coherent approach/recession sounds, a breathing source at the actual wall, scraping, minor wall deformation, and rare silhouettes on the security monitor. Reduced motion removes shaking and uses static outlines and text instead.

## Controls and minimal UI

| Control | Meaning |
| --- | --- |
| 1–4 | Activate machine boxes or enter a memory digit, when the terminal is active |
| R | Replay the current four-input sequence without an error penalty |
| T | Transmit a correctly armed lure; final containment broadcast after stage four |
| Q | Immediately switch all shelter machinery to emergency QUIET |
| Hold F for one second | Restore equipment; always physically available, even during blackout |
| Tab / Shift+Tab | Cycle the labeled terminal, monitor, emergency-switch station controls; preserve ordinary focus navigation within UI controls |
| Escape | Pause game and release mouse capture; stop camera capture and discard stale samples |

Mouse alternatives exist for every action. Use held F plus an accessible click-to-start/click-to-cancel one-second restore button. Do not require holding two controls simultaneously. Number buttons expose accessible names and current fault status. Standard focus rings remain visible. If Tab is used for station cycling, provide an explicit focus mode and avoid trapping normal keyboard navigation; an implementation may use Tab only through the ordered station buttons to satisfy both behaviors.

The ordinary view shows the current short instruction, task progress, a small real-source sensing label, and the relevant interaction controls. Proximity belongs on the physical detector or one compact panel. Do not overlay a developer dashboard over the room. Put provider provenance, evidence IDs, sensor quality, and traces behind a judge toggle/second screen.

Teach the emergency control before enabling lethal behavior. The guided tutorial uses anchored arrows/highlight rings on actual controls: one fault, one intentionally quiet box explanation, Q, receding cue, F, four sequence buttons, and T. The rehearsal cannot kill the player. Clear tutorial completion and input readiness gate the dangerous simulation; do not silently start sedation or a warning while the user reads instructions.

## Four research stages and final containment

All targets, required actions, progress, and earned rewards are authored by deterministic code. API text is never task logic.

1. **Silence five faults.** Four labeled boxes are visible. Exactly one fault is active initially; active boxes show `FAULT` plus a static outline and optional restrained shake. Press/click that box to resolve one fault. Schedule the next after 1.5 active seconds until five are resolved. Quiet-box input creates an error sound, not lost research. At five, all stage-one fault noise stops; emit one small relay sound and unlock calibration.
2. **Calibrate emitter A.** Three waveform cards show remote destinations. The selected A card is labeled and highlighted by code; selecting an emitter is not a guessing puzzle. Present exactly four values from 1–4, then accept the four responses. Correct input arms the visible Transmit control. T sends the remote signal, records stage two complete, and grants the earned diversion. Calibration completion without transmission does not award the lure.
3. **Repair seven overload faults.** Use the same four boxes. One or two are active at a time, with a 1.2-second spawn interval. Use a seeded, bounded schedule; never require more than two simultaneous fixes or spawn inaccessible controls. Resolve seven faults total. Final resolution silences overload noise, emits one relay click, and unlocks the second calibration.
4. **Calibrate emitter B.** The B waveform card is unambiguously selected. Present a new four-input sequence. A successful T records stage four, directs the creature toward B, and grants the same guaranteed diversion. A wrong input restarts that attempt, not completed stages.
5. **Final containment broadcast.** Four stages must be complete, equipment restored, and the final control deliberately activated with T/click. No new guessing minigame. The calibrated signal becomes the forced target CONTAINMENT. Once the creature physically reaches that node, run the three-second remote-seal sequence and win. A completed final broadcast cannot be invalidated by an API, a pulse change, or an electrical failure.

Visual puzzle timers pause in QUIET, blackouts, and the pause menu. Preserve stage counts, active fault IDs, memory sequence, already entered digits, playback cursor, presentation tempo, and an armed transmission. A fault may remain unresolved while silenced; restoring reactivates it visibly. Completing a stage is permanent. Rewards, events, sound, and research records are idempotent so a reconnect cannot award or replay them twice.

### Memory tempo and accessibility

Base playback is 0.75 seconds on and 0.25 seconds gap per digit. At presentation start, snapshot the current accepted trend. ELEVATED may set tempo to at most 1.20×, making the same four inputs about 3.33 seconds rather than four seconds. Do not increase the sequence length or change the tempo halfway through. UNKNOWN, rejected, missing, manual, or stale data uses 1.00×. An optional accessibility preference can fix playback at 1.00× for all modes without restricting completion or report collection.

Allow 45 active seconds for entry, unlimited free replay, and no typing-speed requirement. Expiry offers replay without a clang or lost research. A wrong digit makes one bounded error sound and restarts entry. Avoid repeated error sounds from key repeat; ignore inputs during playback with a clear status rather than penalizing them. If blackout happens during a sequence, resume the preserved state and offer free replay. Do not erase already entered correct digits simply because the lights failed.

## Clues, confidence, sedation, and warnings

Machinery generates 0.35 clue strength per active fault, capped at 0.70. A wrong input makes a 0.80 transient decaying over four seconds. A stage completion makes 0.20 over two seconds. Restore makes 0.55 over three seconds. A remote lure has strength 1.00 and, once earned, is protected by stronger deterministic rules below. These are game units, not sound-pressure measurements.

Audible local clues have a 32-meter game radius. Integrate confidence from machinery, transients, and the bounded nearby physiology clue using the rates in config. Confidence is a memory of evidence, not a second independent monster. In ordinary quiet conditions it decays; entering Q does not erase confidence or teleport the creature. A stale event cannot remain permanent fresh evidence. Clip confidence to [0,1].

Sedation uses elapsed unpaused game time, starting after the tutorial. Bands are SEDATED at 0 seconds, RECOVERING at 90, ALERT at 180. Search speeds are 0.80 / 1.15 / 1.50 m/s. Minimum approach durations are 10 / 9 / 8 seconds. Breach warnings are 10 / 8 / 6 seconds. Snapshot a warning's duration at its start; a sedation-band transition cannot shorten an already running warning. A distant path may take longer than the minimum. Never teleport to satisfy a schedule.

A breach warning can start only when all conditions hold: the creature is at the actual wall (≤4.2 meters from shelter origin), its warned approach has lasted the band minimum, confidence is at least 0.65, there is audible equipment/sound evidence of strength ≥0.20 from the previous eight seconds, no quiet/reward/restoration/recovery protection is active, the encounter budget allows it, and its accessible warning can be delivered. Pulse evidence alone does not satisfy the audible-evidence condition.

Use one consistent learned warning: sustained wall strain plus **BREACH WARNING — Q TO QUIET** and the remaining interval. This caption is never suppressed during blackout. A cosmetic scare must use a distinguishable cue. After a completed defense allow at least 12 seconds recovery; cap warning starts at three per moving 60-second window. Never overlap two physical encounters or an essential voice instruction with another essential instruction.

Loss occurs only after the full delivered warning completes while the creature remains at the wall, the player has not quieted the shelter, and no earned protection applies. The final impact/deformation and cut to black are cosmetic after this deterministic loss decision. No dialogue click, wrong box alone, pulse spike, or blackout itself kills the player.

## Emergency QUIET: reliable before the first lure

Q is powered by a dedicated emergency control and available from the first dangerous moment. It has no charge cost or cooldown. It silences both normal and residual blackout machinery immediately, pauses visual work, cancels a current breach warning, and invalidates queued local task/completion sounds that have not yet occurred. Remote emitters already transmitting continue independently.

The creature still remembers. If it is investigating the shelter, it spends at least four seconds listening in place. It then retreats continuously along legal edges for at least six seconds at up to 1.5 m/s. Confidence decays while it retreats. Do not erase its previous sound memory at the instant Q is pressed. If already far away or following an earned lure, it stays on a legal safe route rather than being teleported toward the shelter for this sequence.

After the four-second listening interval, at least six seconds of receding movement/quiet, and a true distance of at least 12 meters, deliver **FOOTSTEPS RECEDING — RESTORE WINDOW**. Sound has an equivalent written directional cue. A wall-origin quiet defense must reach this clear state within 16 seconds; choose the retreat route and speed so the bound is physically satisfied. No model decision, elevated trend, or random blackout can withhold this opportunity.

If Q was used while the creature was already far away, do not invent near-wall breathing or receding footsteps. After the same quiet observation interval, a true distant stationary state may show **NO NEARBY MOVEMENT — RESTORE WINDOW** with a quiet switch confirmation. The directional caption and footstep playback must still describe actual motion, not just the desired teaching beat.

Hold F one second to restore. Restoring after the clear cue produces the startup sound but grants ten seconds in which a new breach warning cannot begin, followed by the normal fresh approach/warning rules. A prior canceled warning can never resume at its old remaining time. Early restore is allowed: it resumes noisy equipment and creates a clue, but starts a fresh approach and full future warning. Q remains immediately available. This makes an early restore recoverable rather than an invisible death trap.

QUIET does not complete faults, sequences, research, or final containment. Waiting indefinitely therefore cannot win. Sedation continues while equipment is quiet, so delaying increases pressure during later work, up to the bounded ALERT settings. Do not introduce an undocumented quiet fuel timer, hidden suffocation, or forced starvation death merely to punish camping. The tradeoff is lost work time and more demanding later approaches, not an unavoidable kill.

## Earned lure guarantees

A successful memory transmission creates a code-enforced target and route immediately. The creature physically turns and travels toward that emitter. Award at least 16 seconds of protected diversion, and keep the route locked until it has arrived and listened there for four seconds if that takes longer. During this reward, local completion/mistake sounds, physiology, a model output, and blackout scheduling cannot redirect it back. Thus a success is a concrete stronger reward than a local noisy activation penalty.

After the reward expires, the creature may investigate fresh evidence again. It must travel back through the graph and receive a fresh, fully delivered warning of at least six seconds. Retain the appropriate recovery/budget constraints. Do not count time spent walking away as approach time toward the shelter. The final containment lure follows the same rule but remains locked until containment and the three-second seal succeed.

A later **player-earned** B or final transmission may supersede the earlier emitter target while its diversion is still active. Preserve the remaining protection, add the new minimum 16 seconds, and reroute continuously through legal exterior edges; do not send the creature through a shelter-wall node or teleport it. The ordered route A → junction → B → containment remains away from the shelter. This is an additional earned reward, not an AI override. The second Transmit button therefore does not need a hidden wait for emitter A to finish.

## Blackouts without traps

Eligible blackouts begin only after 45 game seconds, in research stage 2–4, at least 60 seconds after the previous blackout, at most three per run, and outside tutorial, active warning, quiet retreat, earned diversion, and final containment. A seeded deterministic schedule selects from eligible boundaries; the model cannot force one during protection. If no boundary is eligible, defer it. Blackouts are not mandatory at fixed timestamps.

Main light, terminal, proximity digits/danger indicator, and fictional camera feeds go dark. Visual work pauses with all progress preserved. Remaining auxiliary faults emit only 0.15 each until Q. The creature continues moving. Keep the emergency control and equivalent sound captions available. Disable flashing/strobing; a dim constant switch lamp is enough.

The player presses Q, hears/reads the listening and retreat sequence, then uses F in the explicitly signaled restore window. Q/F require neither terminal power nor a camera reading. Receding footsteps and their caption reflect real movement; near-wall breathing and approaching steps warn against an early restart. A warning that begins after blackout has started still provides its full accessible interval and Q defense. A player who makes a premature restart may quiet again immediately. Blackout cannot consume earned progress, hide a lethal warning, disable both escape controls, or require audio hearing to survive.

## Physiology contract

The user's example instruction about keeping pulse near baseline is fictional context, not a health goal or a completion requirement. Prefer task text **Silence five faults. Nearby accepted pulse trends can add a small clue; QUIET and lures always work.** Never instruct breath-holding, suppressing symptoms, or lowering pulse to unlock a button. Puzzle completion always counts.

Live sensing uses the verified installed Presage native capture architecture and actual quality semantics. Follow the integration guide; do not invent a browser SDK or convert an unknown confidence scale. After a minimum 12-second warmup and flowing valid measurements, collect about 30 seconds of accepted baseline. Offer manual mode at 60 seconds and at any earlier user request. Freeze the baseline during the run.

Accept only finite 40–110 BPM values meeting actual SDK validation/quality rules, with receive-time age ≤5 seconds and defensible measurement timestamps. A gap, bad capture, unsupported range, unavailable source, or stale sample yields UNKNOWN immediately. Sustained elevation is ≥baseline+8 over 12 seconds, recovery <baseline+4 over 12 seconds, with 20-second minimum state dwell. These are game tuning thresholds, not clinical thresholds. UNKNOWN is neutral, not stealth or fear.

The documented starting profile for installed SmartSpectra Node SDK 3.4.0 requires stable pulse, fresh validation OK, and native confidence at least 80 on its verified 0–100 scale. This is conservative game tuning, not a claim of vendor-required accuracy or a probability. Recheck a different package version's types/semantics before applying that profile. The normalized sample's `quality: accepted` must come from this verified adapter gate; the reference acceptance utility does not invent a second interpretation of the native confidence field.

Only within eight meters can an accepted sustained ELEVATED trend add a clue, capped at 0.18. It can bias a legal listening choice or modestly affect a future sequence's fixed presentation tempo. It cannot satisfy the audible-evidence gate, shorten warnings, cancel QUIET, cancel a lure, alter a correct puzzle answer, or directly cause loss. Manual mode has the same game and win path. A simulated source is explicitly labeled development input and does not demonstrate Presage.

## AI and asynchronous boundaries

Use `reference/director.schema.json` for the proposal and strict semantic checks. Legal tactics are INVESTIGATE_SOUND, CIRCLE_SHELTER, LISTEN_NEAR, FOLLOW_LURE, WAIT, TAUNT, RETREAT. Targets and taunt IDs are separately allowlisted. LISTEN_NEAR does not teleport a distant creature; it is only offered at a reachable current near location. CIRCLE_SHELTER travels actual connected wall nodes. TAUNT has no movement or rule-changing instruction. An earned FOLLOW_LURE target is binding code state.

Send request ID/version, expiry, allowed sets, public evidence IDs, coarse accepted sensor trend/quality/source, current clue strengths, the creature's own position/band, and observable equipment/research events. Do not send webcam frames, raw pulse, memory sequences, unentered answers, or arbitrary player-authored instructions. The creature's knowledge is evidence-based; there is no automatic hidden-terminal omniscience.

Request only at eligible encounter boundaries and no more often than every 12 seconds. Local and provider response budget is eight seconds; a longer provider server transport deadline is not permission to stall the game. Movement, controls, puzzles, Q, captions, and warnings continue throughout the wait. Validate exact request identity, version, expiry, duplicate use, target/tactic pairing, evidence provenance, cooldown, phase, and all protections. Invalid, stale, late, malformed, or failed responses produce a seeded legal fallback. A response near the deadline may be discarded safely. Record applied/rejected/fallback and real latency distinctly. No arbitrary generated dialogue is authoritative equipment guidance.

Process Q and earned-lure inputs by their recorded arrival time before resolving a warning deadline in the same fixed step; valid input received before the deadline cannot be lost to frame ordering. Recheck semantic guards when committing a provider reply. Increment the concurrency version for changes in task/phase/protection/target eligibility, not every rendered frame or millisecond; otherwise no delayed response could ever remain valid. Clue freshness and actual position still receive independent current-state validation even when a version matches.

## Events and end report

Every local event has `{id, seq, gameMs, receivedMonotonicMs, type, data}`. IDs are `${runId}:e${seq}` and unique within a random run ID; a repeated deterministic scenario gets a new run ID. Record a session anchor pairing game zero and monotonic capture time, plus PAUSED/RESUMED intervals. Game time freezes during pause; sensor receive-time does not. Reports must map both clocks explicitly and exclude paused samples rather than pretending their timelines are identical.

The local report has a deliberately narrower marker vocabulary. At the report boundary map `receivedMonotonicMs` to `capturedAtMs`, preserve `gameMs`/`id`, and attach the current capture `segment`. Map `BLACKOUT_STARTED → BLACKOUT`, `WRONG_INPUT → MISTAKE`, `NEAR_LISTEN → CLOSE_ENCOUNTER`, `LURE_TRANSMITTED → LURE_SUCCESS`, `QUIET_ENTERED → QUIET`, and `RESTORED → POWER_RESTORED`; `SCARE` and `BREACH_WARNING` keep their names. Other gameplay events remain in the ordinary trace rather than becoming physiological comparisons. Pause/capture restart increments the segment and breaks recorded lines; do not rename timestamps without this explicit mapping.

Store raw pulse only in an explicit opted-in local in-memory report buffer; offer clear/delete and export consent. Public trace carries coarse source/quality/trend and sanitized gameplay events, never raw pulse or video. End reports may include baseline, highest usable observed value, timeline markers, largest observed post-event rise, and qualified recovery measurements. Use only accepted, sufficiently covered windows and identify overlapping-event ambiguity. Say **largest recorded increase followed…**, never “fear score,” diagnosis, or proof an event caused a response. Missing data yields **unrecorded/insufficient accepted data**, not invented statistics. See the separate report implementation guide.

## Definition of done for the future implementation

An unfamiliar player finishes the tutorial and can win through real controls. All four tasks plus final physical containment work offline. Q defense works before any lure; blackouts preserve partial memory and always allow a clear restore opportunity. Proximity, captions, camera overlays, and audio agree with the creature's position. Several seeded runs win; quiet camping never wins. Invalid sensor data and API failures remain neutral/playable. Provider and native claims reflect actual live tests. Pause/restart/unmount clean up timers, listeners, streams, audio, and pending replies. Render the real models, animate supplied clips, inspect the laptop layout, and test keyboard-only, muted, and reduced-motion play. A scaffold or this reference test suite alone is not a completed game.
