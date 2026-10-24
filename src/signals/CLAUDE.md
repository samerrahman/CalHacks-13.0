# /src/signals — Samer (Person 1: signals & platform)

Everything that produces `SignalFrame`s (see `shared/types/signals.js`). All sources publish to `signalBus` in `bus.js`; consumers never know which source is live.

Done: the mock source (`mock.js`, keys 1–5 and 0) and the debug overlay (`debugOverlay.js`, which also shows the Convex status).

## Presage (first-hour feasibility gate — prove it on the demo laptop before building on it)
- Package: `@smartspectra/node-sdk`. Pin an exact version (3.4.0 was latest in Oct 2026), because its internal renderer protocol isn't documented. It uses koffi FFI with prebuilt libraries, so no electron-rebuild is needed. It needs macOS on Apple Silicon (no Intel build), and its C shim targets macOS 26. Check with `otool -l` on `libsmartspectra_capi.dylib`. Install all four platform runtimes; macOS alone is about 66 MB.
- **Run the SDK in the main process** with its built-in camera (`useCamera`). The documented renderer route sends the API key from renderer code, which breaks our keys rule. Main reads `PRESAGE_API_KEY` from `.env` and passes it as the `apiKey` option; the SDK reads no env var itself. Set `enableTelemetry: false`.
- **Request pulse explicitly.** The default is breathing only. Use `requestedMetrics: [MetricType.PULSE_RATE, MetricType.BREATHING_RATE]`, plus face metrics if the design needs blinks or talking. Decode with `@smartspectra/node-sdk/messages`. Pulse is in `cardio.pulseRate.at(-1)` with `{ value, confidence (0–100), stable, timestamp (µs) }`.
- Gate readings on the validation status, the ~12 s pulse warm-up, `stable`, and the documented 40–110 BPM range. Anything else is unknown: send `pulseBpm: null`, never a made-up value.
- Map to `SignalFrame` in main and send it with `webContents.send(IPC.signalFrame, frame)`. Stamp `t` with `Date.now()`, because `performance.now()` doesn't match across processes.
- **Never call `stop()` or `waitUntilComplete()` on the main thread; they can deadlock.** Use `await stopAsync()` and then `await destroy()`. If `start()` throws, still call `destroy()`. Keep listeners tiny.

## Next, in order
1. Presage pulse in the app (above).
2. Calibration: about 30 s of valid readings at rest sets `baselinePulseBpm`, with a manual fallback if it isn't ready within 60 s.
3. Confidence filtering: smooth noisy values and hold the last good one. Set `faceDetected: false` when the face is lost.
4. Recorded sessions: save real frames to `recordings/<name>.json` (calm, elevated) and add a replay source. These files are committed so teammates can test without a camera.
5. Choose the source in `startSignals()` (index.js): mock, presage or replay.

## Constraints
- Keep publishing at `SIGNAL_HZ` even when values are stale, so the render loop never starves.
- The no-camera fallback must work, so the demo survives a bad webcam. Label simulated data as simulated; never present it as Presage output.
- Mock keys are digits on purpose. Don't take keys the game uses.
