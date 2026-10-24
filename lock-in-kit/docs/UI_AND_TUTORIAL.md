# Interface and tutorial implementation contract

## Visual target

Keep the dirty teal steel, warm cream work lamp, muted cream labels and restrained amber warnings of the original art direction. This is a cramped, windowless research shelter. The only exterior views are clearly identified fictional security feeds. The physical door never becomes a player-operated shutter. No two-lane door controls, power battery meter, rotating supervisor identity puzzle, sweeping floodlight or timer-survival victory.

Most of the screen is the room. At 1280×720 use one contextual task panel, approximately 400×260px at the bottom center/right when a device is focused. Do not place four permanent dashboard panels around it. Keep inactive devices visible in the room. Use native system sans for instructions at 16–18px; monospace for numbers, labels and equipment IDs at 12–14px. Never rasterize essential text into a small model texture as its only readable presentation.

Palette: backdrop #081211, steel #27403f, raised panel #142724, cream #d9dfc9, dim text #a7b7a5, amber #d99450. Orange also has FAULT text, a solid border and icon; green is never the sole safe signal. Avoid high-frequency flashing, automatic camera shake, bright full-screen flashes and tiny low-contrast uppercase paragraphs.

## Normal view

A narrow top strip contains LOCK IN, protocol stage (e.g. 02 / 04), and a compact sensor state. Bottom center has two lines of contextual controls, e.g. "1–4 select · R replay · T transmit". A persistent faint emergency hint "Q quiet · hold F restore" stays readable even in blackouts. Captions appear above those hints and never obscure a task button.

The physical proximity detector shows a distance bucket/quantized reading and one of DISTANT / APPROACHING / AT WALL / BREACH. Derive all of these from the same creature authority, with telemetry update cadence and uncertainty prescribed in GAME_SPEC. It is not a second independent danger simulation. During blackout hide distance and danger numbers entirely; keep only captions/switch. Do not substitute a minimap or exact hidden position.

Focus switches using Tab (cycle devices), Shift+Tab (reverse) and visible Terminal / Cameras / Equipment controls. Tab behavior must preserve keyboard access to DOM controls: use an explicit focus-device control or a documented modifier when an interactive form owns Tab; never trap users out of buttons. Recommended production binding: Tab from the scene cycles devices; within a device panel normal Tab/Shift+Tab traverses its native controls, Escape returns focus to the scene. Provide visible station buttons so cycling is optional. Mouse dragging looks around a seated viewpoint with bounded yaw/pitch. Reduced-motion uses direct view cuts. No pointer-lock requirement.

## Terminal / faults

Four large boxes in a 2×2 arrangement. Each is a native button with a visible number 1–4, equipment name and FAULT or QUIET. Active boxes use restrained slow mechanical movement and an amber outline; reduced-motion replaces movement with a static FAULT badge. Show "Silence faults 2 / 5". Quiet clicks count as mistakes only after tutorial practice. A fault completion produces its authored relay cue and clears continuous noise; it does not teleport the creature or erase memory.

The overload variant uses the same learned controls with seven faults and up to two active boxes. Do not add an unrelated late-game puzzle or a punishing random deadline.

## Terminal / lure

Three waveform cards are labeled A — CLEARING, B — SERVICE PATH, C — CONTAINMENT. Code selects the active destination for the current stage; the selected card says TARGET. These are destinations, never a guessing game. Render a four-step playback row and four number buttons. "Watch" disables entry until playback ends. Then display "Repeat 0 / 4"; correct input fills slots without disclosing later answers. R replays freely. T is enabled only on a valid complete sequence. Permit a generous response window with no physiological deadline.

Tempo is captured at sequence start; sustained ELEVATED can increase playback speed to at most 1.20× (intervals stay at least normal / 1.20). UNKNOWN/manual use normal tempo. A measured change mid-playback affects only the next sequence, not the current one. No additional sequence length, hidden key or rushed response timeout for elevated pulse. Optional slow-sequence accessibility mode uses normal/slower playback for every source and remains winnable.

