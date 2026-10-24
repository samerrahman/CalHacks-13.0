# /src/signals — Samer (Person 1: signals & platform)

Everything that produces `SignalFrame`s (see `shared/types/signals.js`). All sources publish to `signalBus` in `bus.js`; consumers never know which source is live.

Done: mock source (`mock.js`, keys 1–5 and 0) and the debug overlay (`debugOverlay.js`).

## Next, in order
1. **Presage pulse in the app by midnight.** Install Presage's Claude Code plugin first; it explains the SDK. If the SDK runs outside the renderer, read it in `/electron` and push frames over `IPC.signalFrame` (already exposed as `window.scary.signals.onFrame`), then publish them to the bus here.
2. **Calibration:** ~20 s of rest at the start of the session to set `baselinePulseBpm`.
3. **Confidence filtering:** smooth noisy values and hold the last good value when confidence drops. Set `faceDetected: false` when the face is lost.
4. **Recorded sessions by about hour 5:** record real Presage frames to `recordings/<name>.json` (calm, scared, lots of blinking) and add a replay source. These files are committed so teammates can test without a camera.
5. Choose the source in `startSignals()` (index.js): mock, presage or replay.

## Constraints
- Keep publishing at `SIGNAL_HZ` even when values are stale, so the game loop never starves.
- The no-camera fallback must work, so the demo survives a bad webcam.
- Mock keys are digits on purpose. Don't take keys the game uses.
