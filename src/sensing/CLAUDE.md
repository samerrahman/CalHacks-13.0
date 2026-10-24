# /src/sensing — Samer (Person 1: signals & platform)

Presage sample adapter, capture lifecycle, frozen baseline, quality/freshness gate and sustained trend. `types.ts` is a team contract.

**Top open gate:** a real Presage measurement on the demo laptop. It needs `PRESAGE_API_KEY` in `.env.local`, then calibration in Electron in stable lighting. Native loading already passes, but camera capture, calibration and in-game response are untested.

- Pulse is a ~12 s windowed estimate, documented for 40–110 BPM. Anything stale, unstable, out of range or failing validation is UNKNOWN. Never fabricate or carry over a value.
- The baseline is frozen per session. A trend is +8 BPM sustained for 12 s, recovery is below +4 for 12 s, and changes are at least 20 s apart. These are game tuning values, not medical thresholds. A trend can bias tactics and help; it never kills the player.
- Freshness uses one clock per comparison. Don't compare `performance.now()` across processes.
- Simulated sensing is a labeled dev mode. Never present it as Presage output.
