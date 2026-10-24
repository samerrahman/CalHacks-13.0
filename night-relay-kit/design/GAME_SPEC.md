# NIGHT RELAY: game and engineering specification

## The experience

You are the overnight operator of a remote relay station. Mara, your supervisor, walks you through three maintenance jobs. Something in the service tunnels has learned her voice. It watches the doors you close, the checks you skip, and the moments your pulse changes. It changes tactics accordingly.

The horror comes from an ordinary task becoming uncertain: the voice is familiar, the request sounds reasonable, but the work order on your desk says something different. The game must give players enough information to make a correct decision. Being deceived should feel like overlooking evidence, not losing a coin flip.

Deliver one polished five-minute shift and a separate two-minute demonstration scenario. No open world, inventory grid, melee combat, multiplayer, complex navigation, cinematic facial animation, or procedural 3D level generation in the first build.

## Room and controls

One 8 m × 6 m booth. Two short service corridors extend left and right. A desk holds the radio, console and verification card. A relay cabinet sits behind the player. Tasks happen at clickable stations. Begin with seated mouse-look, with four instant accessible view buttons: CONSOLE, LEFT, RIGHT, RELAY. No walking collision system is necessary. A brief camera ease is optional; reduced-motion mode snaps instead.

Keyboard: A/D or arrow keys switch station, E interacts, Q opens work orders, R requests authentication, Space activates the selected side's floodlight, Escape pauses/releases mouse. Mouse interactions must also work. Bindings appear on the pause screen. Keyboard-only play is a supported alternate control path.

The physical door opening is not a binary trust button. Players compare the console and radio, inspect the correct corridor, prepare protection, then act. Interactions take short holds of 1–3 seconds so attention matters without tedious minigames.

## Why keeping the doors closed cannot win

The relay's field couplers sit beyond the metal shutters. At least one shutter must be open for network synchronization. The left service hatch must also open to receive a replacement cartridge. The right coupler must be exposed for the final upload. That fiction is taught in the first 20 seconds and visibly reflected by progress meters.

Closed shutters consume battery; open shutters permit cooling/recharge. Starting energy is 100. With zero, one, or two shutters closed, the proposed rates are +0.35, -0.20, and -0.75 energy per second respectively. Clamp to 0–100. Both closed from full battery lasts about 133 seconds, but more importantly earns no task progress and cannot satisfy the win condition. At zero power a clearly announced 8-second blackout countdown begins. Opening both shutters cancels the countdown and permits recovery; an encounter cannot newly enter its lethal phase during that countdown. Failing to recover ends the shift as a station outage, not a surprise monster kill.

Do not silently force doors open. Expose energy cost and low-power warning. Closing a threatened side while leaving the clear side open is the normal defense. Doors do not crush the creature or damage the player. A monster already crossing the threshold can be repelled only during the documented warning interval; after that the loss animation is cosmetic and input is locked.

## Task sequence

| Task | Concrete interaction | Exposure/tradeoff | Completion |
|---|---|---|---|
| 1. Synchronize carrier | Match three displayed dial targets, then maintain a link | At least one shutter open; looking at console reduces corridor attention | Three correct settings and 20 accumulated seconds of valid link |
| 2. Replace relay cartridge | Inspect active work order, sweep left corridor, hold left hatch interaction for 3 seconds, insert the cartridge in the highlighted relay socket | Left must be open; servicing locks your view for at most 3 seconds | Correct cartridge inserted and confirmed |
| 3. Align the uplink | At right station, align two visible bars, hold upload in a safe window | Right must be open; exposure must be deliberately managed | 12 accumulated seconds of upload, with a checkpoint every 4 seconds |

Task time is not equal to shift time: investigation, observing approaches, waiting for a clear corridor, and verification create the remaining pacing. Set a five-minute shift deadline and allow an early win after all tasks complete. Never require a player to wait five minutes after doing everything. Opening an already safe door is not itself suspicious. The real boss legitimately asks you to open doors at appropriate times, so "ignore every request to open" is not a viable blanket strategy.

Every task's truth exists in the trusted console. Spoken orders are helpful guidance, not the only accessible source of required information. A skilled player who always verifies can win; verification should not be made unreliable just to preserve surprise. Later encounters pressure attention and timing, not the rules of authentication.