## Emergency equipment and blackout

Q activates immediate quiet from any focused station, including during TTS, blackout or breach warning. A visible fixed physical switch plus an accessible DOM button does the same. It silences equipment, freezes puzzle work, and begins the authored listening/retreat response. Existing knowledge decays over this response; absence of machinery noise does not instantly erase remembered evidence.

F is a deliberate one-second hold to restore; show a small progress ring and cancel on release/focus loss. Also provide a click-to-start restore button with an explicit cancel state for users unable to hold a key. Restarting early creates a startup clue; the post-receding safe work period applies only after the valid response described in GAME_SPEC.

Blackout removes displays but preserves the faint switch, emergency controls and captions. Do not hide all controls or require headphones. Caption meaningful events in equivalent detail: "[footsteps approaching — left wall]", "[breathing beside the wall]", "[footsteps receding]", "[breach warning — Q: isolate equipment]". Cues originate from position/movement/state, not independent random playback. In reduced-scare mode retain the same warning duration with softened sound and no impact flash.

## Short guided tutorial (target 35–45 seconds)

Offer "Start with guidance" and "Skip tutorial"; remember this preference locally, with replay available in settings. Live camera consent/calibration is a separate optional setup step; the tutorial never starts a webcam.

Use actual production components in a deterministic nonlethal practice state. Temporarily pause threat and sedation; mark practice events excluded from run reports and sponsor proof. Do not advance the real research stage. On finish/skip create a fresh run; keep a ready baseline only within the same consented sensor session, and discard stale samples.

Each step is one sentence, one arrow and one action. Anchor arrows to data-tutorial IDs on actual controls with getBoundingClientRect; recompute on resize/focus change. Keep the callout out of the target's hitbox, make arrows pointer-events:none, and focus the target with a visible focus ring. Put the same instruction in an aria-live polite region. Avoid an unskippable timer.

1. Point at fault-box-1: "Press1 or click the box marked FAULT." Complete on one correct practice input.
2. Point at emergency-quiet: "Press Q to make the shelter quiet." Complete only when quiet is active.
3. Point at sound-caption: "Listen for receding footsteps. Captions carry the same clue." Play a labeled practice listening/receding demonstration; one Continue button after the cue.
4. Point at emergency-restore: "Hold F for one second to restore equipment." Accessible restore button also qualifies.
5. Point at replay-sequence: "Press R. Watch four pulses." Wait for the full demonstration; no input mistake penalty.
6. Point at sequence-buttons: "Repeat the four numbers." Keep R available; mistakes replay practice only.
7. Point at transmit: "Press T to send the signal away from you." Show the destination clearly, then "Begin containment protocol".

The tutorial is not a long report or a scrolling rulebook. Full controls remain in Pause/Help.

## Setup, pause, result and judge view

Setup: title, one-sentence premise, Start, Settings. Settings: sound/mute, reduced motion/scares, captions(always available), optional sensor setup, optional local pulse report recording, optional sanitized judge sharing. Distinguish webcam from SECURITY CAM A/B/C with explicit words. Never ask for an API key in the renderer.

Pause freezes simulation, task timers and sedation, stops camera capture and audio, invalidates stale asynchronous results; resume uses fresh samples. Return to setup/restart disposes resources. Keep baseline/session rules explicit.

Result: CONTAINED or SHELTER BREACHED, completed research, mistakes, quiet responses, lures used, then the optional pulse report. There is no definitive fear score. The report includes UNKNOWN gaps and SIMULATED watermark when appropriate. "Delete this run" removes local report data and any explicitly shared session.

Judge view is behind J or a consenting second screen. Show actual provider source, accepted/rejected proposal, public evidence IDs, legal tactic, latency, coarse signal status, current stage and transport. Never fill the normal HUD with sponsor logos, internal schemas or token usage.

