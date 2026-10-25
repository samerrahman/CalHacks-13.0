# Lucy — AI, wellness & pitch

What my agent did and why. Newest first, one or two lines each.

- 2026-10-24: Merged HUSH `main` into `lucy/ai-wellness`. Kept `src/wellness/` and took `main`'s `src/sensing/controller.ts`, `src/ui/App.tsx` and `src/ui/style.css` unchanged, because the old NIGHT RELAY pause/results mounts no longer exist. The wellness module is currently unmounted.
  Samer handoff: re-add a wellness observation listener in `controller.ts` (previously `subscribeWellness` feeding `adaptNativeMetrics`); `main` already requests pulse and breathing. Lea handoff: mount `WellnessCheckIn` / `WellnessReport` in HUSH's pause and results screens. Team: decide whether `WellnessReport` merges with `PulseReport`.

- 2026-10-24: Audited the HUSH rename on current `main` and restored the existing internal bridge, IPC, local API, trace schema and protocol identifiers so title branding does not break integrations or future wellness storage migration.

- 2026-10-24: Added an in-memory post-shift report with per-signal quality, warm-up, coverage, journal-linked comfort suggestions, and a decoded SmartSpectra adapter; raw frames and detailed samples are not saved or shared.
  Complete-signal behavior is exercised with visibly simulated fixtures, with no live Presage camera verification. Input and gates follow the official [Node metrics](https://smartspectra.presagetech.com/docs/nodejs/metrics/), [payload types](https://smartspectra.presagetech.com/docs/data-types/), and [model limits](https://smartspectra.presagetech.com/docs/model-cards-and-limitations/).
  Samer handoff: when full metrics are provisioned, update `requestedMetrics` in both `src/sensing/controller.ts` and `electron/presageAdapter.ts` for the report's ten signals; keep face landmarks out of the request and verify real capture quality before calling those paths live.

- 2026-10-23: Merged then-current `main` into `lucy/ai-wellness`, then expanded the local check-in to a ten-answer journal with v1 migration, clear, and choice-specific comfort suggestions.
  Mounted it in pause and results, and made both dialogs scroll on short screens; journal data stays in browser storage and outside game/provider/trace paths.

- 2026-10-23: Added an optional self-reported pause check-in in `src/wellness/` with versioned local storage for only the latest choice and timestamp; malformed or unavailable storage is handled safely.