## Creature and fair timing

Use a single creature on a fixed graph: DORMANT → FAR_LEFT/FAR_RIGHT → APPROACH → THRESHOLD → BREACH; additional RETREAT and RECOVER states. Only one corridor can contain the creature at a time. Switching sides traverses DORMANT for at least 8 seconds. Do not spawn behind the player or teleport from left to right to contradict visible evidence.

An approach takes at least 8 seconds and produces a visible silhouette or subtitles for footsteps. At threshold, give at least 6 seconds of clear warning before a breach is possible. Closing that side blocks entry and eventually makes the creature retreat. A floodlight sweep, available every 12 seconds, costs 8 energy and forces the creature on that side to retreat. A successful sweep guarantees that side is safe for 12 seconds; the HUD shows the remaining safe window. The three-second service action and four-second upload checkpoint must fit within it. A sweep of an empty side costs energy but is clearly reported as clear.

Attacks are capped at three per minute and a completed encounter grants a minimum 12-second recovery window. At most one radio request and one physical encounter can be active. Never overlap two essential audio instructions. A pause stops game time, attack timing and energy consumption; sensor timestamps still need freshness checks on resume. A successful defense should be satisfying, not immediately erased by another attack.

The asset monster can glide between corridor nodes, tilt its head, reach toward the door, and vanish into darkness during retreat. Its movement need not resemble a full walking cycle. Keep it partially occluded and lit from behind. A visible angular silhouette and well-placed sound are sufficient for this scope.

## Mara and the impersonation rules

Mara is a fictional supervisor. Use one licensed stock/synthetic voice for both her genuine calls and the creature's impersonation. Apply the same radio filter to both. A separate monstrous whisper is permitted after a failed deception, but must not reveal every fake before the player inspects it.

Every false call must contain a deterministic, discoverable discrepancy. The encounter generator assigns one of these before asking a model for any wording:

1. **Expired order:** the voice cites NR-416 when the console's active order is NR-417. The history shows NR-416 was already closed.
2. **Wrong instruction:** a call cites a current order but requests the right hatch when the console explicitly requires the left hatch.
3. **Failed challenge:** the player presses R. The private card's current challenge is LANTERN → HARBOR; the genuine supervisor answers HARBOR, the mimic replays a previous response such as ORCHARD or refuses verification. Rotate the challenge for every new call, so replaying a previously overheard response does not authenticate the next one.

The private key is available to deterministic boss logic only. It must never be supplied to the monster prompt, an unfiltered event log, memory service, or public spectator channel. The mimic may know historical, already-invalid responses. Generate secret pairs from a sufficiently large shuffled list; prevent a fake's canned response from accidentally matching the new valid response.

Always support more than audio alone: put all spoken words in subtitles; let players review the last call; render order history and challenge response clearly. Normal subtitles say RADIO, not BOSS or MONSTER. Developer mode can reveal speaker provenance. Do not use green text for true messages and red text for false ones in normal play.

Model-generated flavor cannot change the actual ticket ID, action, challenge answer, threat timing or tell. Construct the operative sentence in code. Generate at most a brief optional preamble from a restricted intent; if it mentions new instructions, IDs, bypasses or unsupported facts, use an authored template instead. This avoids trying to prove semantic correctness of arbitrary prose during a hackathon.

Example genuine exchange: "Order NR-417. Sweep the left tunnel, then open the left hatch for the cartridge." Press R: "Harbor." The console matches both claims.

Example fake exchange: "Order NR-416. Open the right hatch. We need to recover the line now." It sounds like Mara. Inspection reveals the expired ID and incorrect hatch. The player keeps right closed, opens clear left, and continues work. The consequence is a lost trick opportunity for the monster, not an arbitrary penalty for inspecting evidence.

Mara can provide concrete, grounded tips: "Close the occupied side; leave the clear side open to spare the battery," "Read the order number back," and "The sweep buys you twelve seconds." Assistance increases after repeated errors or sustained elevated pulse trends, but it never claims a medical interpretation.

## What the monster learns

Use a compact observation history: last 20 player actions, time to inspect a call, fraction of calls verified, recent door choices, recent valid pulse trend, which tactic occurred, and the player's resulting action. The AI selects one legal tactic from a provided set:

