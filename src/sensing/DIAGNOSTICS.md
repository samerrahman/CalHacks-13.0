# Local sensing diagnostics

The camera preview proves that the browser owns a camera stream; it does not prove the native SDK is producing accepted vital estimates. `SensorView.diagnostics` reports those stages separately. Diagnostics stay local and are excluded from director requests and shared traces.

| Field | Meaning |
| --- | --- |
| `captureState`, `processingStatus` | Owned browser capture versus actual native processing status. |
| `framesSentThrough`, `framesRejected`, `lastFrameAgeMs`, `frameRate` | Native forwarding events and explicit bridge frame rejections; recent actual capture timestamps determine FPS. |
| `metricsPackets`, `lastMetricAgeMs` | Arrival of SDK metrics packets, including packets with no pulse or breathing samples. |
| `pulse.sampleCount`, `breathing.sampleCount` | Distinct new measurements received for each independent stream. |
| Per-metric `ageMs` | Age of the SDK measurement timestamp, mapped from Unix microseconds to the renderer's monotonic clock. |
| Per-metric `receivedAgeMs`, `updateIntervalMs` | Time since that stream's last new sample arrived, and interval between its latest two measurement timestamps. Empty, duplicate, older or other-metric packets cannot refresh these clocks. |
| Per-metric `confidence`, `stable`, `requiredConfidence` | Actual SDK confidence/stability, plus the metric-specific acceptance floor. |
| Per-metric `state`, `reasons`, `eligible` | Waiting, warming up, rejected, stale or accepted; exact reasons remain available even when no number can be used. |
| `validationCode`, `validationHint` | Original SDK feedback, preserved even when a chest-specific warning does not invalidate pulse. |

Pulse uses a 12-second window; breathing uses a 30-second window and needs a stationary camera with visible chest. A confidence of zero during warmup is not a usable measurement. The installed SDK 3.4 `js/messages/generated.d.ts` documents stable pulse at confidence ≥40 and stable breathing at ≥45. The game now uses those distinct floors, still requiring `stable=true`, supported range, applicable validation, completed warmup and a measurement no more than five seconds old. The earlier blanket ≥80 filter hid SDK-stable readings. These confidence values are provider quality indicators, not a probability of medical accuracy.

Validation code 7 (`CHEST_NOT_VISIBLE`) applies to breathing/chest metrics. All face, motion, lighting, frame-rate, unknown and missing validation statuses remain blocking for both streams. Relevant warnings immediately withhold current input. Previously accepted trend history can survive a brief frame-level warning, but validation recovery alone cannot resurrect the old pulse: a fresh accepted measurement is required. A real rejected measurement or gap over five seconds interrupts the sustained trend.

Synchronous `sendFrame` timestamp errors 10 and 11 drop/count the affected frame, matching the vendor's Electron bridge. They do not terminate capture or restart analysis windows. Other processing failures and native terminal error events still stop capture and retain the first sanitized error. No automatic retry, synthetic sample, delayed-age extension or camera-frame storage is used.

The existing `ELEVATED` game input remains a coarse sustained change relative to a frozen baseline. Neither pulse nor breathing values become a diagnosis or a direct remote provider input. Pausing or hiding the app intentionally stops capture; resuming it starts fresh metric windows. Entering gameplay or opening camera settings should reuse an already active consenting stream.

The regression tests use mocked native bridges and the installed SDK's real protobuf codec. They verify filtering, independent stream clocks, transient frame handling, teardown ordering, and immediate neutralization on rejected/stale input. They do not prove live hardware reliability. The user has reported successful 30-second calibration; intermittent capture behavior and breathing output on that camera need confirmation in an actual session.

Primary references: [measurement quality and validation](https://smartspectra.presagetech.com/docs/measurement-quality/), [Node metric field selection](https://smartspectra.presagetech.com/docs/nodejs/metrics/), [measurement timestamps and confidence](https://smartspectra.presagetech.com/docs/data-types/), [breathing model card](https://vandv.presagetech.com/breathing_model_card.html). Exact stable thresholds are documented in the installed 3.4 package's generated `Cardio.pulseRate` and `Breathing.rate` field comments; frame rejection behavior is in its `js/main/index.js`.
