# /src/sensing — Samer (Person 1: signals & platform)

Presage sample adapter, capture lifecycle, frozen baseline, quality/freshness gate and sustained trend. `types.ts` is a team contract.

The user reports that real Presage calibration reaches 30 usable seconds. This is user-reported hardware evidence, not an automated camera test. Preserve the same capture and frozen baseline when proceeding from calibration to the game; do not create another stream merely to show a corner preview.

- Pulse is a ~12 s windowed estimate, documented for 40–110 BPM. Anything stale, unstable, out of range or failing validation is UNKNOWN. Never fabricate or carry over a value.
- The baseline is frozen per session. A trend is +8 BPM sustained for 12 s, recovery is below +4 for 12 s, and changes are at least 20 s apart. These are game tuning values, not medical thresholds. A trend can bias tactics and help; it never kills the player.
- Freshness uses one clock per comparison. Don't compare `performance.now()` across processes.
- Simulated sensing is a labeled dev mode. Never present it as Presage output.
- `NativeMetricStream` merges pulse and breathing independently. Empty/non-pulse packets are NoData, not a rejected pulse. Only new measurement timestamps may accumulate calibration time. Explicit rejection and stale data still exclude input.
- Diagnostic estimates are local only, hidden during the documented 12 s pulse / 30 s breathing windows, and labeled with their real confidence, stability, freshness and validation. They are never beat detection or a medical health/fear score. Confidence ≥80 remains game tuning.
- Frame counters reflect actual native `frameSentThrough` events (or explicit bridge frame rejection), not browser preview frames. Warmup starts on the first successfully forwarded native frame. The SDK itself epoch-anchors WebCodecs timestamps; protobuf measurements use Unix microseconds, mapped to renderer monotonic age.
- Native replacement must await stop AND destroy before construction, including replacement through a different MessagePort. Old callbacks are invalidated. Keep the first sanitized real SDK error; do not overwrite it with secondary invalid-state errors or automatically restart capture.
- Primary references: https://smartspectra.presagetech.com/docs/measurement-quality/ ; https://smartspectra.presagetech.com/docs/data-types/ ; https://smartspectra.presagetech.com/docs/nodejs/api-reference . Native stream/bridge tests use mocks and installed SDK protobuf encoding; they make no hardware captures or provider calls.