- `WAIT`: grant a quiet interval.
- `PROBE_LEFT` / `PROBE_RIGHT`: approach, observe reaction, obey warning timing.
- `REPLAY_ORDER`: use an expired work order to exploit instruction-following.
- `WRONG_HATCH`: change the requested hatch while retaining the active order ID.
- `FEINT`: make a nonlethal sound on a clear side; the real creature still obeys its physical position.
- `RETREAT`: reduce pressure and open a work opportunity.

Examples: a player repeatedly trusts unverified radio messages, so choose an expired-order impersonation; a player always closes both doors after a sound, so use one feint and let the visible power tradeoff matter; a player verifies every message, so switch to physical timing. Do not claim the director knows subjective fear, intent or deception from a webcam.

Call the model only at encounter boundaries or at least 10–15 seconds apart. The game renderer, doors, hazards, tasks and input never await an API call. The model proposes; deterministic code commits or rejects. No arbitrary code execution or scene graph modification from generated text. A proposal includes request ID and state version; reject expired, duplicated, stale-version or illegal proposals. Use a bounded timeout and seeded fallback. Record source as GEMINI or FALLBACK.

## Biometrics as a slow control signal

First run a short setup screen with permission, lighting guidance and stable seated capture. Begin baseline collection only once valid metrics are flowing. Aim for 30 seconds of usable baseline samples after warmup; offer manual mode if calibration does not succeed within 60 seconds. Calibration is not part of the gameplay countdown.

SDK pulse output is already a windowed estimate. Use personal baseline delta and a rolling trend; do not pretend to observe an immediate beat-level reaction to a jump scare. An initial prototype can call a trend elevated when the last 12 seconds of accepted pulse estimates stay at least 8 BPM above baseline, and recovered below +4 for 12 seconds. Those are adjustable game parameters, not diagnostic thresholds. Enforce a 20-second minimum state dwell to avoid flicker. Overlapping windows are correlated; report an association with the recent encounter, not proof that the encounter caused a reaction.

Gate samples using actual SDK quality/validation flags and documented confidence handling. Outside the documented supported metric range, missing values, bad lighting/motion, camera loss or stale data must produce UNKNOWN, not a fabricated low/high score. Do not invent a universal confidence scale. Preserve the native field and implement its acceptance rule only after checking the installed SDK's definitions/model card.

Elevated trend may bias the next choice toward a voice deception instead of another physical scare; it also extends the recovery window and makes Mara offer a hint. Stable trend can vary encounter type. Neither changes the authentication truth or directly causes a loss. Never require the player to lower pulse or hold their breath to open a door. The nonbiometric mode uses the same legal actions and can win.

Optional breathing rate can affect ambient sound only after separately validating capture conditions and latency. Skip HRV, blood pressure, emotion classification and focus scoring in the MVP. Speech and player movement can invalidate physiological estimates. Provide a stable real-world desk light and avoid full-screen strobing; an in-game dark scene should not make the user's face too dark for capture.

Show LIVE, SIMULATED, UNAVAILABLE or STALE, with sample age. A simulated slider is for development and clearly labeled demonstration only. It must never be presented to judges as Presage output. The actual Presage track demonstration needs a real SDK measurement. Do not upload raw video through our own backend. Explain any SDK processing separately and accurately after checking the provider configuration; opt-out aggregate SDK telemetry is not proof that all measurement processing is local.

## What makes the project technically substantial

Camera measurement integration, native/renderer IPC, a quality-gated asynchronous sensor stream, a constrained AI adversary with partial information, deterministic fairness guarantees, synchronized event records, and positional streamed speech all participate in the same visible loop. Complexity belongs in that loop. Extra databases, payment tokens or unrelated agents would consume time without improving it.

## Definition of done

An unfamiliar player can understand the controls and complete a shift. Camping fails. A valid defensive strategy works across several seeds. Every spoof has a reachable clue. Invalid biometric data causes neutral fallback. Dropped APIs do not freeze the game. A late voice line never directs a now-impossible action. Losing and restarting clear all timers and listeners. Disabling the camera stops capture. Subtitles, volume limits and pause work. Sponsor mode labels accurately disclose live vs cached vs fallback behavior. The project README distinguishes completed integrations from planned ones.
