# Pulse report: measurement, consent and honest language

The fictional creature reacts to accepted sustained pulse trends. The UI does not instruct players to lower their pulse, hold their breath, hyperventilate, remain physically still during danger, or achieve a physiological target to complete a puzzle. "Near baseline reduces the close-range clue" describes a bounded game modifier, not an obligation. Q, lures and puzzles remain effective at every accepted pulse level.

## Two independent choices

1. Optional camera processing for pulse-informed gameplay. The native provider supplies estimates; do not claim the entire SDK processing pipeline is offline.
2. Optional "Record my pulse locally for this run's report", unchecked by default. This stores accepted derived BPM samples in local session memory only. It does not store frames or microphone data, and it is independent of coarse judge sharing.

When recording is off, do not collect a hidden report array. Keep only the minimum current estimate, frozen baseline and trend window needed for gameplay. Stop capture on pause/end/disposal. A report is held in memory until Delete/Return/Restart; persistence/export requires a separate explicit action. Never send raw BPM, baseline, maximum or timeline to Gemini, ElevenLabs or shared Convex trace. Browser simulated fixtures must be distinctly labeled in setup, during play and on the report.

## Recording contract

Only samples accepted by the real adapter's quality gate are eligible. Every entry carries: capturedAtMs (session monotonic clock), gameMs (active simulation time), segment (increments across pause/capture restart), bpm, source, accepted=true. Deduplicate to one median accepted reading per second per segment. Do not fill gaps with last-known values. End-of-run statistics use these accepted one-second readings, not a noisy instantaneous maximum.

Keep events with stable ID, safe type and label, capturedAtMs, gameMs, and segment. Mark only the events relevant to interpretation: SCARE, BLACKOUT, MISTAKE, CLOSE_ENCOUNTER, BREACH_WARNING, LURE_SUCCESS, QUIET, POWER_RESTORED. Do not export voice text, secrets, hardware identifiers or capture metadata. A paused interval is a break in both chart and analysis; no recovery claim can bridge it.

Reference implementation: reference/report.mjs. It is a conservative utility for implementation, not a medical metric. Production should preserve its exclusions and add chart/UI wiring.

## What the screen says

- Baseline: median of the completed usable calibration, frozen for the session.
- Highest accepted reading: maximum of accepted one-second medians, displayed as BPM with signal/source status.
- Timeline: game time on x, BPM on y, broken lines for missing data or different segments. Mark pauses and events without interpolating across loss.
- Largest recorded increase after an event: compare median of 10 seconds before an event (at least 5 accepted one-second bins) with the largest supported five-second median during 5–25 seconds after it (at least 10 post-event bins overall). A five-second comparison window needs at least 4 bins. Require enough coverage and no gap over 5 seconds in each relevant interval.
- If multiple marked events occur in the same attribution window, say "an event cluster including…" and list the associated markers. Never choose a single event and imply causal certainty.
- Recovery: after a supported post-event peak, look for 12 seconds below baseline+4 BPM with at least 11 accepted bins, no gap over 2 seconds, and the same active segment. Check only up to 60 seconds after that event. Say "return toward baseline observed after X seconds"; otherwise "not observed in the available recording". Do not call the latter failure to recover.
- If no qualified positive increase exists: "No supported increase could be associated with an event." If recording/source is absent: "Physiological statistics unrecorded."

Valid phrasing: "The largest recorded increase followed the blackout and nearby wall impact." Add "Timing association only; movement, lighting, measurement delay and other factors may contribute." Invalid phrasing: "The blackout scared you14% more", "Your fear score is89", "You were anxious", or "Your heart rate caused your death."

## Limits that must stay visible

The measured pulse estimate has delay/windowing and supported-range limits. Quality filtering reduces some invalid input; it does not prove medical accuracy. Outside-range and stale input is UNKNOWN, not low pulse. A baseline is a game reference, not a health evaluation. Do not label a report LIVE merely because a key exists; require accepted native samples. SIMULATED data is useful for regression testing only.

The report does not establish that a game event caused a physiological change. A five-minute run often cannot support every comparison. Showing "not enough usable data" is a complete valid result.

## Acceptance tests

Recording-off must leave samples empty. Mixed source samples are excluded; simulation cannot be presented as measured live. Stale/rejected values and outliers outside the documented SDK range do not produce maxima. Large gaps and pauses break the line and prevent event attribution/recovery. Event clusters must be identified. A monotonic timestamp reset starts a new segment. Deleting the run clears both samples and derived statistics, including cached chart/export data.


Deletion can clear only app-owned recordings, derived statistics, temporary export buffers/blob URLs and caches. Previously downloaded files remain under the user’s control; do not promise to revoke them.
