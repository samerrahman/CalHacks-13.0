# Two-minute operator demonstration

Run `npm run dev`, open the localhost address printed by Vite, and choose **02 MIN / Demo shift**. Under **Operator settings & sensing**, keep encounter seed **17**. This is a reproducible authored scenario; the 120-second deadline starts when you enter the shift. The full preset has a 300-second deadline and the same task requirements. Finishing all operations ends either preset immediately.

For a reliable offline presentation, select **Manual — no camera**. Enable **Share sanitized events with judge view** only with the operator's consent. Prepare the second screen using **Judge view**. Local trace sharing is a browser BroadcastChannel; it is not evidence of a live Convex deployment. Read the current provider status rather than claiming every integration is connected.

If demonstrating a configured Presage camera, finish calibration before starting the game: stable desk light, warmup, then approximately 30 seconds of accepted baseline data. Proceed manually if capture is unavailable. A simulated trend is a labeled development input, never a live Presage measurement. Do not promise that a specific scene will produce a physiological response.

## Controls

| Control | Action |
| --- | --- |
| `1`, `2`, `3`, `4`, or station buttons | Console, left hatch, right uplink, relay cabinet |
| `A` / `D` or left/right arrows | Switch station |
| `Tab`, `Shift+Tab`, `Enter` | Reach and activate every button without a mouse |
| Dial `−` / `+` buttons | Change the displayed value; digits wrap from 0 to 9 |
| `Q` | Inspect the active work order, closed-order history, and private challenge card |
| `R` | Authenticate the current radio request against that call's private card |
| **Reject call** | Reject only after an independently checked discrepancy has been found |
| **Open/Seal shutter** | Operate either shutter from any station |
| `Space` at a side station, or its **Sweep** button | Sweep that tunnel: 8 energy, 12 seconds clear, global 12-second cooldown |
| **Collect**, **Insert**, **Transmit** buttons | Start a timed interaction; activate again to cancel/pause |
| Hold `E` at a task station | Hold the current interaction; release to cancel/pause |
| Drag the 3D view | Look around the current station |
| `Escape` / pause button | Stop game time, energy, task progress, and encounters |

All clues are written on screen; sound and color discrimination are unnecessary. Use the pause menu for volume, reduced motion, and restart. The HUD mute button remains available. Sensing status and the stop-capture control are in the judge trace panel (`J`).

## A playable seed-17 sequence

Times below are approximate presentation targets. Follow the actual task and warning meters if your input timing differs.

1. **0:00–0:15 — Establish the rules.** At **Console**, set **Frequency 2 / Phase 7 / Gain 4**. Each target is also printed underneath its dial. The left shutter starts sealed and the right starts open. Briefly seal right: **LINK BLOCKED** appears and synchronization stops. Reopen right. Press `R`, then inspect the private card: the first genuine call's response matches. Close the card when done.

2. **0:15–0:35 — Complete the carrier.** Keep at least one shutter open until link accumulation reaches **20 / 20 seconds**. The first offline approach is on the left; its shutter is already sealed. Show its footsteps, silhouette, and six-second threshold warning without opening it. A sealed threatened side blocks entry. The next work order becomes **NR-370**, requiring **LEFT** cartridge service.

3. **0:35–0:50 — Catch the imitation.** One second after cartridge work becomes active, the authored teaching call cites the current order but asks for the wrong hatch. Press `Q` to compare it with the trusted left-hatch instruction, or `R` to compare its failed response with the newly rotated private card. Activate **Reject call** after the discrepancy appears. The reject button remains disabled before evidence is discovered. Do this before inserting the cartridge, because a task transition replaces the radio order.

4. **0:50–1:05 — Service safely.** Select **Left hatch** (`2`). Sweep **LEFT**, open its shutter, and seal **RIGHT**. The left status explicitly shows a 12-second **CLEAR** countdown. Activate **Collect cartridge** and let the three-second interaction finish. Select **Relay cabinet** (`4`) and activate **Insert cartridge** for one second. The new trusted order is **NR-371**, requiring right uplink work.

5. **1:05–1:30 — Transmit.** Select **Right uplink** (`3`). Set **Azimuth 3 / Elevation 6**. If necessary, wait for the shared floodlight cooldown; right may stay sealed while aligning. Sweep **RIGHT**, open right, seal left, and activate **Transmit**. Twelve accumulated upload seconds are required. Checkpoints save at **4**, **8**, and **12** seconds. Time spent opening shutters after a sweep can mean the first clear window ends at the 8-second checkpoint: sweep right again when ready and continue. If the button says **Pause transmission**, the interaction is already active and will resume inside the new clear window.

6. **1:30–2:00 — Show evidence and honest status.** All three operations produce **Transmission received**; the player need not wait for the deadline. Show the second-screen events, request identity, chosen legal tactic, and actual source label. The offline director is **FALLBACK**, speech without ElevenLabs is caption plus radio effects, and manual sensing is neutral. If real services are configured and verified, show their actual live result. Demonstrate sensor stop/loss only as the UI permits and check that its status becomes unavailable/unknown; never substitute a simulated value while presenting it as live.

## Recovery and limitations

- A sweep cannot be overridden by a director proposal. It confirms that one side is clear for 12 seconds. Do not spend its window reading a long explanation before starting the task; inspect first, then sweep.
- If a task's clear window runs out, resweep when ready. Cartridge collection restarts its three-second interaction if interrupted. Uplink retains completed four-second checkpoints.
- If power reaches zero, open **both** shutters within the displayed eight-second countdown. Closed doors consume power; keeping both closed cannot complete the shift.
- Each call expires after 24 seconds and is replaced on task transitions. Expired requests are explicitly inactive; they can be reviewed under work orders. Always use the current task record and current challenge card.
- The first teaching fake is authored and predictable, including when a live director is available. Seed 17 is for presentation reproducibility, not proof of generated behavior. Subsequent physical encounters still obey the same warning, cooldown, recovery, and attack-budget rules.
- The browser build supports manual and explicitly simulated sensing. Live Presage requires the native Electron path, a supported laptop, permissions, credentials, accepted quality, and completed baseline collection. See the repository's integration status for what was actually tested.
- Gemini, ElevenLabs, and remote Convex demonstrations require their configured development services. Missing credentials leave the game playable but do not establish a live sponsor integration. Normal offline audio consists of the supplied effects; the captions remain complete.
- The 19 core behavior tests include 12 successful full sequences across six seeds and both presets. These are deterministic gameplay checks, not a claim that a human player or hardware sensor was tested in every condition.
